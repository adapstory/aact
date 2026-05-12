import consola from "consola";

import type {Boundary, Container, Model} from "../../model";
import {
  allContainers,
  getContainer
} from "../../model";

/**
 * Maps container name → boundary that contains it. Используется fix-функциями
 * для определения cross-boundary access patterns.
 */
export const buildContainerBoundaryMap = (
  model: Model,
): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of Object.values(model.boundaries)) {
    for (const containerName of boundary.containerNames) {
      map.set(containerName, boundary);
    }
  }
  return map;
};

/**
 * Находит "public API" container в boundary — predicate for redirect target.
 * Prefers containers с highest in-degree (incoming relations from outside).
 * Excludes DBs и repo-tagged containers (они internal).
 */
export const findPublicApiCandidate = (
  targetBoundary: Boundary,
  ownerTags: readonly string[],
  model: Model,
  containerBoundaryMap: Map<string, Boundary>,
): Container | undefined => {
  const candidates = targetBoundary.containerNames
    .map((name) => getContainer(model, name))
    .filter((c): c is Container => c !== undefined)
    .filter(
      (c) =>
        c.kind !== "ContainerDb" && !ownerTags.some((t) => c.tags.includes(t)),
    );

  // Stryker disable next-line ConditionalExpression
  if (candidates.length === 0) return undefined;
  // Stryker disable next-line ConditionalExpression
  if (candidates.length === 1) return candidates[0];

  const candidateNames = new Set(candidates.map((c) => c.name));
  // Stryker disable next-line ArrayDeclaration
  const inDegree = new Map<string, number>(candidates.map((c) => [c.name, 0]));

  for (const container of allContainers(model)) {
    if (containerBoundaryMap.get(container.name) === targetBoundary) continue;
    for (const rel of container.relations) {
      if (candidateNames.has(rel.to)) {
        inDegree.set(rel.to, (inDegree.get(rel.to) ?? 0) + 1);
      }
    }
  }

  return candidates.toSorted(
    (a, b) => (inDegree.get(b.name) ?? 0) - (inDegree.get(a.name) ?? 0),
  )[0];
};

/**
 * Resolves redirect target для accessor → DB. Same boundary → owner (repo).
 * Cross-boundary → public API of target boundary. Returns undefined если
 * no valid target — consola.warn для manual review.
 */
export const resolveRedirectTarget = (
  accessor: Container,
  db: Container,
  owner: Container,
  ownerTags: readonly string[],
  model: Model,
  containerBoundaryMap: Map<string, Boundary>,
  ruleName: string,
): Container | undefined => {
  const accessorBoundary = containerBoundaryMap.get(accessor.name);
  const dbBoundary = containerBoundaryMap.get(db.name);

  const isCrossBoundary =
    accessorBoundary !== undefined &&
    dbBoundary !== undefined &&
    accessorBoundary !== dbBoundary;

  if (!isCrossBoundary) return owner;

  const publicApi = findPublicApiCandidate(
    dbBoundary,
    ownerTags,
    model,
    containerBoundaryMap,
  );

  if (!publicApi) {
    consola.warn(
      `fix ${ruleName}: boundary "${dbBoundary.name}" has no public API — cannot auto-redirect "${accessor.name}" away from "${db.name}", fix manually`,
    );
    return undefined;
  }

  if (publicApi === owner) {
    consola.warn(
      `fix ${ruleName}: the only public API candidate in "${dbBoundary.name}" is the repo owner — cross-boundary access from "${accessor.name}" requires manual review`,
    );
    return undefined;
  }

  return publicApi;
};
