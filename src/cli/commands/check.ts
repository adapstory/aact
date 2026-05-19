import { readFile, writeFile } from "node:fs/promises";

import { box, colors } from "consola/utils";
import path from "pathe";

import type { AactConfig } from "../../config";
import { loadFormat } from "../../formats/registry";
import type { FixCapability, SourceSyntax } from "../../formats/types";
import { canFix } from "../../formats/types";
import type { Model, SourceLocation } from "../../model";
import { formatLocation } from "../../model";
import { applyEdits } from "../../rules/lib/applyEdits";
import { ruleRegistry } from "../../rules/registry";
import type { FixResult, RuleDefinition, Violation } from "../../rules/types";
import { issueToDiagnostic, loadModel } from "../loadModel";
import type { Diagnostic, ExitCode, Renderer } from "../output";
import { linkSourceLocation } from "../output/hyperlinks";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg } from "../sharedArgs";

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact check`)
// -----------------------------------------------------------------------------

export interface CheckViolation {
  readonly rule: string;
  readonly element: string;
  readonly message: string;
  /** v1: always "error". Per-rule severity will be additive in a future bump. */
  readonly severity: "error";
  /**
   * Optional location of the offending construct in source. Populated
   * either from `Violation.sourceLocation` if the rule set it
   * explicitly, or by looking up
   * `model.elements[v.element].sourceLocation` as fallback.
   * Surfaces in the JSON envelope for agents and powers OSC8
   * hyperlinks in text mode (`terminal-link`).
   */
  readonly sourceLocation?: SourceLocation;
}

export interface CheckSummary {
  readonly failed: number;
  readonly passed: number;
  readonly total: number;
}

export interface CheckFixesApplied {
  readonly count: number;
  readonly remaining: number;
  readonly writePath: string;
}

export type CheckMode = "check" | "dry-run" | "fix";

export interface CheckData {
  readonly mode: CheckMode;
  readonly violations: readonly CheckViolation[];
  readonly suggestedFixes: readonly FixResult[];
  readonly summary: CheckSummary;
  readonly fixesApplied?: CheckFixesApplied;
}

// -----------------------------------------------------------------------------
// Internal rule plumbing (kept pure: no consola, no console.log)
// -----------------------------------------------------------------------------

interface RuleResult {
  readonly name: string;
  readonly violations: readonly Violation[];
}

const buildEffectiveRules = (
  customRules?: readonly RuleDefinition[],
): readonly RuleDefinition[] => {
  if (!customRules || customRules.length === 0) return ruleRegistry;

  const seen = new Map<string, "built-in" | "custom">();
  for (const r of ruleRegistry) seen.set(r.name, "built-in");

  const merged: RuleDefinition[] = [...ruleRegistry];
  for (const r of customRules) {
    const existing = seen.get(r.name);
    if (existing) {
      throw new Error(
        `customRules: rule "${r.name}" conflicts with existing ${existing} rule. ` +
          `Rename your custom rule (e.g. prefix with your project name).`,
      );
    }
    seen.set(r.name, "custom");
    merged.push(r);
  }
  return merged;
};

const collectUnknownRuleDiagnostics = (
  rules: AactConfig["rules"],
  effective: readonly RuleDefinition[],
): Diagnostic[] => {
  if (!rules) return [];
  const known = new Set(effective.map((r) => r.name));
  const out: Diagnostic[] = [];
  for (const key of Object.keys(rules)) {
    if (!known.has(key)) {
      out.push({
        kind: "config.unknownRule",
        message: `Unknown rule "${key}" in config.rules — ignored. Did you forget to add it to customRules?`,
        severity: "warning",
        context: { rule: key },
      });
    }
  }
  return out;
};

const getRuleConfigValue = (
  rules: AactConfig["rules"],
  ruleName: string,
): unknown => rules?.[ruleName];

const runRules = (
  model: Model,
  rules: AactConfig["rules"],
  effective: readonly RuleDefinition[],
): RuleResult[] => {
  const results: RuleResult[] = [];
  for (const rule of effective) {
    const configValue = getRuleConfigValue(rules, rule.name);
    if (configValue === false) continue;
    const options = typeof configValue === "object" ? configValue : undefined;
    results.push({ name: rule.name, violations: rule.check(model, options) });
  }
  return results;
};

interface FixCapabilityResolution {
  readonly capability: FixCapability | null;
  readonly diagnostic?: Diagnostic;
}

const resolveFixCapability = async (
  config: AactConfig,
): Promise<FixCapabilityResolution> => {
  const format = await loadFormat(config.source.type);
  if (!canFix(format)) {
    return {
      capability: null,
      diagnostic: {
        kind: "format.unsupportedFix",
        message: `Format "${format.name}" doesn't support --fix`,
        severity: "warning",
        context: { format: format.name },
      },
    };
  }
  if (config.source.type === "structurizr" && !config.source.writePath) {
    return {
      capability: null,
      diagnostic: {
        kind: "format.missingWritePath",
        message:
          "To use --fix with structurizr, add source.writePath pointing to your workspace.dsl",
        severity: "warning",
      },
    };
  }
  return { capability: format.fix };
};

