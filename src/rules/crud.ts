import consola from "consola";

import type { Element, Model } from "../model";
import { allElements, targetOf } from "../model";
import {
  buildElementBoundaryMap,
  resolveRedirectTarget,
} from "./lib/boundaryUtils";
import {
  DEFAULT_REPO_NAME_PATTERNS,
  matchesAnyName,
} from "./lib/namingPatterns";
import type { NamingConvention } from "./lib/namingUtils";
import { detectNamingConvention, joinName } from "./lib/namingUtils";
import type { FixResult, RuleDefinition, SourceEdit, Violation } from "./types";

export interface CrudOptions {
  /** Tags маркирующие repo/relay контейнеры. Default ["repo", "relay"]. */
  readonly repoTags?: readonly string[];
  /**
   * Picomatch globs (case-insensitive). Container counts as a repo
   * even without an explicit tag if its name matches any pattern.
   * Closes the legacy-archive use case where naming convention
   * (`*_repository`, `*Storage`) carries the intent that the project
   * never got around to expressing as explicit tags. Default covers
   * `*_repo`, `*_repository`, `*_storage`, `*_dao`, `*_store` and
   * PascalCase variants.
   */
  readonly repoNamePatterns?: readonly string[];
}

const DEFAULT_REPO_TAGS: readonly string[] = ["repo", "relay"];

/** Repo identity: explicit tag OR name-convention match. Used by both
 *  check (to decide whether direct-db access from `c` is allowed) and
 *  fix (to spot an existing repo by name when offering to rewire). */
const isRepo = (
  element: Element,
  options: CrudOptions | undefined,
): boolean => {
  const tags = options?.repoTags ?? DEFAULT_REPO_TAGS;
  if (tags.some((t) => element.tags.includes(t))) return true;
  return matchesAnyName(
    element.name,
    options?.repoNamePatterns ?? DEFAULT_REPO_NAME_PATTERNS,
  );
};

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
  accessor: Element,
  model: Model,
  syntax: FixSyntax,
  options: CrudOptions | undefined,
  convention: NamingConvention,
): FixResult | undefined => {
  const ownerTags = options?.repoTags ?? DEFAULT_REPO_TAGS;
  const dbRels = accessor.relations.filter(
    (r) => targetOf(model, r)?.kind === "ContainerDb",
  );
  const elementBoundaryMap = buildElementBoundaryMap(model);

  const edits: SourceEdit[] = dbRels.flatMap((rel) => {
    const db = targetOf(model, rel);
    if (!db) return [];

    // Find any existing repo for `db` — including one identified by
    // name convention (e.g. `user_repository` in a legacy archive
    // without explicit `repo` tags). Per Safin's feedback: prefer
    // re-using an existing container over creating a new one.
    // Stryker disable next-line ConditionalExpression
    const existingRepo = allElements(model).find(
      (c) =>
        c !== accessor &&
        c.relations.some((r) => r.to === db.name) &&
        isRepo(c, options),
    );

    if (existingRepo) {
      const redirectTarget = resolveRedirectTarget(
        accessor,
        db,
        existingRepo,
        ownerTags,
        model,
        elementBoundaryMap,
        "crud",
      );
      if (!redirectTarget) return [];
      // If the existing repo was identified by name convention only
      // (no explicit tag), the rewire alone isn't enough — re-running
      // `check` would still flag the same accessor because
      // `existingRepo.tags` lacks the repo tag. Emit a redeclaration
      // of the repo with the canonical tag attached so the rule
      // converges in one --fix pass.
      const repoNeedsTagging = !ownerTags.some((t) =>
        existingRepo.tags.includes(t),
      );
      const canonicalRepoTag = ownerTags[0] ?? "repo";
      const tagEdits: SourceEdit[] = repoNeedsTagging
        ? [
            {
              type: "replace" as const,
              search: syntax.containerPattern(existingRepo.name),
              content: syntax.containerDecl(
                existingRepo.name,
                existingRepo.label,
                canonicalRepoTag,
              ),
            },
          ]
        : [];
      return [
        ...tagEdits,
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

    const accessorBoundary = elementBoundaryMap.get(accessor.name);
    const dbBoundary = elementBoundaryMap.get(db.name);
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
    if (repoName in model.elements) {
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
  repo: Element,
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
    const violations: Violation[] = [];

    for (const element of allElements(model)) {
      const dbRelations = element.relations.filter(
        (r) => targetOf(model, r)?.kind === "ContainerDb",
      );
      const isRepoContainer = isRepo(element, options);

      if (!isRepoContainer && dbRelations.length > 0) {
        // Anchor on the first direct-db edge — lint-style click jumps
        // to the `Rel(...)` that broke the rule.
        const firstEdge = dbRelations[0];
        violations.push({
          element: element.name,
          message: `directly accesses database ${dbRelations.map((r) => r.to).join(", ")} — add a repo or relay`,
          ...(firstEdge.sourceLocation
            ? { sourceLocation: firstEdge.sourceLocation }
            : {}),
        });
      }

      const nonDbRels = element.relations.filter(
        (r) => targetOf(model, r)?.kind !== "ContainerDb",
      );
      if (isRepoContainer && nonDbRels.length > 0) {
        const nonDbTargets = nonDbRels.map((r) => r.to).join(", ");
        const firstEdge = nonDbRels[0];
        violations.push({
          element: element.name,
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
    const convention = detectNamingConvention(model);
    const results: FixResult[] = [];

    for (const violation of violations) {
      const element = model.elements[violation.element];
      if (!element) continue;

      const fix = isRepo(element, options)
        ? fixRepoWithNonDbDeps(element, model, syntax)
        : fixNonRepoAccessesDb(element, model, syntax, options, convention);
      if (fix) results.push(fix);
    }

    return results;
  },
};
