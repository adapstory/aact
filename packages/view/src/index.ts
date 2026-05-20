import type { AactConfig } from "aact";

/**
 * Inputs the core `aact view` subcommand hands over after loading
 * and validating the user's config. Everything is already resolved
 * — paths are absolute, the customRules array is parsed — so the
 * companion has no business touching the loader pipeline a second
 * time. It just hosts the UI on top of what's already in memory.
 */
export interface RunWorkbenchOptions {
  /** Loaded + validated `aact.config.ts` payload. */
  readonly config: AactConfig;
  /** Absolute path to the resolved config file, or `null` when the
   *  caller (rarely) skipped config discovery. */
  readonly configPath: string | null;
  /** Override port. When omitted, listhen picks the next free
   *  port — the workbench prints the URL it actually bound to. */
  readonly port?: number;
  /** Suppress the automatic `open` browser-launch. The URL still
   *  prints to stdout so CI / headless flows can pick it up. */
  readonly noOpen?: boolean;
}

/**
 * Outcome of a workbench session — returned once the user closes
 * the server (Ctrl-C / SIGTERM) so the core CLI can translate it
 * into the right exit code.
 */
export interface RunWorkbenchResult {
  /** `0` when the user quit cleanly; `2` when the server failed to
   *  boot (port collision the listhen picker couldn't escape, file
   *  watcher errored, etc.). */
  readonly exitCode: 0 | 2;
}

/**
 * Lifecycle entry point invoked by the core `aact view` subcommand
 * via dynamic import. Companion-side responsibilities:
 *   - Boot the local HTTP server (listhen + h3) and the CrossWS
 *     WebSocket channel.
 *   - Set up the chokidar watcher on `config.source.path` and any
 *     `customRules` files.
 *   - Serve the pre-built Svelte SPA from `dist/ui/` and the JSON
 *     envelopes (`/api/model`, `/api/check`, `/api/analyze`).
 *   - Wait for the user to quit; clean up the watcher + server
 *     gracefully on signal.
 *
 * Phase 0 stub: prints a banner and returns successfully. The
 * server + watcher land in Phase 1.
 */
export const runWorkbench = async (
  options: RunWorkbenchOptions,
): Promise<RunWorkbenchResult> => {
  // eslint-disable-next-line no-console -- intentional CLI banner
  console.log(
    [
      "ActView companion — placeholder Phase 0 boot.",
      `  config: ${options.configPath ?? "<no config file>"}`,
      `  source: ${
        typeof options.config.source === "string"
          ? options.config.source
          : options.config.source.path
      }`,
      "Server, watcher, and UI land in Phase 1+.",
    ].join("\n"),
  );
  return { exitCode: 0 };
};