const generateFixes = (
  model: Model,
  results: readonly RuleResult[],
  rules: AactConfig["rules"],
  syntax: SourceSyntax,
  effective: readonly RuleDefinition[],
): FixResult[] => {
  const ruleByName = new Map(effective.map((r) => [r.name, r]));
  const fixes: FixResult[] = [];
  for (const result of results) {
    if (result.violations.length === 0) continue;
    const ruleDef = ruleByName.get(result.name);
    if (!ruleDef?.fix) continue;
    const configValue = getRuleConfigValue(rules, ruleDef.name);
    const options = typeof configValue === "object" ? configValue : undefined;
    fixes.push(
      ...(ruleDef.fix?.(model, result.violations, syntax, options) ?? []),
    );
  }
  return fixes;
};

const flattenViolations = (
  results: readonly RuleResult[],
  model: Model,
): CheckViolation[] => {
  const out: CheckViolation[] = [];
  for (const result of results) {
    for (const v of result.violations) {
      // Fall back to the element's sourceLocation when the rule
      // didn't set one. Boundary-level rules (cohesion) use the
      // `element` field to carry a boundary name — fall through to
      // `model.boundaries[name]` so those violations are anchored
      // too. Rules that flag a specific relation should set
      // `v.sourceLocation` explicitly for precision.
      const sourceLocation =
        v.sourceLocation ??
        model.elements[v.element]?.sourceLocation ??
        model.boundaries[v.element]?.sourceLocation;
      out.push({
        rule: result.name,
        element: v.element,
        message: v.message,
        severity: "error",
        ...(sourceLocation ? { sourceLocation } : {}),
      });
    }
  }
  return out;
};

const buildSummary = (results: readonly RuleResult[]): CheckSummary => {
  let failed = 0;
  let passed = 0;
  let total = 0;
  for (const r of results) {
    if (r.violations.length === 0) passed += 1;
    else {
      failed += 1;
      total += r.violations.length;
    }
  }
  return { failed, passed, total };
};

interface ApplyFixesResult {
  readonly remaining: number;
  readonly writePath: string;
}

const applyFixes = async (
  config: AactConfig,
  fixes: readonly FixResult[],
  effective: readonly RuleDefinition[],
): Promise<ApplyFixesResult> => {
  const writePath = path.resolve(config.source.writePath ?? config.source.path);
  let source = await readFile(writePath, "utf8");
  for (const fix of fixes) source = applyEdits(source, fix.edits);
  await writeFile(writePath, source, "utf8");

  const isDslFix =
    !!config.source.writePath && config.source.writePath !== config.source.path;
  if (isDslFix) {
    // Cannot re-check Structurizr DSL until user regenerates workspace.json.
    return { remaining: 0, writePath };
  }

  const { model: reModel } = await loadModel(config);
  const reResults = runRules(reModel, config.rules, effective);
  const remaining = reResults.reduce((n, r) => n + r.violations.length, 0);
  return { remaining, writePath };
};

// -----------------------------------------------------------------------------
// Pure executor (testable without citty / process.exit)
// -----------------------------------------------------------------------------

export interface CheckArgs {
  readonly fix?: boolean;
  readonly "dry-run"?: boolean;
}

const resolveMode = (args: CheckArgs): CheckMode => {
  if (args["dry-run"]) return "dry-run";
  if (args.fix) return "fix";
  return "check";
};

