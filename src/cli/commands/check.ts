import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";
import consola from "consola";

import type { AactConfig } from "../../config";
import { plantumlSyntax } from "../../loaders/plantuml/syntax";
import type { ArchitectureModel } from "../../model";
import type { FixResult, SourceSyntax } from "../../rules/fix";
import { applyEdits } from "../../rules/fix";
import { ruleRegistry } from "../../rules/registry";
import type { Violation } from "../../rules/types";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

interface RuleResult {
  name: string;
  violations: Violation[];
}

const runRules = (
  model: ArchitectureModel,
  rules: AactConfig["rules"],
): RuleResult[] => {
  const results: RuleResult[] = [];

  for (const rule of ruleRegistry) {
    const configValue = rules?.[rule.name as keyof typeof rules];
    if (configValue === false) continue;
    const options = typeof configValue === "object" ? configValue : undefined;
    results.push({ name: rule.name, violations: rule.check(model, options) });
  }

  return results;
};

const getSyntax = (sourceType: string): SourceSyntax => {
  if (sourceType === "plantuml") {
    return plantumlSyntax;
  }
  throw new Error(`Write-back not supported for ${sourceType}`);
};

const generateFixes = (
  model: ArchitectureModel,
  results: RuleResult[],
  rules: AactConfig["rules"],
  syntax: SourceSyntax,
): FixResult[] => {
  const fixes: FixResult[] = [];

  for (const result of results) {
    if (result.violations.length === 0) continue;
    const ruleDef = ruleRegistry.find((r) => r.name === result.name);
    if (!ruleDef?.fix) continue;
    const configValue = rules?.[ruleDef.name as keyof typeof rules];
    const options = typeof configValue === "object" ? configValue : undefined;
    fixes.push(...ruleDef.fix(model, result.violations, syntax, options));
  }

  return fixes;
};

const formatText = (results: RuleResult[]): void => {
  for (const result of results) {
    if (result.violations.length === 0) {
      consola.success(`${result.name} — passed`);
    } else {
      consola.error(
        `${result.name} — ${result.violations.length} violation(s)`,
      );
      for (const v of result.violations) {
        consola.log(`  ${v.container}: ${v.message}`);
      }
    }
  }
};

const formatJson = (results: RuleResult[]): void => {
  const output = {
    results: results.map((r) => ({
      rule: r.name,
      passed: r.violations.length === 0,
      violations: r.violations,
    })),
  };
  console.log(JSON.stringify(output, undefined, 2));
};

const formatGithub = (results: RuleResult[]): void => {
  for (const result of results) {
    for (const v of result.violations) {
      console.log(`::error title=${result.name}::${v.container}: ${v.message}`);
    }
  }
};

const formatFixes = (fixes: FixResult[]): void => {
  for (const fix of fixes) {
    consola.info(`[${fix.rule}] ${fix.description}`);
    for (const edit of fix.edits) {
      switch (edit.type) {
        case "remove": {
          consola.log(`  - ${edit.search}`);
          break;
        }
        case "replace": {
          consola.log(`  - ${edit.search}`);
          consola.log(`  + ${edit.content}`);
          break;
        }
        case "add": {
          consola.log(`  (after "${edit.search}")`);
          consola.log(`  + ${edit.content}`);
          break;
        }
      }
    }
  }
};

const detectFormat = (format?: string): string => {
  if (format) return format;
  if (process.env.GITHUB_ACTIONS) return "github";
  return "text";
};

export const check = defineCommand({
  meta: { description: "Check architecture rules" },
  args: {
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
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async run({ args }) {
    const config = await loadAndValidateConfig();
    const model = await loadModel(config);
    const results = runRules(model, config.rules);
    const format = detectFormat(args.format);

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
        formatText(results);
      }
    }

    const hasViolations = results.some((r) => r.violations.length > 0);

    if (args.fix || args["dry-run"]) {
      if (!hasViolations) {
        consola.success("No violations to fix");
        return;
      }

      const syntax = getSyntax(config.source.type);
      const fixes = generateFixes(model, results, config.rules, syntax);
      if (fixes.length === 0) {
        consola.info("No auto-fixes available for these violations");
        if (hasViolations) {
          throw new Error("Architecture rule violations found");
        }
        return;
      }

      formatFixes(fixes);

      if (args["dry-run"]) {
        return;
      }

      const sourcePath = path.resolve(config.source.path);
      let source = await readFile(sourcePath, "utf8");

      for (const fix of fixes) {
        source = applyEdits(source, fix.edits);
      }

      await writeFile(sourcePath, source, "utf8");

      const reModel = await loadModel(config);
      const reResults = runRules(reModel, config.rules);
      const remaining = reResults.reduce((n, r) => n + r.violations.length, 0);

      consola.success(
        `Applied ${fixes.length} fix(es), wrote ${sourcePath}` +
          (remaining > 0 ? ` (${remaining} violation(s) remain)` : ""),
      );
      return;
    }

    if (hasViolations) {
      try {
        const syntax = getSyntax(config.source.type);
        const fixes = generateFixes(model, results, config.rules, syntax);
        if (fixes.length > 0) {
          consola.info("Suggested fixes (run with --fix to apply):");
          formatFixes(fixes);
        }
      } catch {
        // write-back not supported for this source type — skip suggestions
      }
      throw new Error("Architecture rule violations found");
    }
  },
});
