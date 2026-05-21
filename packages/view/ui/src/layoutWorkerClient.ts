// Use Vite's `?worker` import suffix — the bundler returns a Worker
// constructor with the chunk URL baked in, sidestepping `new URL(...,
// import.meta.url)` which doubles the `/assets/` segment when
// `base: "./"` and the importer itself lives in `/assets/`.
import LayoutWorker from "./layout.worker.ts?worker";

interface LayoutRequest {
  readonly id: number;
  readonly graph: unknown;
}

type LayoutResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<
  number,
  {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  }
>();

const rejectAll = (error: Error): void => {
  for (const callbacks of pending.values()) {
    callbacks.reject(error);
  }
  pending.clear();
};

const getWorker = (): Worker => {
  if (worker) return worker;
  worker = new LayoutWorker();
  worker.addEventListener("message", (event: MessageEvent<LayoutResponse>) => {
    const callbacks = pending.get(event.data.id);
    if (!callbacks) return;
    pending.delete(event.data.id);
    if (event.data.ok) {
      callbacks.resolve(event.data.result);
    } else {
      callbacks.reject(new Error(event.data.error));
    }
  });
  worker.addEventListener("error", () => {
    rejectAll(new Error("ELK layout worker failed"));
    worker?.terminate();
    worker = null;
  });
  return worker;
};

export const runElkLayout = <T>(graph: unknown): Promise<T> => {
  const id = ++sequence;
  const current = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    current.postMessage({ id, graph } satisfies LayoutRequest);
  });
};