const computeExitCode = (
  violationsCount: number,
  fixesApplied: CheckFixesApplied | undefined,
): ExitCode => {
  if (fixesApplied) return fixesApplied.remaining > 0 ? 1 : 0;
  return violationsCount > 0 ? 1 : 0;
};

export const executeCheck = async (
  config: AactConfig,
  args: CheckArgs,
): Promise<ExecuteResult<CheckData>> => {
  const diagnostics: Diagnostic[] = [];
  const effective = buildEffectiveRules(config.customRules);
  diagnostics.push(...collectUnknownRuleDiagnostics(config.rules, effective));

  const { model, issues } = await loadModel(config);
  for (const issue of issues) diagnostics.push(issueToDiagnostic(issue));

  const results = runRules(model, config.rules, effective);
  const violations = flattenViolations(results, model);
  const summary = buildSummary(results);
  const mode = resolveMode(args);

  let suggestedFixes: readonly FixResult[] = [];
  if (violations.length > 0) {
    const fixCap = await resolveFixCapability(config);
    if (fixCap.diagnostic) diagnostics.push(fixCap.diagnostic);
    if (fixCap.capability) {
      suggestedFixes = generateFixes(
        model,
        results,
        config.rules,
        fixCap.capability.syntax,
        effective,
      );
    }
  }

  let fixesApplied: CheckFixesApplied | undefined;
  if (mode === "fix" && suggestedFixes.length > 0) {
    const result = await applyFixes(config, suggestedFixes, effective);
    fixesApplied = {
      count: suggestedFixes.length,
      remaining: result.remaining,
      writePath: result.writePath,
    };
  }

  return {
    data: {
      mode,
      violations,
      suggestedFixes,
      summary,
      ...(fixesApplied ? { fixesApplied } : {}),
    },
    exitCode: computeExitCode(violations.length, fixesApplied),
    diagnostics,
  };
};

// -----------------------------------------------------------------------------
// Text rendering
// -----------------------------------------------------------------------------

const renderGithubAnnotations = (
  data: CheckData,
  sink: NodeJS.WritableStream,
): void => {
  for (const v of data.violations) {
    // GitHub Actions annotation format:
    //   ::error file=<path>,line=<L>,col=<C>,title=<rule>::<msg>
    // Without `file`/`line` the annotation appears only in the
    // workflow log; with them it surfaces as an inline PR comment
    // anchored to the offending byte (`SourceLocation` from Model).
    const loc = v.sourceLocation;
    const locAttrs = loc
      ? `file=${loc.file},line=${loc.start.line},col=${loc.start.col},`
      : "";
    sink.write(
      `::error ${locAttrs}title=${v.rule}::${v.element}: ${v.message}\n`,
    );
  }
};

/**
 * Lint-style violation table, one line per violation:
 *
 *   path/arch.dsl:12:5  error  acl   payments_api: calls external system X
 *   path/arch.dsl:18:1  error  crud  payments_api: directly accesses db_users
 *
 * Columns auto-align by widest cell. The location column is clickable
 * (OSC8) when stdout is a TTY-with-hyperlinks; falls back to plain
 * text in CI / piped output. Violations without `sourceLocation` show
 * a dim `<file>:?:?` placeholder so column alignment stays stable.
 */
const renderViolationsTable = (
  data: CheckData,
  sink: NodeJS.WritableStream,
): void => {
  if (data.violations.length === 0) return;

  // Pre-compute the cells so we can right-align all three columns.
  const rows = data.violations.map((v) => {
    const loc = v.sourceLocation;
    const locText = loc ? formatLocation(loc) : "";
    return {
      locText,
      sourceLocation: loc,
      rule: v.rule,
      element: v.element,
      message: v.message,
    };
  });

  const locWidth = Math.max(...rows.map((r) => r.locText.length), 1);
  const ruleWidth = Math.max(...rows.map((r) => r.rule.length));

  for (const r of rows) {
    // Order: pad → link → color (OSC8 escapes would skew .length).
    const paddedLoc = r.locText.padEnd(locWidth);
    const linked = linkSourceLocation(paddedLoc, r.sourceLocation);
    const locCell = colors.dim(linked);
    const severity = colors.red("error");
    const ruleCell = colors.yellow(r.rule.padEnd(ruleWidth));
    const subject = colors.bold(r.element);
    sink.write(
      `  ${locCell}  ${severity}  ${ruleCell}  ${subject}: ${r.message}\n`,
    );
  }
  sink.write("\n");
};

