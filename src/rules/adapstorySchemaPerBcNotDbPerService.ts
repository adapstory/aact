import type { Element, Model, Relation } from "./adapstoryUtils";
import {
  allElements,
  elementOwnText,
  elementViolation,
  isDatabaseElement,
  matchesPattern,
  targetOf,
} from "./adapstoryUtils";
import type { RuleDefinition, Violation } from "./types";

const DEFAULT_SHARED_DATABASE_PATTERN = /postgres/i;
const DEFAULT_BC_TAG_PATTERN = /^bc-\d+$/i;
const DEFAULT_SCHEMA_MARKER_PATTERN = /schema-per-bc/i;
const DEFAULT_SCHEMA_OWNER_PATTERN = /schema-owner:[^\s,;]+/i;
const REVIEWED_EVIDENCE_PATTERN = /reviewed[-_\s]?overlay|reviewed overlay/i;

export interface AdapstorySchemaPerBcNotDbPerServiceOptions {
  sharedDatabasePattern?: RegExp;
  bcTagPattern?: RegExp;
  schemaMarkerPattern?: RegExp;
  schemaOwnerPattern?: RegExp;
}

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const bcTagFor = (
  container: Element,
  bcTagPattern: RegExp,
): string | undefined =>
  container.tags.find((tag) => matchesPattern(bcTagPattern, tag));

const databaseText = (container: Element): string => elementOwnText(container);

const relationText = (relation: Relation): string =>
  [...relation.tags, relation.technology ?? ""].join(" ");

const hasSchemaOwnership = (
  relation: Relation,
  bcTag: string,
  schemaMarkerPattern: RegExp,
): boolean => {
  const text = relationText(relation);
  if (!matchesPattern(schemaMarkerPattern, text)) return false;

  const schemaPattern = new RegExp(
    String.raw`\bschema\s*(?::|=|-)\s*${escapeRegExp(bcTag)}\b`,
    "i",
  );
  return schemaPattern.test(text);
};

const hasReviewedLogicalSchemaOwner = (
  relation: Relation,
  schemaMarkerPattern: RegExp,
  schemaOwnerPattern: RegExp,
): boolean => {
  const text = relationText(relation);
  return (
    matchesPattern(REVIEWED_EVIDENCE_PATTERN, text) &&
    matchesPattern(schemaMarkerPattern, text) &&
    matchesPattern(schemaOwnerPattern, text)
  );
};

export const checkAdapstorySchemaPerBcNotDbPerService = (
  model: Model,
  options?: AdapstorySchemaPerBcNotDbPerServiceOptions,
): Violation[] => {
  const sharedDatabasePattern =
    options?.sharedDatabasePattern ?? DEFAULT_SHARED_DATABASE_PATTERN;
  const bcTagPattern = options?.bcTagPattern ?? DEFAULT_BC_TAG_PATTERN;
  const schemaMarkerPattern =
    options?.schemaMarkerPattern ?? DEFAULT_SCHEMA_MARKER_PATTERN;
  const schemaOwnerPattern =
    options?.schemaOwnerPattern ?? DEFAULT_SCHEMA_OWNER_PATTERN;
  const violations: Violation[] = [];

  for (const container of allElements(model)) {
    for (const relation of container.relations) {
      const target = targetOf(model, relation);
      if (!target || !isDatabaseElement(target)) continue;
      if (!matchesPattern(sharedDatabasePattern, databaseText(target))) {
        continue;
      }

      const bcTag = bcTagFor(container, bcTagPattern);
      if (!bcTag) {
        if (
          hasReviewedLogicalSchemaOwner(
            relation,
            schemaMarkerPattern,
            schemaOwnerPattern,
          )
        ) {
          continue;
        }

        violations.push({
          ...elementViolation(
            container,
            `uses shared database "${target.name}" without bounded context tag for schema-per-BC ownership`,
            relation,
          ),
        });
        continue;
      }

      if (!hasSchemaOwnership(relation, bcTag, schemaMarkerPattern)) {
        violations.push({
          ...elementViolation(
            container,
            `uses shared database "${target.name}" without schema-per-BC ownership for ${bcTag}`,
            relation,
          ),
        });
      }
    }
  }

  return violations;
};

export const adapstorySchemaPerBcNotDbPerServiceRule: RuleDefinition<AdapstorySchemaPerBcNotDbPerServiceOptions> =
  {
    name: "adapstory-schema-per-bc-not-db-per-service",
    description:
      "Shared PostgreSQL is allowed only when logical schema ownership per bounded context is explicit.",
    check: checkAdapstorySchemaPerBcNotDbPerService,
  };
