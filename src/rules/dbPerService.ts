import consola from "consola";

import type {Container} from "../model";
import { allContainers,  targetOf } from "../model";
import {
  buildContainerBoundaryMap,
  resolveRedirectTarget,
} from "./lib/boundaryUtils";
import type { FixResult, RuleDefinition, Violation } from "./types";

export interface DbPerServiceOptions {
  /** Tags маркирующие repo/relay контейнеры — определяют owner of DB. */
  readonly ownerTags?: readonly string[];
}

const DEFAULT_OWNER_TAGS: readonly string[] = ["repo", "relay"];

const resolveOwner = (
  dbName: string,
  accessors: readonly Container[],
  ownerTags: readonly string[],
): Container => {
  const tagged = accessors.filter((c) =>
    c.tags.some((t) => ownerTags.includes(t)),
  );

  if (tagged.length === 0) {
    consola.warn(
      `Cannot determine owner of ${dbName}: no ${ownerTags.join("/")} tagged accessor found, using ${accessors[0].name}`,
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
    const dbAccessMap = new Map<string, string[]>();

    for (const container of allContainers(model)) {
      for (const rel of container.relations) {
        if (targetOf(model, rel)?.kind === "ContainerDb") {
          const accessors = dbAccessMap.get(rel.to) ?? [];
          accessors.push(container.name);
          dbAccessMap.set(rel.to, accessors);
        }
      }
    }

    for (const [db, accessors] of dbAccessMap) {
      if (accessors.length > 1) {
        violations.push({
          container: db,
          message: `shared between ${accessors.join(", ")} — each database should have a single owner`,
        });
      }
    }

    return violations;
  },

  fix(model, violations, syntax, options) {
    const ownerTags = options?.ownerTags ?? DEFAULT_OWNER_TAGS;
    const containerBoundaryMap = buildContainerBoundaryMap(model);
    const results: FixResult[] = [];

    for (const violation of violations) {
      // Stryker disable all
      const db = allContainers(model).find(
        (c) => c.name === violation.container && c.kind === "ContainerDb",
      );
      // Stryker restore all
      if (!db) continue;

      const accessors = allContainers(model).filter((c) =>
        c.relations.some((r) => r.to === db.name),
      );
      // Stryker disable next-line all
      if (accessors.length <= 1) continue;

      const owner = resolveOwner(db.name, accessors, ownerTags);

      const edits = accessors
        .filter((c) => c !== owner)
        .flatMap((accessor) => {
          // Stryker disable next-line all
          const rel = accessor.relations.find((r) => r.to === db.name)!;

          const redirectTarget = resolveRedirectTarget(
            accessor,
            db,
            owner,
            ownerTags,
            model,
            containerBoundaryMap,
            "dbPerService",
          );
          if (!redirectTarget) return [];

          const tags = rel.tags.length > 0 ? rel.tags.join("+") : undefined;
          return [
            {
              type: "replace" as const,
              search: syntax.relationPattern(accessor.name, db.name),
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