const renderBoxSummary = (
  data: CheckData,
  fixableCount: number,
  sink: NodeJS.WritableStream,
): void => {
  if (data.summary.total === 0) {
    sink.write(
      box(colors.green("No violations found."), {
        title: colors.green("✓ check"),
        style: { borderColor: "green" },
      }) + "\n",
    );
    return;
  }

  const violationsLabel = data.summary.total === 1 ? "violation" : "violations";
  const rulesLabel = data.summary.failed === 1 ? "rule" : "rules";
  const fixableHas =
    fixableCount === 1 ? "rule has auto-fix" : "rules have auto-fix";
  const fixableLine =
    fixableCount > 0
      ? "\n" + colors.dim(`${fixableCount} ${fixableHas} — run with --fix`)
      : "";
  const headline =
    colors.red(`${data.summary.total} ${violationsLabel}`) +
    " " +
    colors.dim("in") +
    " " +
    colors.red(`${data.summary.failed} ${rulesLabel}`) +
    fixableLine;
  sink.write(
    box(headline, {
      title: colors.red("✗ check"),
      style: { borderColor: "red" },
    }) + "\n",
  );
};

const prefixContent = (content: string, first: string, rest: string): string =>
  content
    .split("\n")
    .map((line, i) => (i === 0 ? first + line : rest + line))
    .join("\n");

const renderFixes = (
  fixes: readonly FixResult[],
  sink: NodeJS.WritableStream,
): void => {
  for (const fix of fixes) {
    const ruleTag = colors.bold(`[${fix.rule}]`);
    sink.write(`  ${ruleTag}  ${fix.description}\n`);
    for (const edit of fix.edits) {
      if (edit.type === "remove") {
        sink.write(
          colors.red(prefixContent(edit.search, "    - ", "      ")) + "\n",
        );
      } else if (edit.type === "replace") {
        sink.write(
          colors.red(prefixContent(edit.search, "    - ", "      ")) + "\n",
        );
        sink.write(
          colors.green(prefixContent(edit.content ?? "", "    + ", "      ")) +
            "\n",
        );
      } else {
        sink.write(colors.dim(`    (after "${edit.search}")\n`));
        sink.write(
          colors.green(prefixContent(edit.content ?? "", "    + ", "      ")) +
            "\n",
        );
      }
    }
    sink.write("\n");
  }
};

/**
 * Text-mode renderer for `aact check`. Branches on GITHUB_ACTIONS env to
 * emit annotation lines (consumed by GitHub Actions Workflow UI) instead of
 * the table when running inside CI. JSON mode is handled by JsonReporter
 * upstream, never reaches this function.
 */
export const renderCheckText: Renderer<CheckData> = (envelope, sink) => {
  const { data } = envelope;

  if (process.env.GITHUB_ACTIONS) {
    renderGithubAnnotations(data, sink);
    return;
  }

  renderViolationsTable(data, sink);

  const fixableRules = new Set(data.suggestedFixes.map((f) => f.rule)).size;
  renderBoxSummary(data, fixableRules, sink);

  if (data.mode === "dry-run" && data.suggestedFixes.length > 0) {
    sink.write(colors.bold("Suggested fixes (dry run):") + "\n\n");
    renderFixes(data.suggestedFixes, sink);
  }

  if (data.fixesApplied) {
    const tail =
      data.fixesApplied.remaining > 0
        ? ` (${data.fixesApplied.remaining} violation(s) remain)`
        : "";
    sink.write(
      colors.green(
        `✔ Applied ${data.fixesApplied.count} fix(es), wrote ${data.fixesApplied.writePath}${tail}\n`,
      ),
    );
  }
};

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

export const check = cliCommandWithConfig({
  name: "check",
  meta: { name: "check", description: "Check architecture rules" },
  args: {
    ...configArg,
    ...jsonArg,
    fix: {
      type: "boolean",
      description: "Apply auto-fixes to the source file",
    },
    "dry-run": {
      type: "boolean",
      description:
        "Show fixes without applying them (exits 1 if violations exist)",
    },
  },
  renderText: renderCheckText,
  execute: (ctx, config) => executeCheck(config, ctx.args as CheckArgs),
});
