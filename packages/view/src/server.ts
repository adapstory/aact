import { H3, defineWebSocketHandler, toNodeHandler } from "h3";
import { listen, type Listener } from "listhen";

import type { ModelLoadResult } from "./load-model.js";
import { indexHtml } from "./ui.js";

/**
 * The envelope shape the server pushes over `/api/ws` and returns
 * from `/api/model`. Mirrors aact's `CliEnvelope<ModelData>` enough
 * that the client can treat them interchangeably — the workbench
 * adds no second contract.
 */
export interface ModelEnvelope {
  readonly schemaVersion: 1;
  readonly command: "view";
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly data: {
    readonly model: ModelLoadResult["model"];
    readonly issues: readonly ModelLoadResult["issues"][number][];
  };
  readonly diagnostics: readonly never[];
  readonly meta: {
    readonly aactVersion: string;
    readonly durationMs: number;
    readonly configPath: string | null;
    readonly source: string | null;
  };
}

/** Subscriber callback type — the workbench pushes a fresh envelope
 *  to every subscriber whenever chokidar reports a source change. */
export type Subscriber = (envelope: ModelEnvelope) => void;

export interface ServerHandle {
  readonly listener: Listener;
  readonly url: string;
  /** Register a callback that fires on every model update. Returns
   *  an unsubscribe function. */
  subscribe(fn: Subscriber): () => void;
  /** Push a fresh envelope to every connected client. */
  broadcast(envelope: ModelEnvelope): void;
  /** Update the cached envelope so new HTTP `/api/model` hits return
   *  the latest known model without re-loading from disk. */
  setCurrent(envelope: ModelEnvelope): void;
  close(): Promise<void>;
}

export interface ServerOptions {
  readonly port?: number;
  /** Skip `listhen`'s automatic browser open — useful when the
   *  workbench is driven from CI or an editor extension. */
  readonly noOpen?: boolean;
  /** Initial envelope to serve immediately. The watcher will
   *  replace it via `setCurrent` whenever the source changes. */
  readonly initialEnvelope: ModelEnvelope;
}

/**
 * Bring up the local workbench HTTP server.
 *
 * Routes:
 *   - `GET /`           — inline HTML page (Phase 1 placeholder; the
 *                          Svelte SPA replaces it in Phase 3).
 *   - `GET /api/model`  — current `ModelEnvelope`, JSON.
 *   - `GET /api/ws`     — WebSocket channel pushing `{type:"model-update", envelope}`
 *                          payloads on every chokidar event.
 *
 * The h3 app keeps a per-client subscriber list keyed by peer; the
 * watcher (in `runWorkbench`) calls `broadcast()` to notify the SPA
 * after each successful `loadModelFromConfig`.
 */
export const startServer = async (
  options: ServerOptions,
): Promise<ServerHandle> => {
  let current: ModelEnvelope = options.initialEnvelope;
  const subscribers = new Set<Subscriber>();
  const peers = new Set<{ send: (data: string) => void }>();

  const app = new H3();

  app.get("/api/model", () => current);

  app.get(
    "/api/ws",
    defineWebSocketHandler({
      open(peer) {
        peers.add(peer);
        // Send the latest known envelope right away so a freshly
        // opened tab doesn't have to wait for the next watcher event
        // to populate.
        peer.send(JSON.stringify({ type: "model-update", envelope: current }));
      },
      close(peer) {
        peers.delete(peer);
      },
      error(peer) {
        peers.delete(peer);
      },
    }),
  );

  // The inline HTML page is the only thing served from `/`; everything
  // else lives under `/api/*`. The page bootstraps itself by fetching
  // `/api/model` + subscribing to `/api/ws`.
  app.get("/", () => {
    return new Response(indexHtml(""), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  const listener = await listen(toNodeHandler(app), {
    port: options.port,
    open: options.noOpen ? false : true,
    showURL: false,
    qr: false,
    public: false,
    ws: true,
  });

  const url = listener.url.replace(/\/$/, "");

  return {
    listener,
    url,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    broadcast(envelope) {
      current = envelope;
      const payload = JSON.stringify({ type: "model-update", envelope });
      for (const peer of peers) {
        try {
          peer.send(payload);
        } catch {
          // Peer dropped mid-broadcast; CrossWS will report `close`
          // / `error` next tick so just skip it here.
        }
      }
      for (const fn of subscribers) {
        try {
          fn(envelope);
        } catch {
          // Subscriber threw — don't let one bad listener stop the
          // others from receiving the update.
        }
      }
    },
    setCurrent(envelope) {
      current = envelope;
    },
    close() {
      return listener.close();
    },
  };
};
