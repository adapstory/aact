import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * The dist-tag the install hint and prompt target. Tied to the
 * core's release channel — when aact graduates beta, change to
 * `latest` (or drop the qualifier).
 */
const COMPANION_DIST_TAG = "beta";
const COMPANION_INSTALL_SPEC = `@aact/view@${COMPANION_DIST_TAG}`;

const fullCompanionInstallHint = [
  `aact view needs the @aact/view companion package. Three ways to get it:`,
  ``,
  `1) Project-local (recommended):`,
  `     pnpm add -D aact@${COMPANION_DIST_TAG} ${COMPANION_INSTALL_SPEC}`,
  `     (or: npm i -D … / yarn add -D … )`,
  `     then re-run \`npx aact view\` from the project root.`,
  ``,
  `2) One-off run (no install lingers):`,
  `     npx -p aact@${COMPANION_DIST_TAG} -p ${COMPANION_INSTALL_SPEC} aact view`,
  ``,
  `3) Global (architect using aact across many repos):`,
  `     npm i -g aact@${COMPANION_DIST_TAG} ${COMPANION_INSTALL_SPEC}`,
  `     then \`aact view\` from any project with aact.config.ts.`,
].join("\n");

/**
 * `aact` was invoked from an npm/pnpm temp cache (`npx aact view`,
 * `pnpm dlx aact view`). In that mode there is no project node
 * tree we can install the companion into so it resolves on retry —
 * a `pnpm add` in cwd writes to a different tree than the one the
 * core CLI is being resolved from. Tell the user to use the
 * multi-package one-off form instead.
 */
const isRunningFromTempCache = (): boolean => {
  const here = fileURLToPath(import.meta.url);
  // Match temp-cache markers that appear as path segments. Confirmed
  // layouts as of 2026-05:
  //   npm npx (any version): `~/.npm/_npx/<hash>/` or
  //     `%LocalAppData%/npm-cache/_npx/` on Windows.
  //   pnpm 10+: `~/Library/Caches/pnpm/dlx/<hash>/` (mac),
  //     `~/.cache/pnpm/dlx/<hash>/` (Linux), `%LocalAppData%/pnpm/
  //     Cache/dlx/<hash>/` (Windows).
  //   pnpm ≤9: `~/.pnpm/.dlx/<hash>/`.
  //   yarn berry: `$TMPDIR/xfs-XXX/dlx-XXX-RAND/` — `dlx` is a prefix
  //     of the deepest segment, not its full value. The `\b` word
  //     boundary lets us match `dlx`, `dlx-`, and `.dlx` while still
  //     refusing accidental hits like `apt-build-dlxide`.
  return /[/\\](?:_npx|\.?dlx)\b/.test(here);
};

const importCompanion = async (): Promise<ViewCompanionModule> => {
  // Dynamic import via a string variable keeps the core build from
  // trying to resolve @aact/view at bundle time — unbuild would
  // otherwise either externalise it (fine) or warn. The companion
  // is genuinely optional; the import happens only when the user
  // invokes `aact view`.
  const specifier = "@aact/view";
  const mod = (await import(specifier)) as ViewCompanionModule;
  if (typeof mod.runWorkbench !== "function") {
    throw new ToolError(
      "view.bootFailed",
      "@aact/view is installed but does not export runWorkbench — version mismatch?",
    );
  }
  return mod;
};

type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

/** Detect the package manager the user's project already commits
 *  to. Lockfile-first so a repo that ships pnpm-lock.yaml doesn't
 *  accidentally splice an `npm install` against it. Falls back to
 *  npm — universally available. */
const detectPackageManager = (cwd: string): PackageManager => {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
};

const installArgs = (pm: PackageManager): readonly string[] => {
  if (pm === "pnpm") return ["add", "-D", COMPANION_INSTALL_SPEC];
  if (pm === "yarn") return ["add", "-D", COMPANION_INSTALL_SPEC];
  if (pm === "bun") return ["add", "-d", COMPANION_INSTALL_SPEC];
  return ["install", "--save-dev", COMPANION_INSTALL_SPEC];
};

/** Ask the user before installing. Non-TTY environments (CI,
 *  piped output) skip the prompt and fall through to the install
 *  hint — surprising a script with an interactive package install
 *  would be worse than a clear error. */
const promptInstall = async (pm: PackageManager): Promise<boolean> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const { default: consola } = await import("consola");
  const answer = await consola.prompt(
    `aact view needs @aact/view to render the workbench.\nInstall it now via \`${pm} ${installArgs(pm).join(" ")}\`?`,
    { type: "confirm", initial: true, cancel: "reject" },
  );
  return answer === true;
};

const runInstall = (pm: PackageManager, cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(pm, [...installArgs(pm)], {
      stdio: "inherit",
      cwd,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new ToolError(
            "view.bootFailed",
            `${pm} install exited with code ${code ?? "?"}; install @aact/view manually and retry.`,
          ),
        );
    });
  });

const loadCompanion = async (): Promise<ViewCompanionModule> => {
  try {
    return await importCompanion();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (!isModuleNotFound(error)) {
      throw new ToolError(
        "view.bootFailed",
        `Failed to load @aact/view: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Module missing. Auto-install never runs silently — we always
    // require an explicit yes; and there are contexts where even
    // an approved install doesn't help, so we skip prompting and
    // give targeted instructions instead:
    //   • npx / pnpm dlx temp cache — cwd's node tree is unrelated
    //     to the one resolving our binary, so adding the companion
    //     in cwd doesn't show up on retry import.
    //   • cwd without package.json — no tree to install into.
    if (isRunningFromTempCache()) {
      throw new ToolError(
        "view.companionMissing",
        [
          `aact was launched from an npx / pnpm dlx cache, so installing the`,
          `companion into the current project would not be visible to the`,
          `running CLI. Use one of these instead:`,
          ``,
          `  • One-off (no install lingers):`,
          `      npx -p aact@${COMPANION_DIST_TAG} -p ${COMPANION_INSTALL_SPEC} aact view`,
          `  • Project-local:`,
          `      pnpm add -D aact@${COMPANION_DIST_TAG} ${COMPANION_INSTALL_SPEC}`,
          `      then \`npx aact view\` (note: no @beta — drop the spec and npx`,
          `      will prefer the locally-installed aact + companion).`,
          `  • Global:`,
          `      npm i -g aact@${COMPANION_DIST_TAG} ${COMPANION_INSTALL_SPEC}`,
        ].join("\n"),
      );
    }

    const cwd = process.cwd();
    const hasPackageJson = existsSync(path.join(cwd, "package.json"));
    if (!hasPackageJson) {
      throw new ToolError("view.companionMissing", fullCompanionInstallHint);
    }
    const pm = detectPackageManager(cwd);
    let approved = false;
    try {
      approved = await promptInstall(pm);
    } catch {
      // Prompt cancelled (Ctrl-C / Esc) — treat as decline.
      approved = false;
    }
    if (!approved) {
      throw new ToolError("view.companionMissing", fullCompanionInstallHint);
    }
    await runInstall(pm, cwd);
    return await importCompanion();
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
