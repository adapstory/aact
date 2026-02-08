import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadConfig } from "c12";
import { defineCommand } from "citty";
import consola from "consola";

import type { AactConfig } from "../../config";
import type { ArchitectureModel } from "../../model";
import type { AclOptions, Violation } from "../../rules/acl";
import type { DbPerServiceOptions } from "../../rules/dbPerService";
import type { FixResult, SourceSyntax } from "../../rules/fix";
import { plantumlSyntax } from "../../loaders/plantuml/syntax";
import { checkAcl } from "../../rules/acl";
import { checkAcyclic } from "../../rules/acyclic";
import { checkCohesion } from "../../rules/cohesion";
import { checkCrud } from "../../rules/crud";
import { checkDbPerService } from "../../rules/dbPerService";
import { applyEdits } from "../../rules/fix";
import { fixAcl } from "../../rules/fixAcl";
import { fixDbPerService } from "../../rules/fixDbPerService";
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

  if (rules?.acl !== false) {
    const options = typeof rules?.acl === "object" ? rules.acl : undefined;
    results.push({
      name: "acl",
      violations: checkAcl(model.allContainers, options),
    });
  }

  if (rules?.acyclic !== false) {
    results.push({
      name: "acyclic",
      violations: checkAcyclic(model.allContainers),
    });
  }

  if (rules?.crud !== false) {
    const options = typeof rules?.crud === "object" ? rules.crud : undefined;
    results.push({
      name: "crud",
      violations: checkCrud(model.allContainers, options),
    });
  }

  if (rules?.dbPerService !== false) {
    const options =
      typeof rules?.dbPerService === "object"
        ? rules.dbPerService
        : undefined;
    results.push({
      name: "dbPerService",
      violations: checkDbPerService(model.allContainers, options),
    });
  }

  if (rules?.cohesion !== false) {
    const options =
      typeof rules?.cohesion === "object" ? rules.cohesion : undefined;
    results.push({
      name: "cohesion",
      violations: checkCohesion(model, options),
    });
  }

  return results;
};

const getSyntax = (sourceType: string): SourceSyntax => {
  switch (sourceType) {
    case "plantuml":
      return plantumlSyntax;
    default:
      throw new Error(`Write-back not supported for ${sourceType}`);
  }
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

    switch (result.name) {
      case "dbPerService": {
        const options =
          typeof rules?.dbPerService === "object"
            ? (rules.dbPerService as DbPerServiceOptions)
            : undefined;
        fixes.push(
          ...fixDbPerService(model, result.violations, syntax, options),
        );
        break;
      }
      case "acl": {
        const options =
          typeof rules?.acl === "object"
            ? (rules.acl as AclOptions)
            : undefined;
        fixes.push(...fixAcl(model, result.violations, syntax, options));
        break;
      }
    }
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
  async run({ args }) {
    const { config } = await loadConfig<AactConfig>({ name: "aact" });
    if (!config?.source) {
      throw new Error("No source configured. Create an aact.config.ts file.");
    }

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

      const sourcePath = resolve(config.source.path);
      let source = await readFile(sourcePath, "utf-8");

      for (const fix of fixes) {
        source = applyEdits(source, fix.edits);
      }

      await writeFile(sourcePath, source, "utf-8");

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
