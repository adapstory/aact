import type { AactConfig } from "../../config";
import type { Renderer } from "../output";
import { ToolError } from "../output";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg } from "../sharedArgs";

/**
 * Public `data` envelope for `aact view`. Stays minimal — the
 * subcommand's job is to delegate to the companion package; what
 * lands in the envelope is the bookkeeping a CI or agent might
 * still want (which URL did the workbench bind to, did the user
 * quit clean) once the long-running session ends.
 */
export interface ViewData {
  /** Always "@aact/view". Single value today; a future build that
   *  detects an alternative compatible companion can broaden the
   *  field without rewriting the contract. */
  readonly companion: "@aact/view";
  /** URL the workbench bound to, when the server actually came
   *  up. `null` when the companion exited before binding (e.g.
   *  port collision the picker couldn't escape). */
  readonly url: string | null;
}

/**
 * Shape we expect on the companion's default export. Deliberately
 * narrow — the core CLI never reaches into anything else. The
 * actual signatures live in `packages/view/src/index.ts` and stay
 * the single source of truth; this is the compile-time shape we
 * `import()` against.
 */
interface ViewCompanionModule {
  readonly runWorkbench: (options: {
    readonly config: AactConfig;
    readonly configPath: string | null;
    readonly port?: number;
    readonly noOpen?: boolean;
  }) => Promise<{ readonly exitCode: 0 | 2; readonly url?: string | null }>;
}

const isModuleNotFound = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
    return true;
  }
  return /Cannot find (?:module|package) ['"]@aact\/view['"]/.test(
    error.message,
  );
};

const companionInstallHint = [
  `aact view requires the @aact/view companion package.`,
  ``,
  `Install it locally so the dynamic import resolves:`,
  `  pnpm add -D @aact/view@beta   (or: npm i -D / yarn add -D)`,
  ``,
  `Or run it one-off without polluting node_modules:`,
  `  pnpm dlx -p aact -p @aact/view aact view`,
].join("\n");

const loadCompanion = async (): Promise<ViewCompanionModule> => {
  try {
    // Dynamic import via a string variable keeps the core build
    // from trying to resolve @aact/view at bundle time — unbuild
    // would otherwise either externalise it (fine) or warn. The
    // companion is genuinely optional; the import happens only
    // when the user invokes `aact view`.
    const specifier = "@aact/view";
    const mod = (await import(specifier)) as ViewCompanionModule;
    if (typeof mod.runWorkbench !== "function") {
      throw new ToolError(
        "view.bootFailed",
        "@aact/view is installed but does not export runWorkbench — version mismatch?",
      );
    }
    return mod;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (isModuleNotFound(error)) {
      throw new ToolError("view.companionMissing", companionInstallHint);
    }
    throw new ToolError(
      "view.bootFailed",
      `Failed to load @aact/view: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

interface ViewArgs {
  readonly config?: string;
  readonly port?: string;
  readonly "no-open"?: boolean;
}

export const executeView = async (
  config: AactConfig,
  args: ViewArgs,
  configPath: string | null,
): Promise<ExecuteResult<ViewData>> => {
  const companion = await loadCompanion();
  const port = args.port ? Number.parseInt(args.port, 10) : undefined;
  if (port !== undefined && Number.isNaN(port)) {
    throw new ToolError(
      "view.bootFailed",
      `--port must be a number (got "${args.port}")`,
    );
  }
  const result = await companion.runWorkbench({
    config,
    configPath,
    ...(port === undefined ? {} : { port }),
    noOpen: args["no-open"] === true,
  });
  return {
    data: {
      companion: "@aact/view",
      url: result.url ?? null,
    },
    exitCode: result.exitCode,
  };
};

const renderViewText: Renderer<ViewData> = (envelope, sink) => {
  if (envelope.data.url) {
    sink.write(`✔ aact view session ended (${envelope.data.url})\n`);
  } else {
    sink.write(`✔ aact view session ended\n`);
  }
};

export const view = cliCommandWithConfig({
  name: "view",
  meta: {
    name: "view",
    description:
      "Open the local architecture workbench in a browser (requires @aact/view)",
  },
  args: {
    ...configArg,
    port: {
      type: "string",
      description: "Port to bind the workbench server (default: auto-pick)",
    },
    "no-open": {
      type: "boolean",
      description:
        "Print the URL instead of auto-opening a browser (CI / headless)",
    },
  },
  renderText: renderViewText,
  execute: async (ctx, config, execContext) => {
    const args = ctx.args as ViewArgs;
    return executeView(config, args, execContext.configPath);
  },
});
