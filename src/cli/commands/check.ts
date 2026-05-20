import { readFile, writeFile } from "node:fs/promises";

import { box, colors } from "consola/utils";
import path from "pathe";

import type { AactConfig } from "../../config";
import { loadFormat } from "../../formats/registry";
import type { FixCapability, FormatSyntax } from "../../formats/types";
import { canFix } from "../../formats/types";
import type { Model, SourceLocation } from "../../model";
import { formatLocation } from "../../model";
import { applyEdits, editLocation } from "../../rules/lib/applyEdits";
import { ruleRegistry } from "../../rules/registry";
import type {
  FixResult,
  RelatedLocation,
  RuleDefinition,
  SourceEdit,
  Violation,
} from "../../rules/types";
import { issueToDiagnostic, loadModel } from "../loadModel";
import type { Diagnostic, ExitCode, Renderer } from "../output";
import { linkSourceLocation } from "../output/hyperlinks";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg, sarifArg } from "../sharedArgs";
import { checkSarifAdapter } from "./checkSarif";

/** Built-in rule names, indexed once — used by `buildRuleCatalogue`
 *  to tag each effective rule as `"built-in"` or `"custom"` without
 *  rebuilding the Set per call. `ruleRegistry` is static so the
 *  Set is safe at module scope. */
