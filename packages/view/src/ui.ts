/**
 * Inline HTML / JS for the Phase 1 workbench page. Pure vanilla
 * DOM + WebSocket subscription — no framework, no bundler, no
 * pre-built dist required to ship this iteration. Lets us verify
 * the full server → watcher → push → client refresh loop end to
 * end before bringing in Svelte Flow + ELK in Phase 2.
 *
 * The Svelte SPA will replace this file: its dist/ ships in the
 * @aact/view tarball and the server hands the same JSON envelope
 * payload over the same `/api/model` + `/api/ws` contract.
 */
export const indexHtml = (initialUrl: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>aact view</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f172a;
      --panel: #1e293b;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --warn: #fbbf24;
      --error: #f87171;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      font-size: 14px;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: var(--panel);
      border-bottom: 1px solid #334155;
    }
    header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: 0.02em; }
    header .status { font-size: 12px; color: var(--muted); }
    header .status.live { color: #22c55e; }
    header .status.lost { color: var(--error); }
    .breadcrumb { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); margin-left: 12px; }
    .breadcrumb button { all: unset; cursor: pointer; color: var(--accent); }
    .breadcrumb button:hover { text-decoration: underline; }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 1px;
      background: #334155;
      overflow: hidden;
    }
    #graph, #details {
      background: var(--bg);
      overflow: auto;
      padding: 18px;
    }
    #details h2 {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 12px;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border: 1px solid #334155;
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      background: var(--panel);
      transition: border-color 0.12s, transform 0.08s;
    }
    .node:hover { border-color: var(--accent); }
    .node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .node .kind {
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--bg);
      background: var(--accent);
      font-weight: 600;
    }
    .node .kind.system { background: #818cf8; }
    .node .kind.person { background: #f472b6; }
    .node .kind.containerdb,
    .node .kind.componentdb { background: #fbbf24; color: #1f2937; }
    .node .kind.containerqueue,
    .node .kind.componentqueue { background: #fb923c; color: #1f2937; }
    .node .kind.boundary { background: #94a3b8; color: #0f172a; }
    .node .name { font-weight: 600; }
    .node .label { color: var(--muted); font-size: 13px; }
    .node .meta { margin-left: auto; font-size: 11px; color: var(--muted); }
    .empty { color: var(--muted); font-style: italic; padding: 24px; text-align: center; }
    .field { display: flex; gap: 8px; margin-bottom: 6px; font-size: 13px; }
    .field .k { color: var(--muted); min-width: 90px; }
    .field .v { color: var(--text); word-break: break-all; }
    .tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #334155; margin-right: 4px; }
    pre.json { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; background: #0b1120; padding: 12px; border-radius: 6px; overflow: auto; }
  </style>
</head>
<body>
  <header>
    <h1>aact view</h1>
    <span class="status" id="status">connecting…</span>
    <div class="breadcrumb" id="breadcrumb"></div>
  </header>
  <main>
    <section id="graph"><div class="empty">Loading model…</div></section>
    <aside id="details"><div class="empty">Select an element</div></aside>
  </main>

  <script type="module">
    const WS_URL = (() => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      return proto + "//" + location.host + "/api/ws";
    })();

    let model = null;
    let breadcrumb = []; // [{kind: "landscape" | "boundary" | "element", name, label}]
    let selected = null;

    const status = document.getElementById("status");
    const graphEl = document.getElementById("graph");
    const detailsEl = document.getElementById("details");
    const breadcrumbEl = document.getElementById("breadcrumb");

    const fetchModel = async () => {
      const res = await fetch("/api/model");
      if (!res.ok) throw new Error("/api/model returned " + res.status);
      return await res.json();
    };

    const render = () => {
      if (!model) return;
      renderBreadcrumb();
      renderGraph();
      renderDetails();
    };

    const renderBreadcrumb = () => {
      breadcrumbEl.innerHTML = "";
      const root = document.createElement("button");
      root.textContent = "Landscape";
      root.onclick = () => { breadcrumb = []; selected = null; render(); };
      breadcrumbEl.appendChild(root);
      for (const crumb of breadcrumb) {
        const sep = document.createElement("span");
        sep.textContent = " / ";
        breadcrumbEl.appendChild(sep);
        const btn = document.createElement("button");
        btn.textContent = crumb.label || crumb.name;
        btn.onclick = () => {
          breadcrumb = breadcrumb.slice(0, breadcrumb.indexOf(crumb) + 1);
          selected = null;
          render();
        };
        breadcrumbEl.appendChild(btn);
      }
    };

    const visibleScope = () => {
      // Determine which boundary / containers are visible at the
      // current breadcrumb level. Landscape = root boundaries +
      // standalone elements; inside a boundary = its children.
      if (breadcrumb.length === 0) {
        const rootBoundaries = (model.data.model.rootBoundaryNames || [])
          .map((n) => model.data.model.boundaries[n])
          .filter(Boolean);
        const boundedNames = new Set();
        const walk = (b) => {
          for (const n of (b.elementNames || [])) boundedNames.add(n);
          for (const child of (b.boundaryNames || [])) {
            const cb = model.data.model.boundaries[child];
            if (cb) walk(cb);
          }
        };
        for (const b of rootBoundaries) walk(b);
        const standalone = Object.values(model.data.model.elements).filter(
          (e) => !boundedNames.has(e.name),
        );
        return { boundaries: rootBoundaries, elements: standalone };
      }
      const top = breadcrumb[breadcrumb.length - 1];
      if (top.kind === "boundary") {
        const b = model.data.model.boundaries[top.name];
        if (!b) return { boundaries: [], elements: [] };
        return {
          boundaries: (b.boundaryNames || []).map((n) => model.data.model.boundaries[n]).filter(Boolean),
          elements: (b.elementNames || []).map((n) => model.data.model.elements[n]).filter(Boolean),
        };
      }
      return { boundaries: [], elements: [] };
    };

    const renderGraph = () => {
      const { boundaries, elements } = visibleScope();
      graphEl.innerHTML = "";
      if (boundaries.length === 0 && elements.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Nothing to show at this level.";
        graphEl.appendChild(empty);
        return;
      }
      for (const b of boundaries) {
        const node = document.createElement("div");
        node.className = "node" + (selected && selected.kind === "boundary" && selected.name === b.name ? " selected" : "");
        const kindBadge = "<span class='kind boundary'>" + (b.kind || "Boundary") + "</span>";
        const elemCount = (b.elementNames?.length || 0) + (b.boundaryNames?.length || 0);
        node.innerHTML = kindBadge +
          "<span class='name'>" + escape(b.name) + "</span>" +
          "<span class='label'>" + escape(b.label || "") + "</span>" +
          "<span class='meta'>" + elemCount + " child" + (elemCount === 1 ? "" : "ren") + " — double-click to enter</span>";
        node.onclick = () => { selected = { kind: "boundary", name: b.name }; render(); };
        node.ondblclick = () => {
          breadcrumb = [...breadcrumb, { kind: "boundary", name: b.name, label: b.label }];
          selected = null;
          render();
        };
        graphEl.appendChild(node);
      }
      for (const e of elements) {
        const node = document.createElement("div");
        node.className = "node" + (selected && selected.kind === "element" && selected.name === e.name ? " selected" : "");
        const kindClass = (e.kind || "").toLowerCase();
        node.innerHTML =
          "<span class='kind " + kindClass + "'>" + escape(e.kind || "") + "</span>" +
          "<span class='name'>" + escape(e.name) + "</span>" +
          "<span class='label'>" + escape(e.label || "") + "</span>" +
          "<span class='meta'>" + (e.relations?.length || 0) + " edge" + ((e.relations?.length || 0) === 1 ? "" : "s") + "</span>";
        node.onclick = () => { selected = { kind: "element", name: e.name }; render(); };
        graphEl.appendChild(node);
      }
    };

    const renderDetails = () => {
      detailsEl.innerHTML = "";
      if (!selected) {
        const summary = document.createElement("div");
        const m = model.data.model;
        const elementCount = Object.keys(m.elements).length;
        const boundaryCount = Object.keys(m.boundaries).length;
        const relationCount = Object.values(m.elements).reduce(
          (acc, e) => acc + (e.relations?.length || 0), 0,
        );
        const issues = model.data.issues?.length || 0;
        summary.innerHTML =
          "<h2>Model summary</h2>" +
          field("Elements", elementCount) +
          field("Boundaries", boundaryCount) +
          field("Relations", relationCount) +
          (issues > 0 ? field("Loader issues", issues) : "") +
          (m.workspace?.name ? field("Workspace", m.workspace.name) : "") +
          "<p style='color: var(--muted); font-size: 12px; margin-top: 18px;'>Click an element or boundary; double-click a boundary to drill in.</p>";
        detailsEl.appendChild(summary);
        return;
      }
      const m = model.data.model;
      const node = selected.kind === "boundary"
        ? m.boundaries[selected.name]
        : m.elements[selected.name];
      if (!node) {
        detailsEl.innerHTML = "<div class='empty'>Selection went stale (model reloaded).</div>";
        return;
      }
      const wrap = document.createElement("div");
      wrap.innerHTML =
        "<h2>" + (selected.kind === "boundary" ? "Boundary" : "Element") + "</h2>" +
        field("name", node.name) +
        field("label", node.label) +
        field("kind", node.kind) +
        (selected.kind === "element" ? field("external", node.external ? "yes" : "no") : "") +
        (node.description ? field("description", node.description) : "") +
        (node.technology ? field("technology", node.technology) : "") +
        (node.tags?.length ? field("tags", node.tags.map(t => "<span class='tag'>" + escape(t) + "</span>").join("")) : "") +
        (node.link ? field("link", "<a href='" + escape(node.link) + "' target='_blank' rel='noopener'>" + escape(node.link) + "</a>") : "") +
        (node.sourceLocation ? field("source", escape(node.sourceLocation.file.split("/").pop() + ":" + node.sourceLocation.start.line + ":" + node.sourceLocation.start.col)) : "") +
        (selected.kind === "element" && node.relations?.length
          ? "<h2 style='margin-top: 18px;'>Relations</h2>" + node.relations.map((r) =>
              "<div class='node' onclick='void(0)'>" +
                "<span class='kind'>→</span>" +
                "<span class='name'>" + escape(r.to) + "</span>" +
                (r.description ? "<span class='label'>" + escape(r.description) + "</span>" : "") +
                (r.technology ? "<span class='meta'>" + escape(r.technology) + "</span>" : "") +
              "</div>"
            ).join("")
          : "") +
        (selected.kind === "boundary" && (node.elementNames?.length || node.boundaryNames?.length)
          ? "<h2 style='margin-top: 18px;'>Children</h2>" +
            (node.boundaryNames || []).map((n) =>
              "<div class='node'>" +
                "<span class='kind boundary'>boundary</span>" +
                "<span class='name'>" + escape(n) + "</span>" +
              "</div>"
            ).join("") +
            (node.elementNames || []).map((n) =>
              "<div class='node'>" +
                "<span class='kind'>element</span>" +
                "<span class='name'>" + escape(n) + "</span>" +
              "</div>"
            ).join("")
          : "");
      detailsEl.appendChild(wrap);
    };

    const field = (k, v) =>
      "<div class='field'><span class='k'>" + escape(k) + "</span><span class='v'>" + v + "</span></div>";

    const escape = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");

    const reload = async () => {
      try {
        model = await fetchModel();
        render();
      } catch (e) {
        graphEl.innerHTML = "<div class='empty' style='color: var(--error);'>Failed to load model: " + escape(e?.message ?? e) + "</div>";
      }
    };

    const connectWs = () => {
      const ws = new WebSocket(WS_URL);
      ws.addEventListener("open", () => {
        status.textContent = "live • watching for changes";
        status.className = "status live";
      });
      ws.addEventListener("message", (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload.type === "model-update") {
            model = payload.envelope;
            render();
          }
        } catch {}
      });
      ws.addEventListener("close", () => {
        status.textContent = "disconnected — retrying…";
        status.className = "status lost";
        setTimeout(connectWs, 1000);
      });
      ws.addEventListener("error", () => ws.close());
    };

    void reload().then(connectWs);
    console.log("aact view connected to", "${initialUrl}");
  </script>
</body>
</html>`;
