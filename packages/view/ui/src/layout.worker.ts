import ELK from "elkjs/lib/elk.bundled.js";

type ElkGraph = Parameters<ELK["layout"]>[0];

interface LayoutRequest {
  readonly id: number;
  readonly graph: ElkGraph;
}

interface LayoutSuccess {
  readonly id: number;
  readonly ok: true;
  readonly result: Awaited<ReturnType<ELK["layout"]>>;
}

interface LayoutFailure {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
}

const elk = new ELK();

self.addEventListener("message", (event: MessageEvent<LayoutRequest>) => {
  const { id, graph } = event.data;
  void elk
    .layout(graph)
    .then((result) => {
      self.postMessage({ id, ok: true, result } satisfies LayoutSuccess);
    })
    .catch((error: unknown) => {
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies LayoutFailure);
    });
});
