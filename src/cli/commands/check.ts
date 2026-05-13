import { readFile, writeFile } from "node:fs/promises";

import { defineCommand } from "citty";
import consola from "consola";
import { box, colors } from "consola/utils";
import path from "pathe";

import type { AactConfig } from "../../config";
import { loadFormat } from "../../formats/registry";
import type { FixCapability, SourceSyntax } from "../../formats/types";
import { canFix } from "../../formats/types";
import type { Model } from "../../model";
import { applyEdits } from "../../rules/lib/applyEdits";
import { ruleRegistry } from "../../rules/registry";
import type { FixResult, RuleDefinition, Violation } from "../../rules/types";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

// eslint-disable-next-line n/no-process-exit
const exitWithViolations = (): never => process.exit(1);

interface RuleResult {
  readonly name: string;
  readonly violations: readonly Violation[];
}

/**
 * Build merged registry from built-ins + customRules. Conflicts (custom rule
 * shares name with built-in или с другим custom) — activation error, никакого
 * silent override. Это force'ит namespace discipline для plugin authors —
 * prefix unique (adapstoryBffBoundary, mermaidLegend etc.).
 */
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

/**
 * Warn on rule names в `config.rules` которые не зарегистрированы (built-in
 * или custom). Backward-safe — typo не падает CLI, просто игнорируется
 * с явным сообщением.
 */
const warnUnknownRuleNames = (
  rules: AactConfig["rules"],
  effective: readonly RuleDefinition[],
): void => {
  if (!rules) return;
  const known = new Set(effective.map((r) => r.name));
  for (const key of Object.keys(rules)) {
    if (!known.has(key)) {
      consola.warn(
        `Unknown rule "${key}" in config.rules — ignored. ` +
          `Did you forget to add it to customRules?`,
      );
    }
  }
};

const getRuleConfigValue = (
  rules: AactConfig["rules"],
  ruleName: string,
): unknown => (rules)?.[ruleName];

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

const resolveFixCapability = async (
  config: AactConfig,
): Promise<FixCapability | null> => {
  const format = await loadFormat(config.source.type);
  if (!canFix(format)) {
    consola.warn(`Format "${format.name}" doesn't support --fix`);
    return null;
  }
  if (config.source.type === "structurizr" && !config.source.writePath) {
    consola.warn(
      "To use --fix with structurizr, add source.writePath pointing to your workspace.dsl",
    );
    return null;
  }
  return format.fix;
};

