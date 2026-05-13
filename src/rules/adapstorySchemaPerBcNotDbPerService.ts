import {
    type ArchitectureModel,
    type Container,
    CONTAINER_DB_TYPE,
    type Relation,
} from "../model";
import type { Violation } from "./types";

const DEFAULT_SHARED_DATABASE_PATTERN = /postgres/i;
const DEFAULT_BC_TAG_PATTERN = /^bc-\d+$/i;
const DEFAULT_SCHEMA_MARKER_PATTERN = /schema-per-bc/i;

export interface AdapstorySchemaPerBcNotDbPerServiceOptions {
    dbType?: string;
    sharedDatabasePattern?: RegExp;
    bcTagPattern?: RegExp;
    schemaMarkerPattern?: RegExp;
}

const escapeRegExp = (value: string): string =>
    value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const matchesPattern = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
};

const bcTagFor = (
    container: Container,
    bcTagPattern: RegExp,
): string | undefined =>
    (container.tags ?? []).find((tag) => matchesPattern(bcTagPattern, tag));

const databaseText = (container: Container): string =>
    [container.name, container.label, container.description].join(" ");

const relationText = (relation: Relation): string =>
    [...(relation.tags ?? []), relation.technology ?? ""].join(" ");

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

export const checkAdapstorySchemaPerBcNotDbPerService = (
    model: ArchitectureModel,
    options?: AdapstorySchemaPerBcNotDbPerServiceOptions,
): Violation[] => {
    const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
    const sharedDatabasePattern =
        options?.sharedDatabasePattern ?? DEFAULT_SHARED_DATABASE_PATTERN;
    const bcTagPattern = options?.bcTagPattern ?? DEFAULT_BC_TAG_PATTERN;
    const schemaMarkerPattern =
        options?.schemaMarkerPattern ?? DEFAULT_SCHEMA_MARKER_PATTERN;
    const violations: Violation[] = [];

    for (const container of model.allContainers) {
        for (const relation of container.relations) {
            if (relation.to.type !== dbType) continue;
            if (
                !matchesPattern(
                    sharedDatabasePattern,
                    databaseText(relation.to),
                )
            ) {
                continue;
            }

            const bcTag = bcTagFor(container, bcTagPattern);
            if (!bcTag) {
                violations.push({
                    container: container.name,
                    message: `uses shared database "${relation.to.name}" without bounded context tag for schema-per-BC ownership`,
                });
                continue;
            }

            if (!hasSchemaOwnership(relation, bcTag, schemaMarkerPattern)) {
                violations.push({
                    container: container.name,
                    message: `uses shared database "${relation.to.name}" without schema-per-BC ownership for ${bcTag}`,
                });
            }
        }
    }

    return violations;
};
