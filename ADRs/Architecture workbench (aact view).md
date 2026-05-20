# Architecture workbench (`aact view`)

## Status

Proposed. Targeted for v3.x — **not** v3.0.0 GA. Lives on the
`proposal/aact-view` branch until a concrete MVP lands.

## Context

Architects who keep their model in `architecture.puml` or
`workspace.dsl` have no zero-setup way to **see** what they wrote
locally:

- PlantUML needs a Java runtime + the `plantuml.jar` renderer
  (or an HTTP renderer service) before the source becomes a
  picture.
- Structurizr DSL needs Structurizr Lite (a Docker container or a
  separate Java app) to be reachable from the browser at all.
- Generated SVGs / PNGs go stale the moment the source file
  changes; refreshing them is an out-of-band step every time.

So in practice the loop is:

1. Edit `.puml` / `.dsl` in the editor.
2. Switch to a terminal, run a renderer.
3. Find the output, switch to a browser, refresh.
4. Discover a typo, go back to step 1.

That loop is heavy enough that most architects drop the diagram
from the workflow and live in text-only review. The model
becomes write-once, not live thinking material.

`aact` already loads the normalised `Model` from every supported
format and emits the full graph via `aact model --json`. The
ingredients for a local, format-agnostic, hot-reloading viewer
are already in the codebase — what is missing is a UI layer that
binds them to a browser tab.

## Краткое описание решения и его обоснование

### Решение

Ship `aact view` as a **local architecture workbench** — a
`pnpm`-workspace subpackage (`@aact/view` candidate) that the
core `aact` CLI delegates to.

```bash
npx aact view                # uses aact.config.ts → source
npx aact view ./workspace.dsl
npx aact view ./architecture.puml
```

Runtime shape:

1. `aact view` loads the same `Model` the rule engine sees (via
   the existing format registry — PUML / DSL / JSON / model-json
   all work without renderer-specific code).
2. A local HTTP server (UnJS `listhen` + `h3`, consistent with
   the rest of the toolchain) serves a pre-built static SPA from
   the package's `dist/`.
3. The SPA fetches the current `ModelData` envelope, lays out
   the graph (ELK hierarchical layout, Cytoscape interaction
   layer), and overlays violations + metrics from the existing
   `CheckData` / `AnalyzeData` envelopes.
4. A `chokidar` file watcher on `config.source.path` + every
   `customRules` import re-runs the loader on change and
   pushes the new envelope over a WebSocket; the SPA diffs the
   graph and animates the delta.
5. Drill-down by level — Structurizr-style **double-click
   descends one level**, breadcrumb / `Esc` ascends. Single-click
   selects the node and pins details to the side panel without
   changing scope.
   - **Landscape** — people, external systems, root software
     systems. Double-click a `softwareSystem` → System view.
   - **System** — containers inside the selected software
     system (or boundary). Double-click a `Container` →
     Element focus (Structurizr doesn't ship a Component view
     for `aact`'s scope; we stop here unless / until the model
     carries Components).
   - **Element focus** — selected node + 1-hop incoming /
     outgoing edges; details panel shows `kind`, `tags`,
     `properties`, related ADR, source location.
   - **Group slice** (optional view mode, not a C4 boundary) —
     a toggle that filters the current level by
     `properties.group`. Same level, narrower lens — orthogonal
     to the drill-down stack.

   The breadcrumb / `Esc` semantics keep the back button native
   (browser History API), so `⌘[` and the browser back arrow
   work exactly as Structurizr Lite trained users to expect.

The MVP renders **the normalised Model**, not the source
notation. Style hints from PUML (`AddElementTag`,
`UpdateElementStyle`, sprite, link) are deliberately ignored —
otherwise we re-create PlantUML and inherit its surface. The
canonical line is:

> ActView renders the architecture model, not the source code.

### Обоснование

- **Closes a measured gap.** PUML and DSL workflows both lack a
  zero-setup local viewer; everyone who's tried to use C4 as
  living documentation has hit this.
- **No new contracts.** The viewer consumes `aact model --json`
  / `aact check --json` / `aact analyze --json` envelopes — the
  `CliEnvelope` shape that's already frozen at `schemaVersion: 1`.
  No second source of truth for the Model.