// Fixes from all enabled rules are collected in registry order and applied
// to the source as a single batch. Model is not re-checked between rules.
const generateFixes = (
  model: Model,
  results: RuleResult[],
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

const formatText = (
  results: readonly RuleResult[],
  effective: readonly RuleDefinition[],
): void => {
  const failed = results.filter((r) => r.violations.length > 0);
  const passed = results.filter((r) => r.violations.length === 0);

  for (const result of failed) {
    const count = result.violations.length;
    const label = count === 1 ? "violation" : "violations";
    const countLabel = colors.red(`${count} ${label}`);
    console.log(`${colors.bold(colors.red(result.name))}  ${countLabel}`);

    const maxLen = Math.max(
      ...result.violations.map((v) => v.container.length),
    );
    for (const v of result.violations) {
      console.log(`  ${colors.bold(v.container.padEnd(maxLen))}  ${v.message}`);
    }
    console.log();
  }

  if (passed.length > 0) {
    console.log(
      `${colors.dim("Passed")}  ${passed.map((r) => colors.green(r.name)).join(colors.dim(" · "))}`,
    );
    console.log();
  }

  const total = failed.reduce((n, r) => n + r.violations.length, 0);
  if (total === 0) {
    console.log(
      box(colors.green("No violations found."), {
        title: colors.green("✓ check"),
        style: { borderColor: "green" },
      }),
    );
    return;
  }

  const fixableRules = failed.filter(
    (r) =>
      typeof effective.find((rd) => rd.name === r.name)?.fix === "function",
  ).length;
  const violationsLabel = total === 1 ? "violation" : "violations";
  const rulesLabel = failed.length === 1 ? "rule" : "rules";
  const fixableHas =
    fixableRules === 1 ? "rule has auto-fix" : "rules have auto-fix";
  const fixableLine =
    fixableRules > 0
      ? "\n" + colors.dim(`${fixableRules} ${fixableHas} — run with --fix`)
      : "";
  const headline =
    colors.red(`${total} ${violationsLabel}`) +
    " " +
    colors.dim("in") +
    " " +
    colors.red(`${failed.length} ${rulesLabel}`) +
    fixableLine;
  console.log(
    box(headline, {
      title: colors.red("✗ check"),
      style: { borderColor: "red" },
    }),
  );
};

const formatJson = (results: readonly RuleResult[]): void => {
  const output = {
    results: results.map((r) => ({
      rule: r.name,
      passed: r.violations.length === 0,
      violations: r.violations,
    })),
  };
  console.log(JSON.stringify(output, undefined, 2));
};

const formatGithub = (results: readonly RuleResult[]): void => {
  for (const result of results) {
    for (const v of result.violations) {
      console.log(`::error title=${result.name}::${v.container}: ${v.message}`);
    }
  }
};

const prefixContent = (content: string, first: string, rest: string): string =>
  content
    .split("\n")
    .map((line, i) => (i === 0 ? first + line : rest + line))
    .join("\n");

const formatFixes = (fixes: readonly FixResult[]): void => {
  for (const fix of fixes) {
    const ruleTag = colors.bold(`[${fix.rule}]`);
    console.log(`  ${ruleTag}  ${fix.description}`);
    for (const edit of fix.edits) {
      switch (edit.type) {
        case "remove": {
          console.log(
            colors.red(prefixContent(edit.search, "    - ", "      ")),
          );
          break;
        }
        case "replace": {
          console.log(
            colors.red(prefixContent(edit.search, "    - ", "      ")),
          );
          console.log(
            colors.green(prefixContent(edit.content ?? "", "    + ", "      ")),
          );
          break;
        }
        case "add": {
          console.log(colors.dim(`    (after "${edit.search}")`));
          console.log(
            colors.green(prefixContent(edit.content ?? "", "    + ", "      ")),
          );
          break;
        }
      }
    }
    console.log();
  }
};

const detectFormat = (format?: string): string => {
  if (format) return format;
  if (process.env.GITHUB_ACTIONS) return "github";
  return "text";
};

const formatResults = (
  results: readonly RuleResult[],
  format: string,
  effective: readonly RuleDefinition[],
): void => {
  switch (format) {
    case "json": {
      formatJson(results);
      break;
    }
    case "github": {
      formatGithub(results);
      break;
    }
    default: {
      formatText(results, effective);
    }
  }
};

const writeFixes = async (
  config: AactConfig,
  fixes: readonly FixResult[],
  effective: readonly RuleDefinition[],
): Promise<void> => {
  const writePath = path.resolve(config.source.writePath ?? config.source.path);
  let source = await readFile(writePath, "utf8");
  for (const fix of fixes) {
    source = applyEdits(source, fix.edits);
  }
  await writeFile(writePath, source, "utf8");

  const isDslFix =
    config.source.writePath && config.source.writePath !== config.source.path;

  if (isDslFix) {
    consola.success(`Applied ${fixes.length} fix(es), wrote ${writePath}`);
    consola.warn(
      "DSL updated — regenerate workspace.json from workspace.dsl before re-checking",
    );
  } else {
    const { model: reModel } = await loadModel(config);
    const reResults = runRules(reModel, config.rules, effective);
    const remaining = reResults.reduce((n, r) => n + r.violations.length, 0);
    consola.success(
      `Applied ${fixes.length} fix(es), wrote ${writePath}` +
        (remaining > 0 ? ` (${remaining} violation(s) remain)` : ""),
    );
  }
};

const handleFixMode = async (
  model: Model,
  results: RuleResult[],
  config: AactConfig,
  dryRun: boolean,
  effective: readonly RuleDefinition[],
): Promise<void> => {
  const hasViolations = results.some((r) => r.violations.length > 0);
  if (!hasViolations) {
    consola.success("No violations to fix");
    return;
  }

  const fixCapability = await resolveFixCapability(config);
  if (!fixCapability) return exitWithViolations();

  const fixes = generateFixes(
    model,
    results,
    config.rules,
    fixCapability.syntax,
    effective,
  );
  if (fixes.length === 0) {
    consola.info("No auto-fixes available for these violations");
    exitWithViolations();
  }

  console.log(
    colors.bold(dryRun ? "Suggested fixes (dry run):" : "Applying fixes:"),
  );
  console.log();
  formatFixes(fixes);
  console.log();

  if (!dryRun) {
    await writeFixes(config, fixes, effective);
  }
};

const suggestFixes = async (
  model: Model,
  results: readonly RuleResult[],
  config: AactConfig,
  effective: readonly RuleDefinition[],
): Promise<void> => {
  const fixCapability = await resolveFixCapability(config);
  if (!fixCapability) return;
  const fixes = generateFixes(
    model,
    [...results],
    config.rules,
    fixCapability.syntax,
    effective,
  );
  if (fixes.length > 0) {
    console.log(colors.bold("Suggested fixes:"));
    console.log();
    formatFixes(fixes);
  }
};

export const check = defineCommand({
  meta: { description: "Check architecture rules" },
  args: {
    config: {
      type: "string",
      description: "Path to aact config file",
    },
    format: {
      type: "string",
      description: "Output format: text, json, github",
    },
    fix: {
      type: "boolean",
      description: "Apply auto-fixes to the source file",
    },
    "dry-run": {
      type: "boolean",
      description: "Show fixes without applying them",
    },
  },
  async run({ args }) {
    const config = await loadAndValidateConfig(args.config);
    const effective = buildEffectiveRules(config.customRules);
    warnUnknownRuleNames(config.rules, effective);

    const { model, issues } = await loadModel(config);

    // Surface loader-time issues (dangling refs, duplicate names, etc.)
    for (const issue of issues) {
      consola.warn(`model: ${issue.kind}`, issue);
    }

    const results = runRules(model, config.rules, effective);
    formatResults(results, detectFormat(args.format), effective);

    const hasViolations = results.some((r) => r.violations.length > 0);

    if (args.fix || args["dry-run"]) {
      await handleFixMode(
        model,
        results,
        config,
        args["dry-run"] ?? false,
        effective,
      );
      return;
    }

    if (hasViolations) {
      await suggestFixes(model, results, config, effective);
      exitWithViolations();
    }
  },
});
