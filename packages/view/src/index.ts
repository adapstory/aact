import type { AactConfig } from "aact";

import { loadModelFromConfig } from "./load-model.js";
import type { ModelEnvelope, ServerHandle } from "./server.js";
import { startServer } from "./server.js";
import { startWatcher } from "./watcher.js";

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
  /** Suppress the automatic browser-open. The URL still prints to
   *  stdout so CI / headless flows can pick it up. */
  readonly noOpen?: boolean;
}

export interface RunWorkbenchResult {
  /** `0` when the user quit cleanly; `2` when the server failed to
   *  boot (port collision the picker couldn't escape, file
   *  watcher errored, etc.). */
  readonly exitCode: 0 | 2;
  /** URL the workbench bound to, or `null` if the boot failed
   *  before binding. Surfaced on the core CLI's `ViewData`
   *  envelope so CI / agents can pick up where the session went. */
  readonly url: string | null;
}

const sourceOf = (config: AactConfig): string =>
  typeof config.source === "string" ? config.source : config.source.path;

/** Build a `ModelEnvelope` from a single in-process loadModel call.
 *  Mirrors the wider `aact model --json` envelope so the SPA can
 *  reuse aact's contract — schemaVersion stays at `1`. */
const buildEnvelope = async (
  options: RunWorkbenchOptions,
  aactVersion: string,
): Promise<ModelEnvelope> => {
  const startedAt = performance.now();
  const { model, issues } = await loadModelFromConfig(options.config);
  return {
    schemaVersion: 1,
    command: "view",
    ok: true,
    exitCode: 0,
    data: { model, issues: [...issues] },
    diagnostics: [],
    meta: {
      aactVersion,
      durationMs: Math.round(performance.now() - startedAt),
      configPath: options.configPath,
      source: sourceOf(options.config),
    },
  };
};

/**
 * Lifecycle entry point invoked by the core `aact view` subcommand
 * via dynamic import.
 *
 * Boots the local HTTP server (listhen-picked port, browser opens
 * unless `--no-open`), serves the inline workbench page, exposes
 * `GET /api/model` + the `/api/ws` push channel, and wires a
 * chokidar watcher on `config.source.path` so every save triggers
 * a re-load + broadcast.
 *
 * Resolves only when the user terminates the session (Ctrl-C /
 * SIGTERM); the core CLI then propagates the exit code into the
 * envelope. Defensive cleanup: signal handlers tear the watcher
 * + listener down so a hard-killed Node process doesn't leak the
 * port or a stuck file watcher into the editor's `.fseventsd`.
 */
export const runWorkbench = async (
  options: RunWorkbenchOptions,
): Promise<RunWorkbenchResult> => {
  // Resolve aact version lazily — it's only surfaced on the
  // envelope `meta`, no need to crash the boot if the workspace
  // is mid-rebuild. Falls back to "unknown".
  let aactVersion = "unknown";
  try {
    const mod = (await import("aact")) as Record<string, unknown>;
    if (typeof mod.aactVersion === "string") aactVersion = mod.aactVersion;
  } catch {
    // ignore — version is informational only
  }

  let server: ServerHandle | undefined;

  try {
    const envelope = await buildEnvelope(options, aactVersion);
    server = await startServer({
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.noOpen === undefined ? {} : { noOpen: options.noOpen }),
      initialEnvelope: envelope,
    });

    // eslint-disable-next-line no-console -- intentional user-facing banner
    console.log(`▸ aact view ready at ${server.url}`);
    if (options.noOpen) {
      // eslint-disable-next-line no-console
      console.log(`  open it manually — --no-open suppressed auto-launch`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `  watching ${sourceOf(options.config)} for changes (Ctrl-C to stop)`,
    );

    const watcher = startWatcher({
      paths: [sourceOf(options.config)],
      onChange: async () => {
        try {
          const next = await buildEnvelope(options, aactVersion);
          server?.broadcast(next);
          // eslint-disable-next-line no-console
          console.log(
            `  ↻ reloaded (${Object.keys(next.data.model.elements).length} elements, ${next.data.issues.length} issues)`,
          );
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            `  ✗ reload failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    });

    await new Promise<void>((resolve) => {
      const cleanup = (signal: NodeJS.Signals): void => {
        // eslint-disable-next-line no-console
        console.log(`\n• stopping (${signal})…`);
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        void Promise.allSettled([watcher.close(), server?.close()]).then(() =>
          resolve(),
        );
      };
      const onSigint = (): void => cleanup("SIGINT");
      const onSigterm = (): void => cleanup("SIGTERM");
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);
    });

    return { exitCode: 0, url: server.url };
  } catch (error) {
    if (server) await server.close().catch(() => {});
    // eslint-disable-next-line no-console
    console.error(
      `aact view boot failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { exitCode: 2, url: server?.url ?? null };
  }
};
