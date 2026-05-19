import consola from "consola";

import type { Container, Model } from "../model";
import { allContainers, targetOf } from "../model";
import {
  buildContainerBoundaryMap,
  resolveRedirectTarget,
} from "./lib/boundaryUtils";
import type { NamingConvention } from "./lib/namingUtils";
import { detectNamingConvention, joinName } from "./lib/namingUtils";
import type { FixResult, RuleDefinition, SourceEdit, Violation } from "./types";

export interface CrudOptions {
  /** Tags маркирующие repo/relay контейнеры. Default ["repo", "relay"]. */
  readonly repoTags?: readonly string[];
}

const DEFAULT_REPO_TAGS: readonly string[] = ["repo", "relay"];

const stripDbWord = (name: string): string => {
  const lower = name.toLowerCase();
  for (const suffix of [
    "_database",
    "-database",
    "database",
    "_db",
    "-db",
    "db",
  ]) {
    if (lower.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
};

const deriveRepoName = (
  dbName: string,
  convention: NamingConvention,
): string => {
  const base = stripDbWord(dbName);
  return joinName(base || dbName, "repo", convention);
};

const deriveRepoLabel = (dbName: string): string => {
  const base = stripDbWord(dbName);
  const word = base || dbName;
  return (
    word.charAt(0).toUpperCase() + word.slice(1).replaceAll("_", " ") + " Repo"
  );
};

type FixSyntax = Parameters<NonNullable<RuleDefinition<CrudOptions>["fix"]>>[2];

const fixNonRepoAccessesDb = (
  accessor: Container,
  model: Model,
  syntax: FixSyntax,
  ownerTags: readonly string[],
  convention: NamingConvention,
): FixResult | undefined => {
  const dbRels = accessor.relations.filter(
    (r) => targetOf(model, r)?.kind === "ContainerDb",
  );
  const containerBoundaryMap = buildContainerBoundaryMap(model);

  const edits: SourceEdit[] = dbRels.flatMap((rel) => {
    const db = targetOf(model, rel);
    if (!db) return [];

    // Stryker disable next-line ConditionalExpression
    const existingRepo = allContainers(model).find(
      (c) =>
        c !== accessor &&
        c.relations.some((r) => r.to === db.name) &&
        ownerTags.some((t) => c.tags.includes(t)),
    );

    if (existingRepo) {
      const redirectTarget = resolveRedirectTarget(
        accessor,
        db,
        existingRepo,
        ownerTags,
        model,
        containerBoundaryMap,
        "crud",
      );
      if (!redirectTarget) return [];
      return [
        {
          type: "replace" as const,
          search: syntax.relationPattern(accessor.name, db.name),
          content: syntax.relationDecl(
            accessor.name,
            redirectTarget.name,
            rel.technology,
          ),
        },
      ];
    }

    const accessorBoundary = containerBoundaryMap.get(accessor.name);
    const dbBoundary = containerBoundaryMap.get(db.name);
    if (
      accessorBoundary !== undefined &&
      dbBoundary !== undefined &&
      accessorBoundary !== dbBoundary
    ) {
      consola.warn(
        `fix crud: "${accessor.name}" accesses "${db.name}" cross-boundary with no existing repo — fix manually`,
      );
      return [];
    }

    const repoName = deriveRepoName(db.name, convention);
    if (repoName in model.containers) {
      consola.warn(
        `fix crud: cannot create repo for "${db.name}" — "${repoName}" already exists`,
      );
      return [];
    }

    return [
      {
        type: "add" as const,
        search: syntax.containerPattern(db.name),
        content: syntax.containerDecl(
          repoName,
          deriveRepoLabel(db.name),
          ownerTags[0] ?? "repo",
        ),
      },
      {
        type: "add" as const,
        search: syntax.containerPattern(repoName),
        content: syntax.relationDecl(repoName, db.name, rel.technology),
      },
      {
        type: "replace" as const,
        search: syntax.relationPattern(accessor.name, db.name),
        content: syntax.relationDecl(accessor.name, repoName, rel.technology),
      },
    ];
  });

  if (edits.length === 0) return undefined;

  return {
    rule: "crud",
    description: `Add repo intermediary for ${accessor.name} → ${dbRels.map((r) => r.to).join(", ")}`,
    edits,
  };
};

const fixRepoWithNonDbDeps = (
  repo: Container,
  model: Model,
  syntax: FixSyntax,
): FixResult | undefined => {
  const nonDbRels = repo.relations.filter(
    (r) => targetOf(model, r)?.kind !== "ContainerDb",
  );
  if (nonDbRels.length === 0) return undefined;

  return {
    rule: "crud",
    description: `Remove non-database dependencies from repo ${repo.name}`,
    edits: nonDbRels.map((rel) => ({
      type: "remove" as const,
      search: syntax.relationPattern(repo.name, rel.to),
    })),
  };
};

/**
 * Database per CRUD-service: containers без repo-tag не должны напрямую
 * обращаться к databases. Доступ через repo/relay прокси. Repo-контейнеры
 * наоборот должны только базы трогать (no external deps).
 */
export const crudRule: RuleDefinition<CrudOptions> = {
  name: "crud",
  description:
    "Direct database access only through repo/relay containers; repos must access databases only",

  check(model, options) {
    const repoTags = options?.repoTags ?? DEFAULT_REPO_TAGS;
    const violations: Violation[] = [];

    for (const container of allContainers(model)) {
      const dbRelations = container.relations.filter(
        (r) => targetOf(model, r)?.kind === "ContainerDb",
      );
      const isRepo = repoTags.some((tag) => container.tags.includes(tag));

      if (!isRepo && dbRelations.length > 0) {
        // Anchor on the first direct-db edge — lint-style click jumps
        // to the `Rel(...)` that broke the rule.
        const firstEdge = dbRelations[0];
        violations.push({
          container: container.name,
          message: `directly accesses database ${dbRelations.map((r) => r.to).join(", ")} — add a repo or relay`,
          ...(firstEdge.sourceLocation
            ? { sourceLocation: firstEdge.sourceLocation }
            : {}),
        });
      }

      const nonDbRels = container.relations.filter(
        (r) => targetOf(model, r)?.kind !== "ContainerDb",
      );
      if (isRepo && nonDbRels.length > 0) {
        const nonDbTargets = nonDbRels.map((r) => r.to).join(", ");
        const firstEdge = nonDbRels[0];
        violations.push({
          container: container.name,
          message: `repo has non-database dependencies: ${nonDbTargets} — repos should only access databases`,
          ...(firstEdge.sourceLocation
            ? { sourceLocation: firstEdge.sourceLocation }
            : {}),
        });
      }
    }

    return violations;
  },

  fix(model, violations, syntax, options) {
    const ownerTags = options?.repoTags ?? DEFAULT_REPO_TAGS;
    const convention = detectNamingConvention(model);
    const results: FixResult[] = [];

    for (const violation of violations) {
      const container = model.containers[violation.container];
      if (!container) continue;

      const isRepo = ownerTags.some((t) => container.tags.includes(t));
      const fix = isRepo
        ? fixRepoWithNonDbDeps(container, model, syntax)
        : fixNonRepoAccessesDb(container, model, syntax, ownerTags, convention);
      if (fix) results.push(fix);
    }

    return results;
  },
};
