import { defineCommand } from "citty";

import type { DiffData, DiffOptions } from "../../../diff";
import { computeDiff } from "../../../diff";
import { loadAndValidateConfig } from "../../loadConfig";
import type { Reporter } from "../../output";
import {
  buildEnvelope,
  buildErrorEnvelope,
  HumanReporter,
  JsonReporter,
  ToolError,
} from "../../output";
import { exitWith, readJsonFlag } from "../../run";
import { configArg, jsonArg } from "../../sharedArgs";
import { loadBaseline } from "./baseline";
import { renderDiffText } from "./textRenderer";

/**
 * `aact diff <baseline> [<current>]` — structural diff between two
 * normalized Models. Designed for PR review: agents and humans see
 * what architecturally changed, not what bytes shifted in the
 * source file.
 *
 * Inputs:
 *  - file path (`.puml`, `.dsl`, `.aact.json`)
 *  - git ref (`main:architecture.puml`)
 *  - stdin (`-` with `--baseline-format` / `--current-format`)
 *
 * `current` defaults to the configured source from `aact.config.ts`
 * when omitted — same as every other read-only command.
 *
 * Exit codes:
 *  - 0 — no diff (or only cosmetic without `--strict`)
 *  - 1 — structural / semantic diff (or cosmetic with `--strict`)
 *  - 2 — tool error (baseline missing, parse failure, …)
 */

interface DiffArgs {
  readonly baseline: string;
  readonly current?: string;
  readonly "baseline-format"?: string;
  readonly "current-format"?: string;
  readonly strict?: boolean;
  readonly "with-patch"?: boolean;
  readonly "rename-threshold"?: number | string;
  readonly "no-rename-detection"?: boolean;
  readonly config?: string;
}

/**
 * Resolve `current` argument with config fallback:
 *  - Explicit CLI arg wins; no config load needed.
 *  - Otherwise load `aact.config.ts → source` and use that. Format
 *    override from config is preferred over auto-detect.
 *  - If neither — bubble up `config.missingSource` as exit 2; the
 *    user-facing message points at the two valid forms.
 *
 * Returns the resolved config path so the runner can surface it in
 * `envelope.meta.configPath` (matches the contract every other
 * read-only command honours since the c12 configPath plumbing).
 */
const resolveCurrentInput = async (
  explicitArg: string | undefined,
  configPath: string | undefined,
): Promise<{
  arg: string;
  formatOverride?: string;
  resolvedConfigPath: string | null;
}> => {
  if (explicitArg && explicitArg.length > 0) {
    return { arg: explicitArg, resolvedConfigPath: configPath ?? null };
  }
  try {
    const loaded = await loadAndValidateConfig(configPath);
    return {
      arg: loaded.config.source.path,
      formatOverride: loaded.config.source.type,
      resolvedConfigPath: loaded.configPath ?? configPath ?? null,
    };
  } catch (error) {
    if (error instanceof ToolError && error.kind === "config.missingSource") {
      throw new ToolError(
        "config.missingSource",
        "No `current` argument provided and no aact.config.ts found. " +
          "Either pass `aact diff <baseline> <current>` explicitly, or " +
          "run inside a project with an aact.config.ts (run `aact init` " +
          "to scaffold one).",
      );
    }
    throw error;
  }
};

const parseRenameThreshold = (raw: number | string | undefined): number => {
  if (raw === undefined) return 0.7;
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  if (Number.isNaN(n) || n < 0 || n > 1) {
    throw new ToolError(
      "config.invalidSchema",
      `--rename-threshold must be a number in [0,1]; got "${raw}"`,
      { value: String(raw) },
    );
  }
  return n;
};

const pickReporter = (json: boolean): Reporter<DiffData> => {
  if (json) return new JsonReporter<DiffData>();
  return new HumanReporter<DiffData>(renderDiffText);
};

const determineExitCode = (data: DiffData, strict: boolean): 0 | 1 | 2 => {
  if (data.changes.length === 0) return 0;
  if (data.summary.bySeverity.structural > 0) return 1;
  if (data.summary.bySeverity.semantic > 0) return 1;
  if (data.summary.bySeverity.cosmetic > 0) return strict ? 1 : 0;
  return 0;
};

export const diff = defineCommand({
  meta: {
    name: "diff",
    description:
      "Show structural diff between two architecture models (PR review)",
  },
  args: {
    baseline: {
      type: "positional",
      description:
        "Baseline source: file path, `<ref>:<path>` git ref, or `-` for stdin",
      required: true,
    },
    current: {
      type: "positional",
      description:
        "Current source (defaults to aact.config.ts → source when omitted)",
      required: false,
    },
    "baseline-format": {
      type: "string",
      description:
        "Override format detection for baseline (plantuml, structurizr, model-json)",
    },
    "current-format": {
      type: "string",
      description: "Override format detection for current",
    },
    strict: {
      type: "boolean",
      description: "Exit 1 on cosmetic-only changes (default: cosmetic = 0)",
    },
    "with-patch": {
      type: "boolean",
      description: "Include RFC 6902 patch[] in the JSON envelope (opt-in)",
    },
    "rename-threshold": {
      type: "string",
      description:
        "Similarity threshold for rename detection in [0,1] (default 0.7)",
    },
    "no-rename-detection": {
      type: "boolean",
      description: "Disable rename heuristic; surface as pure add/remove",
    },
    ...configArg,
    ...jsonArg,
  },
  async run(ctx) {
    const startedAt = Date.now();
    const args = ctx.args as unknown as DiffArgs;
    const cliJson = readJsonFlag(ctx.args);
    const reporter = pickReporter(cliJson);
    // Resolved by resolveCurrentInput when it ends up loading config —
    // pre-seeded with the explicit `--config` value (or null) so the
    // error path also surfaces a meaningful configPath when possible.
    let resolvedConfigPath: string | null = args.config ?? null;

    try {
      const currentInput = await resolveCurrentInput(args.current, args.config);
      resolvedConfigPath = currentInput.resolvedConfigPath;

      const baseline = await loadBaseline({
        arg: args.baseline,
        formatOverride: args["baseline-format"],
        sideLabel: "baseline",
      });
      const current = await loadBaseline({
        arg: currentInput.arg,
        formatOverride: args["current-format"] ?? currentInput.formatOverride,
        sideLabel: "current",
      });

      const options: DiffOptions = {
        renameThreshold: parseRenameThreshold(args["rename-threshold"]),
        disableRenameDetection: args["no-rename-detection"],
        withPatch: args["with-patch"],
      };
      const data = computeDiff(
        baseline.model,
        current.model,
        baseline.side,
        current.side,
        options,
      );

      const strict = Boolean(args.strict);
      const exitCode = determineExitCode(data, strict);

      const envelope = buildEnvelope({
        command: "diff",
        exitCode,
        data,
        meta: {
          durationMs: Date.now() - startedAt,
          configPath: resolvedConfigPath,
          source: current.side.source,
        },
      });
      await reporter.emit({ envelope });
      exitWith(envelope.exitCode);
    } catch (error) {
      const envelope = buildErrorEnvelope({
        command: "diff",
        error,
        startedAt,
        configPath: resolvedConfigPath,
        source: null,
      });
      // The error envelope has data: null; pass it through the same
      // reporter — JsonReporter handles null payload, HumanReporter
      // diverts to renderErrorEnvelope.
      await (reporter as unknown as Reporter).emit({ envelope });
      exitWith(envelope.exitCode);
    }
  },
});
