import { createHash } from "node:crypto";

import { ruleRegistry } from "../../rules/registry";
import type { RuleDefinition } from "../../rules/types";
import type {
  SarifAdapter,
  SarifLog,
  SarifReportingDescriptor,
  SarifResult,
} from "../output";
import type { CheckData, CheckViolation } from "./check";

const SARIF_SCHEMA =
  "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.6.json";

const AACT_INFO_URI = "https://github.com/Byndyusoft/aact";

/**
 * Build a `tool.driver.rules[]` catalogue from the built-in registry.
 * Custom rules registered via `aact.config.ts` aren't in the registry
 * but their violations still surface — SARIF allows `ruleId` without
 * a matching descriptor, so unknown rule ids show up as alerts with
 * just the id (consumers display the message verbatim).
 */
const buildRuleCatalogue = (
  rules: readonly RuleDefinition[],
): readonly SarifReportingDescriptor[] =>
  rules.map((r) => ({
    id: r.name,
    name: r.name,
    shortDescription: { text: r.description },
    helpUri: `${AACT_INFO_URI}#${r.name}`,
  }));

const ruleIndexMap = (
  rules: readonly RuleDefinition[],
): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  rules.forEach((r, i) => map.set(r.name, i));
  return map;
};

/**
 * Stable hash for GitHub Code Scanning's alert deduplication. We
 * combine rule + target + message into a SHA-256 truncated to 16
 * hex chars — short enough to read, wide enough to avoid collisions.
 * `sourceLocation` is intentionally NOT folded in: edits that shift
 * line numbers should not break alert continuity.
 */
const fingerprint = (v: CheckViolation): string =>
  createHash("sha256")
    .update(`${v.rule}\0${v.target}\0${v.message}`)
    .digest("hex")
    .slice(0, 16);

const violationToResult = (
  v: CheckViolation,
  ruleIndex: ReadonlyMap<string, number>,
): SarifResult => {
  const loc = v.sourceLocation;
  const region = loc
    ? {
        startLine: loc.start.line,
        startColumn: loc.start.col,
        endLine: loc.end.line,
        endColumn: loc.end.col,
      }
    : { startLine: 1 };
  return {
    ruleId: v.rule,
    ...(ruleIndex.has(v.rule) ? { ruleIndex: ruleIndex.get(v.rule) } : {}),
    level: "error",
    message: { text: `${v.target}: ${v.message}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: loc?.file ?? "unknown" },
          region,
        },
      },
    ],
    partialFingerprints: { aactViolationHash: fingerprint(v) },
    properties: { targetKind: v.targetKind },
  };
};

/**
 * Map a `check` envelope to a SARIF v2.1.0 log. Only the violations
 * become SARIF `results` — fixes, suggestedFixes, and diagnostics
 * (rule-load issues etc.) are out of SARIF's scope: SARIF describes
 * "what's wrong", not "how to fix" or "tool errors".
 *
 * The `tool.driver.rules[]` catalogue lists the 8 built-ins. Custom
 * rules' violations still surface (SARIF accepts a `ruleId` without
 * a descriptor), they just don't carry a description or helpUri.
 */
export const checkSarifAdapter: SarifAdapter<CheckData> = (envelope) => {
  const rules = buildRuleCatalogue(ruleRegistry);
  const indexMap = ruleIndexMap(ruleRegistry);
  const results = envelope.data.violations.map((v) =>
    violationToResult(v, indexMap),
  );
  const log: SarifLog = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "aact",
            version: envelope.meta.aactVersion,
            informationUri: AACT_INFO_URI,
            rules,
          },
        },
        results,
      },
    ],
  };
  return log;
};
