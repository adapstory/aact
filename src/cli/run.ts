import type { ArgsDef, CommandContext, CommandDef, CommandMeta } from "citty";
import { defineCommand } from "citty";

import type { AactConfig } from "../config";
import { loadAndValidateConfig } from "./loadConfig";
import type {
  CommandResult,
  Diagnostic,
  ExitCode,
  OutputMode,
  Renderer,
  Reporter,
  SarifAdapter,
} from "./output";
import {
  buildEnvelope,
  buildErrorEnvelope,
  HumanReporter,
  JsonReporter,
  resolveOutputMode,
  SarifReporter,
} from "./output";

/**
 * What `execute` returns: domain payload + outcome. The wrapper assembles
 * the envelope (command name, meta.durationMs, configPath, source) so
 * commands don't repeat that bookkeeping.
 */
export interface ExecuteResult<TData> {
  readonly data: TData;
  readonly exitCode: ExitCode;
  readonly diagnostics?: readonly Diagnostic[];
  /** Text-mode hint when the command itself wrote to stdout. */
  readonly stdoutClaimed?: boolean;
}

interface BaseOpts<TArgs extends ArgsDef, TData> {
  /** Command name surfaced in envelope.command (e.g. "analyze", "rule list"). */
  readonly name: string;
  readonly meta: CommandMeta;
  readonly args: TArgs;
  readonly renderText: Renderer<TData>;
  /** Optional — map this command's envelope to a SARIF v2.1.0 log
   *  for `--sarif` output. Commands without an adapter still produce
   *  a valid empty SARIF log (so `aact <whatever> --sarif` doesn't
   *  surprise CI), only `check` ships a meaningful mapping today. */
  readonly sarifAdapter?: SarifAdapter<TData>;
}

export interface PlainCommandOpts<
  TArgs extends ArgsDef,
  TData,
> extends BaseOpts<TArgs, TData> {
  readonly execute: (
    ctx: CommandContext<TArgs>,
  ) => Promise<ExecuteResult<TData>>;
}

export interface ConfigCommandOpts<
  TArgs extends ArgsDef,
  TData,
> extends BaseOpts<TArgs, TData> {
  readonly execute: (
    ctx: CommandContext<TArgs>,
    config: AactConfig,
  ) => Promise<ExecuteResult<TData>>;
}

export const readJsonFlag = (args: unknown): boolean =>
  typeof args === "object" &&
  args !== null &&
  (args as Record<string, unknown>).json === true;

const readSarifFlag = (args: unknown): boolean =>
  typeof args === "object" &&
  args !== null &&
  (args as Record<string, unknown>).sarif === true;

const readConfigArg = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>).config;
  return typeof value === "string" ? value : undefined;
};

const pickReporter = <TData>(
  mode: OutputMode,
  renderer: Renderer<TData>,
  sarifAdapter?: SarifAdapter<TData>,
): Reporter<TData> => {
  switch (mode) {
    case "json": {
      return new JsonReporter<TData>();
    }
    case "sarif": {
      return new SarifReporter<TData>(sarifAdapter);
    }
    default: {
      return new HumanReporter(renderer);
    }
  }
};

export const exitWith = (code: ExitCode): never => {
  // eslint-disable-next-line n/no-process-exit
  process.exit(code);
};

const assembleResult = <TData>(input: {
  name: string;
  exec: ExecuteResult<TData>;
  startedAt: number;
  configPath: string | null;
  source: string | null;
}): CommandResult<TData> => ({
  envelope: buildEnvelope<TData>({
    command: input.name,
    exitCode: input.exec.exitCode,
    data: input.exec.data,
    diagnostics: input.exec.diagnostics,
    meta: {
      durationMs: Date.now() - input.startedAt,
      configPath: input.configPath,
      source: input.source,
    },
  }),
  ...(input.exec.stdoutClaimed ? { stdoutClaimed: true } : {}),
});