const BUILTIN_RULE_NAMES: ReadonlySet<string> = new Set(
  ruleRegistry.map((r) => r.name),
);

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact check`)
// -----------------------------------------------------------------------------

export interface CheckViolation {
  readonly rule: string;
  /** Name of the offending node — points into `model.elements` or
   *  `model.boundaries` depending on `targetKind`. */
  readonly target: string;
  readonly targetKind: "element" | "boundary";
  readonly message: string;
  /** v1: always "error". Per-rule severity will be additive in a future bump. */
  readonly severity: "error";
  /**
   * Optional location of the offending construct in source. Populated
   * either from `Violation.sourceLocation` if the rule set it
   * explicitly, or by looking up
   * `model.elements[v.target].sourceLocation` as fallback. Carried
   * in the JSON envelope for agents; text mode wraps it in a
   * per-terminal OSC 8 hyperlink via `linkSourceLocation` so the
   * file:line:col anchor is Cmd-clickable in VSCode / Cursor /
   * Zed / Ghostty / iTerm2 / WezTerm / Kitty.
   */
  readonly sourceLocation?: SourceLocation;
  /**
   * Secondary anchors that give context for the primary
   * `sourceLocation`. For `dbPerService` the primary anchor is the
   * DB declaration ("this DB has too many owners") and
   * `relatedLocations` lists each accessor edge so the consumer
   * sees *who* the owners are without re-reading the source.
   * Maps to SARIF v2.1.0 `result.relatedLocations[]`; rendered in
   * text mode as indented `↳ <message>: <path>:<line>:<col>` rows.
   */
  readonly relatedLocations?: readonly RelatedLocation[];
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

/**
 * Per-rule metadata bundled into every `check --json` envelope so
 * agents and other consumers don't need a separate `aact rule list`
 * call to know what each `ruleId` in `violations[]` means or
 * whether it offers an auto-fix.
 *
 * `source` distinguishes built-in rules (shipped with aact) from
 * `customRules` registered via `aact.config.ts`. `enabled` reflects
 * the effective config (false when `rules.<name>: false`).
 */
export interface CheckRuleMetadata {
  readonly name: string;
  readonly description: string;
  readonly source: "built-in" | "custom";
  readonly enabled: boolean;
  readonly hasFix: boolean;
  readonly helpUri?: string;
}

export interface CheckData {
  readonly mode: CheckMode;
  readonly violations: readonly CheckViolation[];
  readonly suggestedFixes: readonly FixResult[];
  readonly summary: CheckSummary;
  readonly rules: readonly CheckRuleMetadata[];
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

const AACT_INFO_URI = "https://github.com/Byndyusoft/aact";

const buildRuleCatalogue = (
  rules: AactConfig["rules"],
  effective: readonly RuleDefinition[],
): readonly CheckRuleMetadata[] =>
  effective.map((r) => {
    const isBuiltin = BUILTIN_RULE_NAMES.has(r.name);
    return {
      name: r.name,
      description: r.description,
      source: isBuiltin ? "built-in" : "custom",
      enabled: getRuleConfigValue(rules, r.name) !== false,
      hasFix: typeof r.fix === "function",
      // Built-ins link to upstream README anchors; custom rules can
      // surface their own helpUri later if `RuleDefinition` grows one.
      ...(isBuiltin ? { helpUri: `${AACT_INFO_URI}#${r.name}` } : {}),
    };
  });

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
  syntax: FormatSyntax,
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
      ...(ruleDef.fix?.({
        model,
        violations: result.violations,
        syntax,
        options,
      }) ?? []),
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
      // Anchor on the rule-set location if present; otherwise look
      // up the target node by kind. `targetKind` removes the old
      // "try both maps" guess that boundary-level rules used to
      // depend on.
      const fallbackLoc =
        v.targetKind === "element"
          ? model.elements[v.target]?.sourceLocation
          : model.boundaries[v.target]?.sourceLocation;
      const sourceLocation = v.sourceLocation ?? fallbackLoc;
      out.push({
        rule: result.name,
        target: v.target,
        targetKind: v.targetKind,
        message: v.message,
        severity: "error",
        ...(sourceLocation ? { sourceLocation } : {}),
        ...(v.relatedLocations && v.relatedLocations.length > 0
          ? { relatedLocations: v.relatedLocations }
          : {}),
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
  readonly conflictDiagnostics: readonly Diagnostic[];
}

const applyFixes = async (
  config: AactConfig,
  fixes: readonly FixResult[],
  effective: readonly RuleDefinition[],
): Promise<ApplyFixesResult> => {
  const writePath = path.resolve(config.source.writePath ?? config.source.path);
  const source = await readFile(writePath, "utf8");

  // Pool every edit from every fix into one batch — the range-based
  // applier resolves offset conflicts globally (reverse-order splice)
  // instead of running each fix sequentially on the already-mutated
  // string, which would invalidate the source ranges of later fixes.
  const allEdits = fixes.flatMap((f) => f.edits);
  const { content, conflicts } = applyEdits(source, allEdits);

  // Conflicts mean two fix edits wanted overlapping source ranges. The
  // applier kept the first one (deterministic), but the user needs
  // to know we silently dropped the second — otherwise `--fix`
  // becomes a "wrote the file but some rules didn't land" trap.
  // Surfacing as warning rather than error keeps the loop usable
  // (re-running `check` either re-emits the dropped fix or shows
  // the rule's been resolved by the kept edit).
  const conflictDiagnostics: Diagnostic[] = conflicts.map((c) => {
    const keptLoc = editLocation(c.conflictsWith);
    const skippedLoc = editLocation(c.skipped);
    return {
      kind: "fix.editConflict",
      message: `Skipped overlapping fix edit: kept ${c.conflictsWith.kind} at ${formatLocation(keptLoc)}, dropped ${c.skipped.kind} at ${formatLocation(skippedLoc)}. Re-run \`aact check --fix\` after reviewing the partial result.`,
      severity: "warning",
      context: {
        kept: c.conflictsWith.kind,
        keptAt: formatLocation(keptLoc),
        skipped: c.skipped.kind,
        skippedAt: formatLocation(skippedLoc),
      },
    };
  });

  await writeFile(writePath, content, "utf8");

  const isDslFix =
    !!config.source.writePath && config.source.writePath !== config.source.path;
  if (isDslFix) {
    // Cannot re-check Structurizr DSL until user regenerates workspace.json.
    return { remaining: 0, writePath, conflictDiagnostics };
  }

  const { model: reModel } = await loadModel(config);
  const reResults = runRules(reModel, config.rules, effective);
  const remaining = reResults.reduce((n, r) => n + r.violations.length, 0);
  return { remaining, writePath, conflictDiagnostics };
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
    // Surface every edit conflict — silent drops here would defeat
    // the whole point of moving from string-matching to range-based
    // edits. Each conflict is its own diagnostic so the user can see
    // exactly what landed and what didn't.
    diagnostics.push(...result.conflictDiagnostics);
  }

  const ruleCatalogue = buildRuleCatalogue(config.rules, effective);

  return {
    data: {
      mode,
      violations,
      suggestedFixes,
      summary,
      rules: ruleCatalogue,
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
    // anchored to the offending position (`SourceLocation` from Model).
    const loc = v.sourceLocation;
    const locAttrs = loc
      ? `file=${loc.file},line=${loc.start.line},col=${loc.start.col},`
      : "";
    sink.write(
      `::error ${locAttrs}title=${v.rule}::${v.target}: ${v.message}\n`,
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
      target: v.target,
      message: v.message,
      relatedLocations: v.relatedLocations,
    };
  });

  const locWidth = Math.max(...rows.map((r) => r.locText.length), 1);
  const ruleWidth = Math.max(...rows.map((r) => r.rule.length));

  for (const r of rows) {
    // Order: pad → link → color (OSC 8 escapes would skew .length).
    // linkSourceLocation reads AACT_FILE_OPENER env to pick the
    // URL scheme — see src/cli/output/hyperlinks.ts for the
    // per-terminal logic.
    const paddedLoc = r.locText.padEnd(locWidth);
    const linked = linkSourceLocation(paddedLoc, r.sourceLocation);
    const locCell = colors.dim(linked);
    const severity = colors.red("error");
    const ruleCell = colors.yellow(r.rule.padEnd(ruleWidth));
    const subject = colors.bold(r.target);
    sink.write(
      `  ${locCell}  ${severity}  ${ruleCell}  ${subject}: ${r.message}\n`,
    );

    // Related locations — indented `↳ <label>: <file>:<line>:<col>`
    // rows under the primary anchor. Each is independently
    // Cmd-clickable. Gives the consumer the *context* of the
    // violation (accessors, targets, cycle edges) without
    // re-reading source.
    if (r.relatedLocations && r.relatedLocations.length > 0) {
      const indent = " ".repeat(locWidth + 2);
      for (const rel of r.relatedLocations) {
        const relText = formatLocation(rel.sourceLocation);
        const relLink = linkSourceLocation(relText, rel.sourceLocation);
        const label = rel.message ? `${rel.message}: ` : "";
        const arrow = `↳ ${label}${relLink}`;
        sink.write(`  ${indent}${colors.dim(arrow)}\n`);
      }
    }
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

const renderEdit = (edit: SourceEdit, sink: NodeJS.WritableStream): void => {
  switch (edit.kind) {
    case "remove": {
      sink.write(
        colors.dim(
          `    - remove ${formatLocation(edit.range)} (${editByteSpan(edit.range)} bytes)\n`,
        ),
      );
      break;
    }
    case "replace": {
      sink.write(colors.dim(`    ~ replace ${formatLocation(edit.range)}\n`));
      sink.write(
        colors.green(prefixContent(edit.content, "    + ", "      ")) + "\n",
      );
      break;
    }
    case "insert-after": {
      sink.write(
        colors.dim(`    + insert after ${formatLocation(edit.anchor)}\n`),
      );
      sink.write(
        colors.green(prefixContent(edit.content, "    + ", "      ")) + "\n",
      );
      break;
    }
    case "insert-before": {
      sink.write(
        colors.dim(`    + insert before ${formatLocation(edit.anchor)}\n`),
      );
      sink.write(
        colors.green(prefixContent(edit.content, "    + ", "      ")) + "\n",
      );
      break;
    }
  }
};

const editByteSpan = (range: SourceLocation): number =>
  range.end.offset - range.start.offset;

const renderFixes = (
  fixes: readonly FixResult[],
  sink: NodeJS.WritableStream,
): void => {
  for (const fix of fixes) {
    const ruleTag = colors.bold(`[${fix.rule}]`);
    sink.write(`  ${ruleTag}  ${fix.description}\n`);
    for (const edit of fix.edits) renderEdit(edit, sink);
    sink.write("\n");
  }
};

export type CheckTextMode = "human" | "github-actions";

const detectCheckTextMode = (): CheckTextMode =>
  process.env.GITHUB_ACTIONS ? "github-actions" : "human";

/**
 * Text-mode renderer for `aact check`. The `mode` parameter selects either
 * the human table (default for local terminals) or GitHub Actions
 * annotation lines (consumed by the Workflow UI). The default reads
 * `GITHUB_ACTIONS` from the env so production calls keep working without
 * threading mode through every layer; tests pass it explicitly. JSON mode
 * is handled by JsonReporter upstream, never reaches this function.
 */
export const renderCheckText = (
  envelope: Parameters<Renderer<CheckData>>[0],
  sink: Parameters<Renderer<CheckData>>[1],
  mode: CheckTextMode = detectCheckTextMode(),
): void => {
  const { data } = envelope;

  if (mode === "github-actions") {
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
    ...sarifArg,
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
  sarifAdapter: checkSarifAdapter,
  execute: (ctx, config) => executeCheck(config, ctx.args as CheckArgs),
});
