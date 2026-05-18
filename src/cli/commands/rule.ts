import { defineCommand } from "citty";
import { colors } from "consola/utils";

import type { AactConfig } from "../../config";
import { ruleRegistry } from "../../rules/registry";
import { loadAndValidateConfig } from "../loadConfig";
import type { Renderer } from "../output";
import { ToolError } from "../output";
import type { ExecuteResult } from "../run";
import { cliCommand } from "../run";
import { configArg, jsonArg } from "../sharedArgs";

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact rule list`)
// -----------------------------------------------------------------------------

export interface RuleInfo {
  readonly name: string;
  readonly description: string;
  readonly source: "built-in" | "custom";
  readonly enabled: boolean;
  readonly hasFix: boolean;
}

export interface RuleListSummary {
  readonly enabled: number;
  readonly total: number;
}

export interface RuleListData {
  readonly rules: readonly RuleInfo[];
  readonly summary: RuleListSummary;
}

// -----------------------------------------------------------------------------
// Pure executor
// -----------------------------------------------------------------------------

export interface RuleListArgs {
  readonly config?: string;
}

const isEnabled = (rules: AactConfig["rules"], name: string): boolean =>
  rules?.[name] !== false;

const collectRules = (config: AactConfig | null): RuleInfo[] => {
  const out: RuleInfo[] = [];
  for (const rule of ruleRegistry) {
    out.push({
      name: rule.name,
      description: rule.description,
      source: "built-in",
      enabled: isEnabled(config?.rules, rule.name),
      hasFix: typeof rule.fix === "function",
    });
  }
  for (const rule of config?.customRules ?? []) {
    out.push({
      name: rule.name,
      description: rule.description,
      source: "custom",
      enabled: isEnabled(config?.rules, rule.name),
      hasFix: typeof rule.fix === "function",
    });
  }
  return out;
};

/**
 * Loads config if present, ignores `config.missingSource` (built-ins-only
 * fallback) but re-throws every other ToolError so a broken/corrupted
 * config surfaces as exit 2 instead of silently hiding behind built-ins.
 */
const loadConfigOptional = async (
  configPath: string | undefined,
): Promise<AactConfig | null> => {
  try {
    return await loadAndValidateConfig(configPath);
  } catch (error) {
    if (error instanceof ToolError && error.kind === "config.missingSource") {
      return null;
    }
    throw error;
  }
};

export const executeRuleList = async (
  args: RuleListArgs,
): Promise<ExecuteResult<RuleListData>> => {
  const config = await loadConfigOptional(args.config);
  const rules = collectRules(config);
  const enabled = rules.filter((r) => r.enabled).length;
  return {
    data: { rules, summary: { enabled, total: rules.length } },
    exitCode: 0,
  };
};

// -----------------------------------------------------------------------------
// Text rendering — mirrors current grouped table output
// -----------------------------------------------------------------------------

const renderGroup = (
  label: string,
  items: readonly RuleInfo[],
  sink: NodeJS.WritableStream,
): void => {
  if (items.length === 0) return;
  sink.write(colors.bold(label) + "\n");
  const maxName = Math.max(...items.map((i) => i.name.length));
  for (const rule of items) {
    const status = rule.enabled ? colors.green("●") : colors.dim("○");
    const fix = rule.hasFix ? colors.dim(" [fix]") : "";
    const name = rule.enabled
      ? colors.bold(rule.name.padEnd(maxName))
      : colors.dim(rule.name.padEnd(maxName));
    sink.write(`  ${status}  ${name}  ${colors.dim(rule.description)}${fix}\n`);
  }
  sink.write("\n");
};

export const renderRuleListText: Renderer<RuleListData> = (envelope, sink) => {
  const { data } = envelope;
  const builtIns = data.rules.filter((r) => r.source === "built-in");
  const customs = data.rules.filter((r) => r.source === "custom");

  renderGroup("Built-in", builtIns, sink);
  renderGroup("Custom", customs, sink);

  sink.write(
    colors.dim(
      `${data.summary.enabled}/${data.summary.total} rules enabled · ● enabled · ○ disabled\n`,
    ),
  );
};

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

const listAction = cliCommand({
  name: "rule list",
  meta: { description: "List all effective rules (built-in + custom)" },
  args: { ...configArg, ...jsonArg },
  renderText: renderRuleListText,
  execute: (ctx) => executeRuleList(ctx.args as RuleListArgs),
});

export const rule = defineCommand({
  meta: { description: "Inspect and manage architecture rules" },
  subCommands: { list: listAction },
});
