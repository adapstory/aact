<script lang="ts">
  import { setContext } from "svelte";

  import {
    SvelteFlow,
    SvelteFlowProvider,
    Background,
    Controls,
    MiniMap,
    MarkerType,
    type Node,
    type Edge,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import BoundaryNode from "./BoundaryNode.svelte";
  import DatabaseNode from "./DatabaseNode.svelte";
  import ElementNode from "./ElementNode.svelte";
  import PersonNode from "./PersonNode.svelte";
  import QueueNode from "./QueueNode.svelte";
  import {
    layoutFlat,
    layoutNested,
    layoutScope,
    sliceModel,
  } from "./layout.ts";
  import type {
    BreadcrumbEntry,
    Element,
    Boundary,
    ModelEnvelope,
  } from "./types.ts";
  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  type ViewMode = "drill" | "expand" | "flat";

  let envelope = $state<ModelEnvelope | null>(null);
  let mode = $state<ViewMode>("drill");
  let breadcrumb = $state<BreadcrumbEntry[]>([{ kind: "landscape" }]);
  let expanded = $state<Set<string>>(new Set());
  let selected = $state<
    | { kind: "element"; name: string }
    | { kind: "boundary"; name: string }
    | null
  >(null);
  let hoveredNodeId = $state<string | null>(null);
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let status = $state<"connecting" | "live" | "lost">("connecting");

  const nodeTypes = {
    element: ElementNode,
    person: PersonNode,
    database: DatabaseNode,
    queue: QueueNode,
    boundary: BoundaryNode,
  } as const;

  // Re-layout whenever model, mode, breadcrumb, or expanded set
  // changes. Each branch hands a different ELK invocation back the
  // same `{nodes, edges}` shape so the render code stays uniform.
  $effect(() => {
    if (!envelope) return;
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (mode === "drill") {
        const scope = sliceModel(envelope!.data.model, breadcrumb);
        const result = await layoutScope(scope);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      } else if (mode === "expand") {
        const result = await layoutNested(envelope!.data.model, expanded);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      } else {
        const result = await layoutFlat(envelope!.data.model);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      }
    };
    void run();
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
        // ignore malformed payloads — server won't emit any
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

  const onnodeclick = ({ node }: { node: Node }): void => {
    if (node.type === "boundary") {
      selected = { kind: "boundary", name: String(node.data.name) };
    } else {
      selected = { kind: "element", name: String(node.data.name) };
    }
  };

  // @xyflow/svelte 1.x exposes pointer events on the SvelteFlow
  // component as callback props. Pointer events fire for both mouse
  // and touch, so they cover the "trace a relation" UX better than
  // the deprecated mouse-only equivalents.
  const onnodepointerenter = ({ node }: { node: Node }): void => {
    hoveredNodeId = node.id;
  };
  const onnodepointerleave = (): void => {
    hoveredNodeId = null;
  };

  const actions: ViewActions = {
    selectElement: (name) => {
      selected = { kind: "element", name };
    },
    selectBoundary: (name) => {
      selected = { kind: "boundary", name };
    },
    enterBoundary: (name, label) => {
      // Drill-down only makes sense in Drill mode; in Expand mode
      // this is mapped to "toggle" by the BoundaryNode itself.
      if (mode !== "drill") return;
      breadcrumb = [...breadcrumb, { kind: "boundary", name, label }];
      selected = null;
    },
    toggleBoundary: (name) => {
      if (mode !== "expand") return;
      const next = new Set(expanded);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      expanded = next;
    },
  };
  setContext(VIEW_ACTIONS, actions);

  const breadcrumbClick = (index: number): void => {
    breadcrumb = breadcrumb.slice(0, index + 1);
    selected = null;
  };

  const setMode = (next: ViewMode): void => {
    mode = next;
    // Mode change resets selection / breadcrumb so users don't
    // chase the wrong context when switching strategies.
    selected = null;
    if (next === "drill") {
      breadcrumb = [{ kind: "landscape" }];
    }
    if (next === "expand") {
      expanded = new Set();
    }
  };

  const collapseAll = (): void => {
    expanded = new Set();
  };
  const expandAll = (): void => {
    if (!envelope) return;
    expanded = new Set(Object.keys(envelope.data.model.boundaries));
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

  // Dim edges that aren't incident to the hovered node so the user
  // can trace a single dependency through a crowded canvas. Empty
  // hover → identity (no dimming). Re-write the markerEnd color
  // explicitly because SVG markers don't inherit `stroke` from the
  // referencing path.
  const decoratedEdges = $derived<Edge[]>(
    hoveredNodeId
      ? edges.map((e) => {
          const incident =
            e.source === hoveredNodeId || e.target === hoveredNodeId;
          const color = incident ? "#38bdf8" : "#475569";
          return {
            ...e,
            animated: incident,
            style: incident
              ? "stroke: #38bdf8; stroke-width: 2.4; opacity: 1;"
              : "stroke: #475569; stroke-width: 1.2; opacity: 0.4;",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 24,
              height: 24,
              color,
            },
          };
        })
      : edges,
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

  // Translate a SourceLocation into a deep link the OS knows. Vendor
  // schemes match aact's CLI link format so the IDE the user already
  // configured for `aact check` handles the click here too.
  const sourceUrl = (
    file: string,
    line: number,
    col: number,
  ): string => {
    const opener =
      (typeof window !== "undefined" &&
        (window as { __AACT_OPENER__?: string }).__AACT_OPENER__) ||
      "vscode";
    return `${opener}://file/${file}:${line}:${col}`;
  };

  const minimapNodeColor = (node: Node): string => {
    const kind = String((node.data as { kind?: string } | undefined)?.kind);
    const external = Boolean(
      (node.data as { external?: boolean } | undefined)?.external,
    );
    if (node.type === "person") return "#08427b";
    if (external) return "#475569";
    if (kind === "System") return "#1168bd";
    if (kind === "Container") return "#438dd5";
    if (kind === "Component") return "#85bbf0";
    return "#64748b";
  };
</script>

<svelte:head>
  <title>aact view</title>
</svelte:head>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo">aact</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="title">view</span>
      {#if envelope?.data.model.workspace?.name}
        <span class="sep" aria-hidden="true">·</span>
        <span class="workspace" title={envelope.data.model.workspace.description ?? ""}>
          {envelope.data.model.workspace.name}
        </span>
      {/if}
      <span class="status status-{status}">
        {#if status === "live"}● live
        {:else if status === "lost"}● disconnected — retrying
        {:else}● connecting
        {/if}
      </span>
    </div>

    <div class="modes" role="tablist" aria-label="View mode">
      <button
        role="tab"
        class:active={mode === "drill"}
        aria-selected={mode === "drill"}
        onclick={() => setMode("drill")}
        title="Replace the canvas with the boundary you double-click"
      >Drill</button>
      <button
        role="tab"
        class:active={mode === "expand"}
        aria-selected={mode === "expand"}
        onclick={() => setMode("expand")}
        title="Open boundaries inline — parents stay visible"
      >Expand</button>
      <button
        role="tab"
        class:active={mode === "flat"}
        aria-selected={mode === "flat"}
        onclick={() => setMode("flat")}
        title="Render every level of the hierarchy at once"
      >Flat</button>
    </div>

    <div class="context">
      {#if mode === "drill"}
        <nav class="breadcrumb" aria-label="Drill path">
          {#each breadcrumb as crumb, i (i)}
            {#if i > 0}<span class="bsep" aria-hidden="true">/</span>{/if}
            <button class="bcrumb" onclick={() => breadcrumbClick(i)}>
              {crumb.kind === "landscape" ? "Landscape" : crumb.label}
            </button>
          {/each}
        </nav>
      {:else if mode === "expand"}
        <div class="expand-controls">
          <button class="ghost" onclick={expandAll}>Expand all</button>
          <button class="ghost" onclick={collapseAll}>Collapse all</button>
          <span class="hint">double-click a boundary to toggle</span>
        </div>
      {:else}
        <span class="hint">full hierarchy — read-only overview</span>
      {/if}
    </div>
  </header>

  <main>
    <div class="graph">
      <SvelteFlowProvider>
        <SvelteFlow
          {nodes}
          edges={decoratedEdges}
          {nodeTypes}
          {onnodeclick}
          {onnodepointerenter}
          {onnodepointerleave}
          fitView
          fitViewOptions={{ padding: 0.18, duration: 400 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{ type: "default", animated: false }}
        >
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={minimapNodeColor}
            maskColor="rgba(15, 23, 42, 0.7)"
            style="background: #0b1220;"
          />
        </SvelteFlow>
      </SvelteFlowProvider>

      <aside class="legend" aria-label="C4 element palette">
        <span class="legend-row"><span class="swatch" style="background: #08427b;"></span>Person</span>
        <span class="legend-row"><span class="swatch" style="background: #1168bd;"></span>System</span>
        <span class="legend-row"><span class="swatch" style="background: #438dd5;"></span>Container</span>
        <span class="legend-row"><span class="swatch" style="background: #85bbf0;"></span>Component</span>
        <span class="legend-row"><span class="swatch" style="background: #475569;"></span>External</span>
      </aside>
    </div>

    <aside class="details">
      {#if selectedElement}
        <h2>{selectedElement.kind}{selectedElement.external ? " · external" : ""}</h2>
        <h3 class="title">{selectedElement.label}</h3>
        {#if selectedElement.technology}
          <p class="tech">[{selectedElement.technology}]</p>
        {/if}
        {#if selectedElement.description}
          <p class="desc">{selectedElement.description}</p>
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
          <div class="field">
            <span class="k">source</span>
            <span class="v">
              <a href={sourceUrl(selectedElement.sourceLocation.file, selectedElement.sourceLocation.start.line, selectedElement.sourceLocation.start.col)}>
                {selectedElement.sourceLocation.file.split("/").pop()}:{selectedElement.sourceLocation.start.line}:{selectedElement.sourceLocation.start.col}
              </a>
            </span>
          </div>
        {/if}
        {#if selectedElement.relations.length}
          <h4>Outgoing relations</h4>
          <ul class="relations">
            {#each selectedElement.relations as rel (rel.to + (rel.description ?? "") + (rel.technology ?? ""))}
              <li>
                <span class="arrow">→</span>
                <span class="to">{rel.to}</span>
                {#if rel.description}<span class="rdesc">{rel.description}</span>{/if}
                {#if rel.technology}<span class="rmeta">[{rel.technology}]</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if selectedBoundary}
        <h2>{selectedBoundary.kind} boundary</h2>
        <h3 class="title">{selectedBoundary.label}</h3>
        {#if selectedBoundary.description}
          <p class="desc">{selectedBoundary.description}</p>
        {/if}
        <div class="field">
          <span class="k">children</span>
          <span class="v">{selectedBoundary.elementNames.length} elements · {selectedBoundary.boundaryNames.length} boundaries</span>
        </div>
        {#if selectedBoundary.tags.length}
          <div class="field">
            <span class="k">tags</span>
            <span class="v">
              {#each selectedBoundary.tags as t (t)}
                <span class="tag">{t}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if selectedBoundary.sourceLocation}
          <div class="field">
            <span class="k">source</span>
            <span class="v">
              <a href={sourceUrl(selectedBoundary.sourceLocation.file, selectedBoundary.sourceLocation.start.line, selectedBoundary.sourceLocation.start.col)}>
                {selectedBoundary.sourceLocation.file.split("/").pop()}:{selectedBoundary.sourceLocation.start.line}:{selectedBoundary.sourceLocation.start.col}
              </a>
            </span>
          </div>
        {/if}
        <p class="hint">
          {#if mode === "drill"}Double-click to enter this boundary.
          {:else if mode === "expand"}Double-click to {expanded.has(selectedBoundary.name) ? "collapse" : "expand"} this boundary.
          {:else}This boundary is part of the full hierarchy.
          {/if}
        </p>
      {:else if envelope?.data.model.workspace}
        <h2>Workspace</h2>
        <h3 class="title">{envelope.data.model.workspace.name ?? "(unnamed)"}</h3>
        {#if envelope.data.model.workspace.description}
          <p class="desc">{envelope.data.model.workspace.description}</p>
        {/if}
        {#if summary}
          <div class="stats">
            <div><span class="num">{summary.elements}</span> elements</div>
            <div><span class="num">{summary.boundaries}</span> boundaries</div>
            <div><span class="num">{summary.relations}</span> relations</div>
            {#if summary.issues > 0}
              <div class="warn"><span class="num">{summary.issues}</span> loader issues</div>
            {/if}
          </div>
        {/if}
        <p class="hint">
          Click a node to inspect. Switch modes in the top bar to
          change how the hierarchy unfolds.
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
    background: #0b1220;
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
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    padding: 10px 18px;
    background: linear-gradient(180deg, #0f172a 0%, #0b1220 100%);
    border-bottom: 1px solid #1e293b;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .logo {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: #f8fafc;
  }
  .title {
    font-size: 12px;
    color: #94a3b8;
    font-weight: 600;
  }
  .workspace {
    font-size: 13px;
    color: #cbd5e1;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 340px;
  }
  .sep {
    color: #475569;
    font-size: 10px;
  }
  .status {
    font-size: 11px;
    margin-left: 4px;
    color: #94a3b8;
  }
  .status-live {
    color: #34d399;
  }
  .status-lost {
    color: #f87171;
  }
  .modes {
    display: inline-flex;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 999px;
    padding: 3px;
  }
  .modes button {
    appearance: none;
    border: 0;
    background: transparent;
    color: #94a3b8;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
    letter-spacing: 0.02em;
  }
  .modes button:hover {
    color: #e2e8f0;
  }
  .modes button.active {
    background: #38bdf8;
    color: #0b1220;
  }
  .context {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    min-width: 0;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .bcrumb {
    appearance: none;
    border: 0;
    background: transparent;
    color: #38bdf8;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .bcrumb:hover {
    background: rgba(56, 189, 248, 0.1);
  }
  .bsep {
    color: #475569;
  }
  .expand-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ghost {
    appearance: none;
    border: 1px solid #1e293b;
    background: #0f172a;
    color: #cbd5e1;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .ghost:hover {
    background: #1e293b;
    color: #f8fafc;
  }
  .hint {
    color: #64748b;
    font-size: 11px;
  }

  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    background: #1e293b;
    overflow: hidden;
  }
  .graph,
  .details {
    background: #0b1220;
    overflow: hidden;
    position: relative;
  }
  .graph {
    position: relative;
  }

  .legend {
    position: absolute;
    bottom: 14px;
    left: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid #1e293b;
    border-radius: 10px;
    font-size: 11px;
    color: #cbd5e1;
    z-index: 4;
    backdrop-filter: blur(6px);
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }

  .details {
    padding: 20px;
    overflow: auto;
    border-left: 1px solid #1e293b;
  }
  .details h2 {
    margin: 0;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .details h3 {
    margin: 6px 0 10px;
    font-size: 18px;
    font-weight: 800;
    line-height: 1.2;
    color: #f8fafc;
  }
  .details h4 {
    margin: 18px 0 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .tech {
    margin: 0 0 10px;
    font-size: 12px;
    font-style: italic;
    color: #94a3b8;
  }
  .desc {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.45;
    color: #cbd5e1;
  }
  .field {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }
  .field .k {
    color: #64748b;
    min-width: 70px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10px;
    padding-top: 2px;
  }
  .field a {
    color: #38bdf8;
    text-decoration: none;
  }
  .field a:hover {
    text-decoration: underline;
  }
  .tag {
    display: inline-block;
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    background: #1e293b;
    color: #cbd5e1;
    margin-right: 4px;
  }
  .relations {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 12px;
  }
  .relations li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 4px 0;
    color: #cbd5e1;
  }
  .arrow {
    color: #38bdf8;
  }
  .to {
    font-weight: 700;
    color: #e2e8f0;
  }
  .rdesc {
    color: #94a3b8;
  }
  .rmeta {
    font-size: 10px;
    color: #64748b;
    font-style: italic;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin: 14px 0;
  }
  .stats > div {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 11px;
    color: #94a3b8;
  }
  .stats .num {
    font-size: 18px;
    font-weight: 800;
    color: #f8fafc;
    display: block;
    line-height: 1.1;
  }
  .stats .warn {
    border-color: #b45309;
    color: #fbbf24;
  }
  :global(.svelte-flow) {
    background: #0b1220;
    /* xyflow exposes edge styling via CSS variables. Setting them
       here overrides the defaults baked into
       @xyflow/svelte/dist/style.css regardless of which template
       (default / smoothstep / straight) renders the edge.
       Edge labels are HTML <div>s, not SVG <text>, so they need
       HTML CSS background / color — labelBgStyle prop is ignored
       in @xyflow/svelte 1.x. */
    --xy-edge-stroke-default: #94a3b8;
    --xy-edge-stroke-selected-default: #38bdf8;
    --xy-edge-stroke-width-default: 1.8;
    --xy-connectionline-stroke-default: #38bdf8;
    --xy-edge-label-color-default: #f8fafc;
    --xy-edge-label-background-color-default: #1e293b;
  }
  :global(.svelte-flow__edge-label) {
    background: #1e293b;
    color: #f8fafc;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid #475569;
    font-size: 11px;
    font-weight: 700;
    box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.svelte-flow__background) {
    background-color: #0b1220;
  }
  :global(.svelte-flow__edge-path) {
    stroke: #94a3b8;
    stroke-width: 1.8;
  }
  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #38bdf8;
    stroke-width: 2.4;
  }
  :global(.svelte-flow__edge-text) {
    fill: #f8fafc;
    font-size: 11px;
    font-weight: 700;
  }
  :global(.svelte-flow__edge-textbg) {
    fill: #1e293b;
    stroke: #475569;
    stroke-width: 1;
  }
  :global(.svelte-flow__arrowhead polyline),
  :global(.svelte-flow__arrowhead path) {
    fill: #cbd5e1;
    stroke: #cbd5e1;
  }
  /* Hide connection handles. xyflow still needs the <Handle>
     components to compute edge endpoints, but the default `o` dot
     visually competes with the arrowhead at the node border. We
     keep size > 0 so the layout math is intact, just invisible. */
  :global(.svelte-flow__handle) {
    width: 6px;
    height: 6px;
    background: transparent;
    border: 0;
    min-width: 0;
    min-height: 0;
    opacity: 0;
    pointer-events: none;
  }
  :global(.svelte-flow__controls) {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 8px;
    overflow: hidden;
  }
  :global(.svelte-flow__controls-button) {
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
    color: #cbd5e1;
  }
  :global(.svelte-flow__controls-button:hover) {
    background: #1e293b;
  }
  :global(.svelte-flow__minimap) {
    border: 1px solid #1e293b;
    border-radius: 8px;
    overflow: hidden;
  }
</style>
