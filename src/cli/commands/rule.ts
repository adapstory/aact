import { defineCommand } from "citty";
import { colors } from "consola/utils";

import { ruleRegistry } from "../../rules/registry";
import type { RuleDefinition } from "../../rules/types";
import { loadAndValidateConfig } from "../loadConfig";

interface EffectiveRule {
  readonly rule: RuleDefinition;
  readonly source: "built-in" | "custom";
  readonly enabled: boolean;
}

const buildEffectiveSet = async (): Promise<EffectiveRule[]> => {
  const out: EffectiveRule[] = [];
  let config;
  try {
    config = await loadAndValidateConfig();
  } catch {
    // No config — show built-ins только, all enabled by default
    return ruleRegistry.map((rule) => ({
      rule,
      source: "built-in" as const,
      enabled: true,
    }));
  }

  const rules = config.rules;
  const isEnabled = (name: string): boolean => rules?.[name] !== false;

  for (const rule of ruleRegistry) {
    out.push({ rule, source: "built-in", enabled: isEnabled(rule.name) });
  }
  for (const rule of config.customRules ?? []) {
    out.push({ rule, source: "custom", enabled: isEnabled(rule.name) });
  }
  return out;
};

const listAction = defineCommand({
  meta: { description: "List all effective rules (built-in + custom)" },
  args: {
    json: {
      type: "boolean",
      description: "Output in JSON format",
    },
  },
  async run({ args }) {
    const effective = await buildEffectiveSet();

    if (args.json) {
      console.log(
        JSON.stringify(
          effective.map((e) => ({
            name: e.rule.name,
            description: e.rule.description,
            source: e.source,
            enabled: e.enabled,
            hasFix: typeof e.rule.fix === "function",
          })),
          undefined,
          2,
        ),
      );
      return;
    }

    const groups: Record<"built-in" | "custom", EffectiveRule[]> = {
      "built-in": [],
      custom: [],
    };
    for (const e of effective) groups[e.source].push(e);

    const renderGroup = (label: string, items: EffectiveRule[]): void => {
      if (items.length === 0) return;
      console.log(colors.bold(label));
      const maxName = Math.max(...items.map((i) => i.rule.name.length));
      for (const { rule, enabled } of items) {
        const status = enabled ? colors.green("●") : colors.dim("○");
        const fix = rule.fix ? colors.dim(" [fix]") : "";
        const name = enabled
          ? colors.bold(rule.name.padEnd(maxName))
          : colors.dim(rule.name.padEnd(maxName));
        console.log(
          `  ${status}  ${name}  ${colors.dim(rule.description)}${fix}`,
        );
      }
      console.log();
    };

    renderGroup("Built-in", groups["built-in"]);
    renderGroup("Custom", groups.custom);

    const enabled = effective.filter((e) => e.enabled).length;
    const total = effective.length;
    console.log(
      colors.dim(`${enabled}/${total} rules enabled · ● enabled · ○ disabled`),
    );
  },
});

export const rule = defineCommand({
  meta: { description: "Inspect and manage architecture rules" },
  subCommands: { list: listAction },
});
