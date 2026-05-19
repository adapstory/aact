import consola from "consola";

import type { Element, SourceLocation } from "../model";
import { allElements, targetOf } from "../model";
import {
  buildElementBoundaryMap,
  resolveRedirectTarget,
} from "./lib/boundaryUtils";
import {
  DEFAULT_REPO_NAME_PATTERNS,
  matchesAnyName,
} from "./lib/namingPatterns";
import type { FixResult, RuleDefinition, SourceEdit, Violation } from "./types";

export interface DbPerServiceOptions {
  /** Tags маркирующие repo/relay контейнеры — определяют owner of DB. */
  readonly ownerTags?: readonly string[];
  /**
   * Picomatch globs (case-insensitive). Container counts as an owner
   * (repo/relay) even without an explicit tag if its name matches
   * any pattern. Mirrors `crud.repoNamePatterns` — same defaults,
   * same intent. Configure independently when DB-owner naming
   * conventions diverge from generic repo conventions.
   */
  readonly ownerNamePatterns?: readonly string[];
}

const DEFAULT_OWNER_TAGS: readonly string[] = ["repo", "relay"];

/** Owner identity: explicit tag OR name-convention match. */
const isOwner = (
  element: Element,
  options: DbPerServiceOptions | undefined,
): boolean => {
  const tags = options?.ownerTags ?? DEFAULT_OWNER_TAGS;
  if (tags.some((t) => element.tags.includes(t))) return true;
  return matchesAnyName(
    element.name,
    options?.ownerNamePatterns ?? DEFAULT_REPO_NAME_PATTERNS,
  );
};

const resolveOwner = (
  dbName: string,
  accessors: readonly Element[],
  options: DbPerServiceOptions | undefined,
): Element => {
  const tagged = accessors.filter((c) => isOwner(c, options));

  if (tagged.length === 0) {
    const tagNames = (options?.ownerTags ?? DEFAULT_OWNER_TAGS).join("/");
    consola.warn(
      `Cannot determine owner of ${dbName}: no ${tagNames} tagged accessor found, using ${accessors[0].name}`,
    );
    return accessors[0];
  }

  if (tagged.length > 1) {
    consola.warn(
      `Cannot determine owner of ${dbName}: multiple tagged accessors (${tagged.map((c) => c.name).join(", ")}), using ${tagged[0].name}`,
    );
  }

  return tagged[0];
};

/**
 * Database per Service: одна база — один владелец. Если несколько
 * контейнеров напрямую обращаются к одной БД, это нарушение принципа.
 */
export const dbPerServiceRule: RuleDefinition<DbPerServiceOptions> = {
  name: "dbPerService",
  description:
    "Each database container must have a single owner (one repo/relay per DB)",

  check(model) {
    const violations: Violation[] = [];
    // Track accessor name + first edge pointing at each db so we can
    // anchor diagnostics on the actual `Rel(accessor, db, ...)` line.
    interface DbAccess {
      readonly accessors: string[];
      readonly firstEdgeLocation: SourceLocation | undefined;
    }
    const dbAccessMap = new Map<string, DbAccess>();

    for (const element of allElements(model)) {
      for (const rel of element.relations) {
        if (targetOf(model, rel)?.kind === "ContainerDb") {
          const existing = dbAccessMap.get(rel.to);
          if (existing) {
            existing.accessors.push(element.name);
          } else {
            dbAccessMap.set(rel.to, {
              accessors: [element.name],
              firstEdgeLocation: rel.sourceLocation,
            });
          }
        }
      }
    }

    for (const [db, { accessors, firstEdgeLocation }] of dbAccessMap) {
      if (accessors.length > 1) {
        violations.push({
          element: db,
          message: `shared between ${accessors.join(", ")} — each database should have a single owner`,
          ...(firstEdgeLocation ? { sourceLocation: firstEdgeLocation } : {}),
        });
      }
    }

    return violations;
  },

  fix(ctx) {
    const { model, violations, syntax, options } = ctx;
    const ownerTags = options?.ownerTags ?? DEFAULT_OWNER_TAGS;
    const elementBoundaryMap = buildElementBoundaryMap(model);
    const results: FixResult[] = [];

    for (const violation of violations) {
      // Stryker disable all
      const db = allElements(model).find(
        (c) => c.name === violation.element && c.kind === "ContainerDb",
      );
      // Stryker restore all
      if (!db) continue;

      const accessors = allElements(model).filter((c) =>
        c.relations.some((r) => r.to === db.name),
      );
      // Stryker disable next-line all
      if (accessors.length <= 1) continue;

      const owner = resolveOwner(db.name, accessors, options);

      const edits: SourceEdit[] = accessors
        .filter((c) => c !== owner)
        .flatMap((accessor): SourceEdit[] => {
          // Stryker disable next-line all
          const rel = accessor.relations.find((r) => r.to === db.name)!;
          if (!rel.sourceLocation) return [];

          const redirectTarget = resolveRedirectTarget(
            accessor,
            db,
            owner,
            ownerTags,
            model,
            elementBoundaryMap,
            "dbPerService",
          );
          if (!redirectTarget) return [];

          const tags = rel.tags.length > 0 ? rel.tags.join("+") : undefined;
          return [
            {
              kind: "replace",
              range: rel.sourceLocation,
              content: syntax.relationDecl(
                accessor.name,
                redirectTarget.name,
                rel.technology ?? "",
                tags,
              ),
            },
          ];
        });

      if (edits.length === 0) continue;

      results.push({
        rule: "dbPerService",
        description: `Redirect access to ${db.name} through ${owner.name}`,
        edits,
      });
    }

    return results;
  },
};