/**
 * Wraps a citty command with the unified output layer. The command's
 * `execute` returns an `ExecuteResult`; the wrapper builds the envelope,
 * picks the reporter from `--json` (CLI flag), and exits with envelope.exitCode.
 *
 * Use this for commands that DON'T load aact.config.ts (init, skill).
 * For config-aware commands use `cliCommandWithConfig`.
 */
export const cliCommand = <TArgs extends ArgsDef, TData>(
  opts: PlainCommandOpts<TArgs, TData>,
): CommandDef<TArgs> =>
  defineCommand({
    meta: opts.meta,
    args: opts.args,
    async run(ctx) {
      const startedAt = Date.now();
      const cliJson = readJsonFlag(ctx.args);
      const cliSarif = readSarifFlag(ctx.args);
      const mode = resolveOutputMode({ cliJson, cliSarif });
      const reporter = pickReporter(mode, opts.renderText, opts.sarifAdapter);

      try {
        const exec = await opts.execute(ctx);
        const result = assembleResult({
          name: opts.name,
          exec,
          startedAt,
          configPath: null,
          source: null,
        });
        await reporter.emit(result);
        exitWith(result.envelope.exitCode);
      } catch (error) {
        const envelope = buildErrorEnvelope({
          command: opts.name,
          error,
          startedAt,
          configPath: null,
          source: null,
        });
        await reporter.emit({ envelope } as CommandResult<TData>);
        exitWith(envelope.exitCode);
      }
    },
  });

/**
 * Wrapper variant that loads aact.config.ts via c12 before invoking
 * `execute`. Config-load failures become exit 2 with the appropriate
 * diagnostic kind. `execute` receives the validated config.
 */
export const cliCommandWithConfig = <TArgs extends ArgsDef, TData>(
  opts: ConfigCommandOpts<TArgs, TData>,
): CommandDef<TArgs> =>
  defineCommand({
    meta: opts.meta,
    args: opts.args,
    async run(ctx) {
      const startedAt = Date.now();
      const cliJson = readJsonFlag(ctx.args);
      const cliSarif = readSarifFlag(ctx.args);
      const explicitConfigPath = readConfigArg(ctx.args);

      let config: AactConfig | null = null;
      let resolvedConfigPath: string | null = explicitConfigPath ?? null;
      let loadError: unknown = null;

      try {
        const loaded = await loadAndValidateConfig(explicitConfigPath);
        config = loaded.config;
        // Prefer the path c12 actually resolved (covers both explicit
        // `--config <path>` and default discovery in cwd / parents).
        resolvedConfigPath = loaded.configPath ?? explicitConfigPath ?? null;
      } catch (error) {
        loadError = error;
      }

      const mode = resolveOutputMode({ cliJson, cliSarif, config });
      const reporter = pickReporter(mode, opts.renderText, opts.sarifAdapter);

      if (loadError !== null || config === null) {
        const envelope = buildErrorEnvelope({
          command: opts.name,
          error: loadError ?? new Error("Config did not load"),
          startedAt,
          configPath: resolvedConfigPath,
          source: null,
        });
        await reporter.emit({ envelope } as CommandResult<TData>);
        exitWith(envelope.exitCode);
        // exitWith is typed `never`, but tests mock process.exit to a no-op
        // — explicit return makes the post-condition (config !== null below)
        // hold in both contexts.
        return;
      }

      const loadedConfig = config;

      try {
        const exec = await opts.execute(ctx, loadedConfig);
        const result = assembleResult({
          name: opts.name,
          exec,
          startedAt,
          configPath: resolvedConfigPath,
          source: loadedConfig.source.path,
        });
        await reporter.emit(result);
        exitWith(result.envelope.exitCode);
      } catch (error) {
        const envelope = buildErrorEnvelope({
          command: opts.name,
          error,
          startedAt,
          configPath: resolvedConfigPath,
          source: loadedConfig.source.path,
        });
        await reporter.emit({ envelope } as CommandResult<TData>);
        exitWith(envelope.exitCode);
      }
    },
  });
