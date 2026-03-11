import consola from "consola";

import type { ArchitectureModel, Boundary, Container } from "../model";
import { CONTAINER_DB_TYPE } from "../model";
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

const buildContainerBoundaryMap = (
  model: ArchitectureModel,
): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of model.boundaries) {
    for (const container of boundary.containers) {
      map.set(container.name, boundary);
    }
  }
  return map;
};

/**
 * Finds the best "public API" container in a boundary to serve as redirect
 * target for cross-boundary accessors. Prefers containers with the most
 * incoming relations from outside the boundary (highest in-degree).
 */
const findPublicApiCandidate = (
  targetBoundary: Boundary,
  dbType: string,
  ownerTags: string[],
  model: ArchitectureModel,
  containerBoundaryMap: Map<string, Boundary>,
): Container | undefined => {
  const candidates = targetBoundary.containers.filter(
    (c) => c.type !== dbType && !ownerTags.some((t) => c.tags?.includes(t)),
  );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Rank candidates by in-degree from containers outside this boundary
  const candidateNames = new Set(candidates.map((c) => c.name));
  const inDegree = new Map<string, number>(candidates.map((c) => [c.name, 0]));

  for (const container of model.allContainers) {
    if (containerBoundaryMap.get(container.name) === targetBoundary) continue;
    for (const rel of container.relations) {
      if (candidateNames.has(rel.to.name)) {
        inDegree.set(rel.to.name, (inDegree.get(rel.to.name) ?? 0) + 1);
      }
    }
  }

  return candidates.toSorted(
    (a, b) => (inDegree.get(b.name) ?? 0) - (inDegree.get(a.name) ?? 0),
  )[0];
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
    const db = model.allContainers.find(
      (c) => c.name === violation.container && c.type === dbType,
    );
    if (!db) continue;

    const accessors = model.allContainers.filter((c) =>
      c.relations.some((r) => r.to.name === db.name),
    );
    if (accessors.length <= 1) continue;

    const owner = resolveOwner(db.name, accessors, ownerTags);
    const dbBoundary = containerBoundaryMap.get(db.name);

    const edits = accessors
      .filter((c) => c !== owner)
      .flatMap((accessor) => {
        const rel = accessor.relations.find((r) => r.to.name === db.name);
        if (!rel) {
          consola.warn(
            `fix dbPerService: relation from ${accessor.name} to ${db.name} not found, skipping`,
          );
          return [];
        }

        const accessorBoundary = containerBoundaryMap.get(accessor.name);
        const isCrossBoundary =
          accessorBoundary !== undefined &&
          dbBoundary !== undefined &&
          accessorBoundary !== dbBoundary;

        let redirectTarget: Container;

        if (isCrossBoundary) {
          const publicApi = findPublicApiCandidate(
            dbBoundary,
            dbType,
            ownerTags,
            model,
            containerBoundaryMap,
          );
          if (!publicApi) {
            consola.warn(
              `fix dbPerService: boundary "${dbBoundary.name}" has no public API — cannot auto-redirect "${accessor.name}" away from "${db.name}", fix manually`,
            );
            return [];
          }
          if (publicApi === owner) {
            consola.warn(
              `fix dbPerService: the only public API candidate in "${dbBoundary.name}" is the repo owner — cross-boundary access from "${accessor.name}" requires manual review`,
            );
            return [];
          }
          redirectTarget = publicApi;
        } else {
          redirectTarget = owner;
        }

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
