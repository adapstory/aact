<script lang="ts">
  import {
    SvelteFlow,
    SvelteFlowProvider,
    Background,
    Controls,
    type Node,
    type Edge,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import BoundaryNode from "./BoundaryNode.svelte";
  import ElementNode from "./ElementNode.svelte";
  import { layoutScope, sliceModel } from "./layout.ts";
  import type {
    BreadcrumbEntry,
    Element,
    Boundary,
    ModelEnvelope,
  } from "./types.ts";

  let envelope = $state<ModelEnvelope | null>(null);
  let breadcrumb = $state<BreadcrumbEntry[]>([{ kind: "landscape" }]);
  let selected = $state<
    | { kind: "element"; name: string }
    | { kind: "boundary"; name: string }
    | null
  >(null);
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let status = $state<"connecting" | "live" | "lost">("connecting");

  const nodeTypes = {
    element: ElementNode,
    boundary: BoundaryNode,
  } as const;

  // Re-layout whenever the model or the breadcrumb position changes.
  // Doing the layout in an effect lets us skip a render when the
  // model loads but the user is mid-drill — they only see the new
  // graph after ELK finishes positioning it.
  $effect(() => {
    if (!envelope) return;
    const scope = sliceModel(envelope.data.model, breadcrumb);
    let cancelled = false;
    void layoutScope(scope).then((result) => {
      if (cancelled) return;
      nodes = result.nodes;
      edges = result.edges;
    });
    return () => {
      cancelled = true;
    };
  });

  const fetchModel = async (): Promise<ModelEnvelope> => {
    const res = await fetch("/api/model");
    if (!res.ok) throw new Error(`/api/model returned ${res.status}`);
    return (await res.json()) as ModelEnvelope;
  };

  const wsUrl = (() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/ws`;
  })();

  const connect = (): void => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => {
      status = "live";
    });
    ws.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse(ev.data) as {
          type: string;
          envelope: ModelEnvelope;
        };
        if (payload.type === "model-update") {
          envelope = payload.envelope;
        }
      } catch {
        // Ignore malformed payloads — server won't emit any.
      }
    });
    ws.addEventListener("close", () => {
      status = "lost";
      setTimeout(connect, 1000);
    });
    ws.addEventListener("error", () => ws.close());
  };

  void fetchModel().then((env) => {
    envelope = env;
    connect();
  });

  const onNodeClick = (event: CustomEvent<{ node: Node }>): void => {
    const node = event.detail.node;
    if (node.type === "element") {
      selected = { kind: "element", name: String(node.data.name) };
    } else if (node.type === "boundary") {
      selected = { kind: "boundary", name: String(node.data.name) };
    }
  };

  const onNodeDblClick = (event: CustomEvent<{ node: Node }>): void => {
    const node = event.detail.node;
    if (node.type !== "boundary") return;
    const name = String(node.data.name);
    const label = String(node.data.label ?? name);
    breadcrumb = [...breadcrumb, { kind: "boundary", name, label }];
    selected = null;
  };

  const breadcrumbClick = (index: number): void => {
    breadcrumb = breadcrumb.slice(0, index + 1);
    selected = null;
  };

  const selectedElement = $derived<Element | null>(
    selected?.kind === "element" && envelope
      ? (envelope.data.model.elements[selected.name] ?? null)
      : null,
  );
  const selectedBoundary = $derived<Boundary | null>(
    selected?.kind === "boundary" && envelope
      ? (envelope.data.model.boundaries[selected.name] ?? null)
      : null,
  );

  const summary = $derived<{
    elements: number;
    boundaries: number;
    relations: number;
    issues: number;
  } | null>(
    envelope
      ? {
          elements: Object.keys(envelope.data.model.elements).length,
          boundaries: Object.keys(envelope.data.model.boundaries).length,
          relations: Object.values(envelope.data.model.elements).reduce(
            (acc, el) => acc + el.relations.length,
            0,
          ),
          issues: envelope.data.issues.length,
        }
      : null,
  );
</script>

<svelte:head>
  <title>aact view</title>
</svelte:head>

<div class="app">
  <header>
    <h1>aact view</h1>
    <span class="status status-{status}">
      {#if status === "live"}live · watching for changes
      {:else if status === "lost"}disconnected — retrying…
      {:else}connecting…
      {/if}
    </span>
    <nav class="breadcrumb">
      {#each breadcrumb as crumb, i (i)}
        {#if i > 0}<span class="sep">/</span>{/if}
        <button onclick={() => breadcrumbClick(i)}>
          {crumb.kind === "landscape" ? "Landscape" : crumb.label}
        </button>
      {/each}
    </nav>
  </header>
  <main>
    <div class="graph">
      <SvelteFlowProvider>
        <SvelteFlow
          {nodes}
          {edges}
          {nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          on:nodeclick={onNodeClick}
          on:nodedblclick={onNodeDblClick}
        >
          <Background />
          <Controls />
        </SvelteFlow>
      </SvelteFlowProvider>
    </div>
    <aside class="details">
      {#if selectedElement}
        <h2>Element</h2>
        <div class="field"><span class="k">name</span><span class="v">{selectedElement.name}</span></div>
        <div class="field"><span class="k">label</span><span class="v">{selectedElement.label}</span></div>
        <div class="field"><span class="k">kind</span><span class="v">{selectedElement.kind}</span></div>
        <div class="field"><span class="k">external</span><span class="v">{selectedElement.external ? "yes" : "no"}</span></div>
        {#if selectedElement.description}
          <div class="field"><span class="k">description</span><span class="v">{selectedElement.description}</span></div>
        {/if}
        {#if selectedElement.technology}
          <div class="field"><span class="k">technology</span><span class="v">{selectedElement.technology}</span></div>
        {/if}
        {#if selectedElement.tags.length}
          <div class="field">
            <span class="k">tags</span>
            <span class="v">
              {#each selectedElement.tags as t (t)}
                <span class="tag">{t}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if selectedElement.sourceLocation}
          <div class="field"><span class="k">source</span><span class="v">{selectedElement.sourceLocation.file.split("/").pop()}:{selectedElement.sourceLocation.start.line}:{selectedElement.sourceLocation.start.col}</span></div>
        {/if}
        {#if selectedElement.relations.length}
          <h3>Relations</h3>
          <ul class="relations">
            {#each selectedElement.relations as rel (rel.to + (rel.description ?? "") + (rel.technology ?? ""))}
              <li>
                <span class="arrow">→</span>
                <span class="to">{rel.to}</span>
                {#if rel.description}<span class="desc">{rel.description}</span
                  >{/if}
                {#if rel.technology}<span class="meta">{rel.technology}</span
                  >{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if selectedBoundary}
        <h2>Boundary</h2>
        <div class="field"><span class="k">name</span><span class="v">{selectedBoundary.name}</span></div>
        <div class="field"><span class="k">label</span><span class="v">{selectedBoundary.label}</span></div>
        <div class="field"><span class="k">kind</span><span class="v">{selectedBoundary.kind}</span></div>
        {#if selectedBoundary.description}
          <div class="field"><span class="k">description</span><span class="v">{selectedBoundary.description}</span></div>
        {/if}
        <div class="field"><span class="k">children</span><span class="v">{selectedBoundary.elementNames.length} elements, {selectedBoundary.boundaryNames.length} boundaries</span></div>
        <p class="hint">Double-click the boundary node to enter it.</p>
      {:else if summary}
        <h2>Workbench</h2>
        <div class="field"><span class="k">elements</span><span class="v">{summary.elements}</span></div>
        <div class="field"><span class="k">boundaries</span><span class="v">{summary.boundaries}</span></div>
        <div class="field"><span class="k">relations</span><span class="v">{summary.relations}</span></div>
        {#if summary.issues > 0}
          <div class="field"><span class="k">loader issues</span><span class="v">{summary.issues}</span></div>
        {/if}
        {#if envelope?.data.model.workspace?.name}
          <div class="field"><span class="k">workspace</span><span class="v">{envelope.data.model.workspace.name}</span></div>
        {/if}
        <p class="hint">
          Click a node to inspect; double-click a boundary to descend.
        </p>
      {:else}
        <p class="hint">Loading model…</p>
      {/if}
    </aside>
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #0f172a;
    color: #e2e8f0;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  :global(body) {
    overflow: hidden;
  }
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #1e293b;
    border-bottom: 1px solid #334155;
  }
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .status {
    font-size: 12px;
    color: #94a3b8;
  }
  .status-live {
    color: #22c55e;
  }
  .status-lost {
    color: #f87171;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    font-size: 12px;
    color: #94a3b8;
  }
  .breadcrumb button {
    all: unset;
    cursor: pointer;
    color: #38bdf8;
  }
  .breadcrumb button:hover {
    text-decoration: underline;
  }
  .sep {
    color: #475569;
  }
  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 1px;
    background: #334155;
    overflow: hidden;
  }
  .graph,
  .details {
    background: #0f172a;
    overflow: hidden;
  }
  .details {
    padding: 18px;
    overflow: auto;
  }
  .details h2 {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .details h3 {
    margin: 16px 0 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .field {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .field .k {
    color: #94a3b8;
    min-width: 80px;
  }
  .tag {
    display: inline-block;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: #334155;
    margin-right: 4px;
  }
  .relations {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 13px;
  }
  .relations li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 4px 0;
  }
  .arrow {
    color: #38bdf8;
  }
  .to {
    font-weight: 600;
  }
  .desc {
    color: #cbd5e1;
  }
  .meta {
    font-size: 11px;
    color: #94a3b8;
  }
  .hint {
    color: #94a3b8;
    font-size: 12px;
    margin-top: 18px;
  }
  :global(.svelte-flow) {
    background: #0f172a;
  }
  :global(.svelte-flow__background) {
    background-color: #0f172a;
  }
</style>