- **Format-agnostic by construction.** PUML, Structurizr DSL /
  JSON, `model-json` all flow through the same registry-loaded
  `Model` already; the SPA doesn't know or care which one is on
  disk.
- **Solid base for downstream features** without expanding the
  Model surface: diff overlay (`baseline` vs `current` from
  `aact diff`), time-travel via git refs, violation-first
  navigation, ADR pop-ups.

### Не-цели MVP

The scope discipline that v3 has held throughout (this is a
linter, not a graph database) applies here too. The following
are intentional non-goals:

- **Source editing in the browser.** View only; the editor is
  the editor.
- **Multi-user / hosted mode.** Localhost-only. Architecture-as-
  service is a different product.
- **Custom layout persistence.** Compute layout from the graph
  every load — predictable, no hidden state.
- **PNG / SVG export.** That's PlantUML / Structurizr territory;
  recreating it pulls in renderer baggage we deliberately don't
  want.
- **Style fidelity with PUML.** Tags / sprites / line styles do
  not flow into the workbench. The canonical line above.

### Tech notes

| Layer            | Choice                                       | Why                                                                                    |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Package          | `@aact/view` in pnpm workspace               | Keeps core `aact` tarball lean; users who don't want it never pay for the dist.        |
| Server           | UnJS `listhen` + `h3`                        | Matches the rest of aact's UnJS stack (c12 / citty / consola); zero lock-in.           |
| File watcher     | `chokidar`                                   | The proven cross-platform watcher. Same dep most v3-era tools already pull in.         |
| WebSocket        | `ws` via h3 upgrade                          | Plain `RFC 6455`; agents can also drive it from a `WebSocket` polyfill in headless.    |
| Browser launch   | `open`                                       | Cross-platform; falls back to printing the URL if no display.                          |
| Frontend bundle  | Vite + Solid (or Preact) + ELK + Cytoscape   | Solid keeps bundle < 200 kB gzipped; ELK lays out C4 nesting; Cytoscape handles click. |
| Bundle delivery  | Pre-built `dist/` in the npm tarball         | `npx aact view` works without a build step on the user side.                           |
| Communication    | The `CliEnvelope` shape, served from a route | Re-uses the contract already documented in `src/cli/output/types.ts`.                  |
| Cold-start floor | Server up + browser open < 1 s on the target | The whole pitch is "zero friction" — every second of startup eats the value.           |

## Как покрыть тестами

- **Loader path.** Existing parser / loader tests already cover
  format → `Model`. The view package consumes the public
  `loadFormat` / `loadModel` surfaces; no new format contracts.
- **Server.** `vitest` integration test boots the h3 server on
  an ephemeral port, hits `/api/model` / `/api/check` /
  `/api/analyze`, asserts the envelope shape matches
  `schemaVersion: 1`.
- **WebSocket reload.** Vitest test starts the server with a
  scratch fixture file, opens a `ws` client, writes a change to
  the fixture, asserts the next message carries the new
  envelope.
- **SPA bundle.** Playwright smoke that opens the served URL on
  a fixture, asserts the graph renders, a violation node shows
  the rule name in tooltip, drill-down click changes the
  visible element set.
- **`pnpm pack` smoke.** Ensure the pre-built SPA dist actually
  ships in the tarball (publint + a check on the `files` list).

### Примеры тестов

- `packages/view/test/server.test.ts` — server envelope wiring.
- `packages/view/test/watch.test.ts` — file-watcher → WS flush.
- `packages/view/e2e/landscape.spec.ts` — Playwright drill-down.

## Roadmap (post-MVP)

These are deferred until a real user asks. None of them are
load-bearing for the workbench thesis.

- **Diff overlay.** Show `aact diff` output as colour-coded
  edges / nodes between two refs.
- **Group slice mode.** Filter by `properties.group` as a
  one-click view layer (still not a C4 boundary).
- **Time-travel.** Walk `git log` of the source file, scrub the
  workbench through history.
- **Inline ADR view.** When clicking a rule violation, surface
  the rule's ADR right inside the workbench.
- **VS Code / Cursor extension.** Embed the same SPA inside an
  editor webview pane so users never leave the IDE.
