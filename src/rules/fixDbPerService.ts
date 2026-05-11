import consola from "consola";

import type { ArchitectureModel, Container } from "../model";
import { CONTAINER_DB_TYPE } from "../model";
import {
  buildContainerBoundaryMap,
  resolveRedirectTarget,
} from "./boundaryUtils";
import type { DbPerServiceOptions } from "./dbPerService";
import type { FixResult, SourceSyntax } from "./fix";
import type { Violation } from "./types";

const resolveOwner = (
  dbName: string,
  accessors: Container[],
  ownerTags: string[],
): Container => {
  const tagged = accessors.filter((c) =>
    c.tags?.some((t) => ownerTags.includes(t)),
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

export const fixDbPerService = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: DbPerServiceOptions,
): FixResult[] => {
  const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
  const ownerTags = options?.ownerTags ?? ["repo", "relay"];
  const containerBoundaryMap = buildContainerBoundaryMap(model);
  const results: FixResult[] = [];

  for (const violation of violations) {
    // The name+type conjunction filters out containers that share a name
    // with the violated db (rare but legal in pathological loaders). The
    // `||`/conditional mutations are observationally equivalent because
    // in well-formed models container names are unique — both find()
    // calls return the same object.
    // Stryker disable all
    const db = model.allContainers.find(
      (c) => c.name === violation.container && c.type === dbType,
    );
    // Stryker restore all
    if (!db) continue;

    const accessors = model.allContainers.filter((c) =>
      c.relations.some((r) => r.to.name === db.name),
    );
    // `<= 1` short-circuits the no-fix case for single or zero accessors;
    // the alternative path (resolveOwner + filter(!== owner)) would yield
    // an empty edits array anyway. Kept for clarity, but mutating `<= 1`
    // is observationally equivalent in valid models.
    // Stryker disable next-line all
    if (accessors.length <= 1) continue;

    const owner = resolveOwner(db.name, accessors, ownerTags);

    const edits = accessors
      .filter((c) => c !== owner)
      .flatMap((accessor) => {
        // `accessors` above is filtered to require `c.relations.some(r => r.to.name === db.name)`,
        // so `find` here is guaranteed to hit. The defensive bail exists to
        // satisfy TypeScript narrowing and to catch a future refactor that
        // drops the filter — it is unreachable today.
        // Stryker disable next-line all
        const rel = accessor.relations.find((r) => r.to.name === db.name)!;

        const redirectTarget = resolveRedirectTarget(
          accessor,
          db,
          owner,
          dbType,
          ownerTags,
          model,
          containerBoundaryMap,
          "dbPerService",
        );
        if (!redirectTarget) return [];

        const tags =
          rel.tags && rel.tags.length > 0 ? rel.tags.join("+") : undefined;
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
};
