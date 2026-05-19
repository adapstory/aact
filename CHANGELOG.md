# Changelog

All notable changes to `aact` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## v3.0.0-beta.11 — 2026-05-19

API ergonomics + terminology cleanup. Two changes that custom rule
authors care about: the field `Violation.element` no longer pretends
boundary-level rules emit element names, and a handful of types
that were already defined internally now actually re-export through
the library barrel. Plus a wide doc sweep replacing leftover "byte
range / byte offset" prose with the honest UTF-16 code-unit framing.

### Changed (breaking — rule API)

- `Violation.element` renamed to `Violation.target` and gains a
  required `targetKind: "element" | "boundary"` discriminator. Most
  rules fire on elements (acl, crud, acyclic, stableDependencies,
  apiGateway, dbPerService) and emit `targetKind: "element"`; the
  two boundary-level rules (cohesion, commonReuse) emit
  `targetKind: "boundary"`. The old `element: string` field lied
  for boundary-level rules — agents and LSP consumers that did
  `model.elements[v.element]` lookup got `undefined` on cohesion /
  commonReuse violations. The discriminator removes the guess.
- `CheckViolation` JSON envelope field follows: the old
  `data.violations[].element` is replaced by `.target` and
  `.targetKind`.
- Custom rules: rename the `element` field in returned violations to
  `target` and add `targetKind: "element"` (or `"boundary"` for
  boundary-level rules). TypeScript surfaces every call site at
  compile time; no runtime fallback shipped.

### Added — public exports

These types were defined internally but never re-exported from the
library barrel, so users couldn't declare variables / function
signatures with them through `import { … } from "aact"`:

- `editLocation` helper from `rules/lib/applyEdits` — for custom
  applier callers that need the source range of an edit without
  re-matching the discriminant.
- `ApplyEditsResult` / `EditConflict` — the return shape and
  conflict entry of `applyEdits`.
- `RelationDeclOptions` — opts arg type of `FormatSyntax.relationDecl`.
- `LoadableFormat` / `GeneratableFormat` / `FixableFormat` —
  the narrowed `Format` types produced by the `canLoad` /
  `canGenerate` / `canFix` type guards.

## v3.0.0-beta.10 — 2026-05-19

Range-based `--fix` engine replaces the string-matching applier. Every
fix edit now anchors on a real `SourceLocation` source range
(UTF-16 code-unit offsets — see `SourcePosition.offset`; chevrotain
parsers populate them on every Element / Boundary / Relation), so the
applier is a pure string splicer — no more `[warn] ambiguous pattern`
fallbacks, no guessing which of two same-looking lines the rule meant.
Overlapping edits between rules are detected and surfaced as
`fix.editConflict` diagnostics instead of silently dropped.

### Changed (breaking — fix API)

- `SourceEdit` is a discriminated union by `kind`:
  - `{ kind: "replace"; range: SourceLocation; content: string }`
  - `{ kind: "remove"; range: SourceLocation }`
  - `{ kind: "insert-after"; anchor: SourceLocation; content: string }`
  - `{ kind: "insert-before"; anchor: SourceLocation; content: string }`

  The old `{ type, search, content }` shape is gone. Custom rule
  authors anchor edits on the node's `sourceLocation` directly —
  `model.elements[name].sourceLocation`, `rel.sourceLocation`, etc.

- `RuleDefinition.fix` now takes a single `FixContext<O>` argument:
  ```ts
  fix?(ctx: { model, violations, syntax, options }): readonly FixResult[]
  ```
  Bag-of-args so future additions (raw source string, multi-file map)
  land as additive optional fields without changing the call shape.
- `FormatSyntax` (renamed from `SourceSyntax`) is reduced to two
  content-builders: `containerDecl` and `relationDecl`. The
  `containerPattern` / `relationPattern` regex builders are gone —
  range-based edits don't need them.
- `relationDecl` signature changed from positional
  `(from, to, tech?, tags?)` to `(from, to, opts?: RelationDeclOptions)`
  where `opts = { description?, technology?, tags? }`. The old shape
  conflated `description` (PUML positional 3 = label) with
  `technology` (positional 4 = techn) — every rule fix that passed
  `rel.technology` was actually overwriting the label slot. Now both
  fields land in the correct PUML / Structurizr DSL positions and
  survive a rewire intact.
- `applyEdits(source, edits)` returns a structured result
  `{ content, applied, conflicts }`. Pure function, no `consola.warn`
  side effects — the CLI surfaces conflicts as diagnostics instead.

### Documentation

- `SourcePosition.offset` JSDoc now states explicitly that the value
  is a 0-based **UTF-16 code unit** index — matching JS string
  semantics, chevrotain's `token.startOffset` / `endOffset`, and
  LSP's default `positionEncoding: "utf-16"`. The previous wording
  said "byte offset" which was wrong: applying `String.prototype.slice`
  to a byte offset would land mid-glyph on cyrillic / emoji / CJK
  content. Producer and consumer always agreed on the unit; only the
  docstring lied. Regression tests pin the invariant through both
  `applyEdits` directly and the full `crud --fix` rewrite path on a
  PUML source containing non-ASCII labels.

### Added

- `fix.editConflict` diagnostic kind. Emitted when two fix edits want
  to touch overlapping source ranges. The applier keeps the first one
  (deterministic, input order), reports the rest with `kept` /
  `skipped` / `keptAt` / `skippedAt` context. Re-running `--fix`
  after a conflict picks up the dropped edit if it's still applicable.
- `editLocation(edit): SourceLocation` helper in `rules/lib/applyEdits`
  for callers (CLI, diagnostics, future LSP) that need to display
  edit positions without re-matching the discriminant.
- `RelationSpec.sourceLocation` / `ElementSpec.sourceLocation` in
  `test/helpers/makeModel` — lets rule tests synthesize models that
  the range-based fix engine can operate on without a parser pass.

### Migration

Custom rule with a `fix`:

```ts
// Before (beta.9)
fix(model, violations, syntax, options) {
  return violations.map((v) => ({
    rule: "myRule",
    description: "...",
    edits: [
      { type: "replace", search: syntax.relationPattern(v.element, "x"),
        content: syntax.relationDecl(v.element, "y") },
    ],
  }));
}

// After (beta.10)
fix({ model, violations, syntax }) {
  return violations.flatMap((v) => {
    const rel = model.elements[v.element]?.relations.find((r) => r.to === "x");
    if (!rel?.sourceLocation) return [];
    return [{
      rule: "myRule",
      description: "...",
      edits: [
        { kind: "replace", range: rel.sourceLocation,
          content: syntax.relationDecl(v.element, "y") },
      ],
    }];
  });
}
```

## v3.0.0-beta.9 — 2026-05-19

C4 vocabulary alignment is the headline of this beta — the wrapper type
that aggregates every architectural node was named `Container` for
historical reasons, which collided with C4's own level-2 `Container`
concept. Renamed to `Element` everywhere it surfaces in the public API.
Custom rules and JSON envelope consumers have to update one field name
(`container` → `element`); the C4 `kind: "Container"` literal value is
unchanged.

### Added

- `aact init` now scaffolds a starter architecture that demonstrates
  name-pattern role detection out of the box: `orders_repo` ships
  without `$tags="repo"` but is auto-detected as a repository by the
  default `*_{repo,…}` picomatch glob. Two intentional violations
  (`crud` + `dbPerService`) clear in one `--fix` pass — closer to
  importing a legacy archive than the prior single-rule demo.
- All 8 built-in rules now anchor violations on the precise source
  range that broke the principle. `stableDependencies` and
  `commonReuse` were the last two falling back to the source element's
  location through the CLI helper; both now point directly at the
  offending edge. With this every text-mode lint line and every
  GitHub-annotation comment lands on the source position the rule flagged.

### Changed

- `docs/format-coverage.md` refreshed to the post-beta.7 reality:
  `sourceLocation` is documented as fully populated by chevrotain
  loaders, the `Relation.order` and `Boundary.description` PUML gaps
  are gone (covered since the chevrotain cutover), and the
  "plantuml-parser 0.4 limit" framing was removed — the dep was
  excised in commit `642ff23`.
- `BoundaryKind` JSDoc clarifies that `Component_Boundary` does not
  exist in C4-PlantUML stdlib; the `"Component"` kind is preserved
  for model-level fidelity but `aact generate` for PUML falls back
  to `Container_Boundary` (the canonical way to group components per
  the stdlib).
- `WorkspaceMetadata` JSDoc trimmed to match the actual shape —
  earlier wording mentioned `version` and `properties` fields that
  never made it onto the type. Linting rules don't need them.

### Changed (breaking — v3 API)

- C4 vocabulary alignment: `Container` is no longer the umbrella term for
  every architectural node in the model. The model now uses `Element` as
  the level-agnostic abstraction (Person / System / Container /
  Component all live in `model.elements`), matching the C4 spec's own
  vocabulary. The `kind: "Container"` literal value is unchanged — it
  remains a valid C4 level-2 kind.
- Public type / helper / field renames:
  - `Container` → `Element`
  - `ContainerKind` → `ElementKind`
  - `Model.containers` → `Model.elements`
  - `allContainers()` → `allElements()`
  - `getContainer()` → `getElement()`
  - `Boundary.containerNames` → `Boundary.elementNames`
  - `Violation.container` → `Violation.element`
  - `CheckViolation.container` → `CheckViolation.element` (JSON envelope
    field `data.violations[].container` → `.element`)
  - `ModelBuildInput.containers` → `ModelBuildInput.elements`
  - `ModelIssue` field `container` → `element` on `self-relation`,
    `unknown-kind`, `element-in-boundary-not-in-model` variants
  - `ModelIssue.kind` values: `container-in-boundary-not-in-model` →
    `element-in-boundary-not-in-model`, `duplicate-container-name` →
    `duplicate-element-name`
  - `DiagnosticKind` values: `model.containerInBoundaryNotInModel` →
    `model.elementInBoundaryNotInModel`, `model.duplicateContainerName`
    → `model.duplicateElementName`
- Migration for custom rules: rename the `container` key in returned
  violations to `element`. Type errors surface every call site at compile
  time; no runtime fallback / alias is shipped.

## v3.0.0-beta.8 — 2026-05-19

Lint-style output with clickable violations and name-pattern role
detection. The `SourceLocation` foundation from beta.7 now powers
OSC8 terminal hyperlinks and eslint-style `path:line:col error rule
message` output. Rules pick up implicit roles from container naming
conventions, so legacy archives and agent-generated diagrams converge
in a single `--fix` pass without spurious `_repo` duplicates.

### Added

- `aact check` text output rewritten in eslint style:
  `arch.dsl:13:1  error  crud  orders: directly accesses orders_db`.
  Auto-aligned columns; the location column is an OSC8 hyperlink in
  TTYs that support it (iTerm2, Ghostty, VSCode terminal, Windows
  Terminal, modern tmux). CI logs, piped output, and older
  terminals automatically fall back to plain text.
- `CheckViolation.sourceLocation?: SourceLocation` in the JSON
  envelope — `aact check --json` consumers (Claude Code / Codex
  CLI / dashboards) get the violation's source anchor. Falls back
  to the container's location when the rule doesn't anchor more
  precisely.
- `file=<path>,line=<L>,col=<C>` attributes on GitHub Actions
  error annotations — violations surface as inline PR comments
  anchored to the offending position instead of generic workflow-log
  entries.
- 5 built-in rules now anchor violations on the precise relation /
  boundary that broke the principle (acl, acyclic, crud,
  dbPerService, cohesion) — the remaining 3 fall back to the
  container's location through a shared helper.
- **Name-pattern role detection.** New options on 4 rules — picomatch
  globs with brace expansion (`*_{repo,repository,storage,dao,store}`,
  `*{Repository,Storage,DAO}`):
  - `acl.namePatterns`
  - `apiGateway.aclNamePatterns`
  - `crud.repoNamePatterns`
  - `dbPerService.ownerNamePatterns`

  Rules treat a container as repo / acl / owner even without an
  explicit tag when its name matches a pattern. `crud --fix` rewires
  through the existing name-matched repo and promotes its tag in one
  pass — no duplicate `_repo` container created for legacy archives.
  Closes a reported friction on importing an aact-naive codebase.

- `Violation.sourceLocation?: SourceLocation` on the rule API —
  custom rules can set it to anchor diagnostics on a specific
  relation / boundary / property. Legacy rules (just `container` +
  `message`) get fallback anchoring through the container
  automatically.
- `formatLocation(loc): string` exported from the library — pure-
  data `<file>:<line>:<col>` formatter for callers rendering text
  outside the terminal (Slack, PR descriptions, dashboards).

### Dependencies

- Added `terminal-link@^5.0.0` (Sindre Sorhus). Handles
  OSC8-capability detection across iTerm2, Ghostty, VSCode,
  Windows Terminal, tmux, and CI environments. ~5 KB total with
  transitive deps (`ansi-escapes` + `supports-hyperlinks` +
  `has-flag`).
- Added `picomatch@^4.0.0` (5M+ projects: Jest, Vitest, Astro,
  fast-glob, chokidar). Zero deps, blazing-fast glob matcher with
  brace-expansion support. Already a transitive dep via vitest, so
  promotion to direct is near-zero cost.

## v3.0.0-beta.7 — 2026-05-19

Architecture-as-code parsers rewritten from scratch on chevrotain;
every third-party parsing dependency is dropped. `SourceLocation`
(file + line + UTF-16 code-unit offset) now lands on every `Container` /
`Boundary` / `Relation`, anchored to original-file positions through
whitespace-preserving pre-lex strip passes (each pass preserves
string length so chevrotain offsets line up with the input).

### Added

- **Structurizr DSL chevrotain parser** (`src/formats/structurizr/parser/`).
  Replaces the v2 regex-based DSL loader with a typed lexer →
  parser → CST → AST → Model pipeline. Covers the full Structurizr
  DSL surface: model body, element bodies, body statements
  (`description` / `technology` / `tags` / `url` / `properties` /
  `perspectives`), explicit relationships (`a -> b`), group
  nesting with separator, `!const` / `!var` substitution,
  archetypes, selectors, deployment family (parsed-then-info-issue),
  hard-removed constructs (`!ref` / `enterprise` → typed error with
  modern-replacement hint), workspace metadata (`name` /
  `description` / `extends`). Verified against reference fixtures
  (`big-bank-plc.dsl`, `getting-started.dsl`, `this.dsl`,
  `multi-line.dsl`).
- **C4-PlantUML chevrotain parser** (`src/formats/plantuml/parser/`).
  Replaces the `plantuml-parser` 0.4.0 third-party adapter end-to-
  end. Covers all C4 stdlib macros: element family (Person /
  System* / Container* / Component* + `_Ext` / `Db` / `Queue`
  variants), boundary family (Enterprise / System / Container +
  generic with `$type`), Rel family (12 variants including
  `Rel_Back_Neighbor`), RelIndex family (12 variants), BiRel family
  (10 variants), Lay\_* layout hints. Five pre-lex strip passes for
  preprocessor directives, opaque macros, deployment blocks,
  PlantUML native syntax, and multi-diagram trimming. 14 of 17
  reference fixtures from `.parser-refs/C4-PlantUML/samples/`
  load with zero parse errors; the 3 exclusions (sequence flavour
  and deprecated `$index-N` old format) are pinned in tests and
  documented in `grammar.md §8`.
- **`SourceLocation` on every `Container` / `Boundary` / `Relation`**.
  Foundation for terminal OSC8 file:line:col links, AST-aware fixes
  ("replace bytes 1024..1051" instead of regex search/replace), and
  precise CLI diagnostics. Preserved through both parsers' pre-lex
  strip passes by replacing stripped content with same-length
  whitespace so chevrotain offsets stay anchored to the user's
  original file.

### Removed

- `plantuml-parser` 0.4.0 dependency. The chevrotain parser
  obsoletes the entire `Enteee/plantuml-parser`-based adapter
  layer; `src/formats/plantuml/lib/filterElements.ts` and the
  marker-strip pre-transform hacks (`$tags=` → `__aact_tags__:`,
  etc.) are gone with it.

### Internal

- Both parser stacks share the same shape: `tokens.ts` → `preParse.ts`
  → `parser.ts` → `visitor.ts` → `toModel.ts` → `index.ts`. The
  Structurizr stack has its own `preParse` for substitutions, opaque
  blocks, deployment strip, inline directives, and hard-removed
  errors. The PUML stack has five whitespace-preserving passes
  covering preprocessor / native / opaque / deployment / arithmetic
  / multi-diagram normalisation. Both produce a typed `FileNode` /
  `WorkspaceNode` AST that `toModel` lowers to `Model`.
- Roundtrip identity (`parse → Model → generate → re-parse → Model`)
  verified against 12 PUML reference fixtures and the canonical
  Structurizr DSL corpus.

## v3.0.0-beta.6 — 2026-05-18

Unified CLI output layer. Every command now speaks the same versioned
JSON envelope (`schemaVersion: 1`) and follows a tight exit-code
contract. This is the v3 API break window — review the Breaking section
before upgrading from beta.5.

### Breaking

- **`--format` dropped from `check` and `analyze`.** `--format json` is
  replaced by `--json` everywhere; no deprecation period. `--format`
  remains valid on `generate`, where it still means "artefact target"
  (`plantuml`, `kubernetes`, ...) — never an output renderer.
- **Exit code 2 for tool errors.** Missing source files, schema-invalid
  config, unknown formats, and any non-domain failure exit `2`,
  distinct from exit `1` (architecture violations). CI scripts and
  agent loops can now branch on tool-failure vs domain-failure.
- **`aact check --dry-run` exits 1 when violations remain** (was `0`).
  CI gates that depended on the previous behaviour will start blocking
  PRs with unresolved violations — typically the intended outcome.
- **`aact check --fix` exits 1 when violations remain after applying
  fixes** (was `0`). Same rationale.
- **JSON output is now a versioned envelope.** Previously each command
  emitted an ad-hoc shape (`check` wrapped in `{ results }`, `analyze`
  returned the raw report, `rule list` returned a bare array).
  Consumers must update their parsers.

### Added

- `--json` flag on every command: `init`, `check`, `analyze`,
  `generate`, `rule list`, `skill`. In JSON mode stdout is reserved for
  the envelope; warnings and progress go to stderr.
- `--config` flag on `rule list` (previously missing — c12
  auto-discovery only). All config-aware commands now accept it
  uniformly.
- Stable `DiagnosticKind` enum surfaced in
  `envelope.diagnostics[].kind` (`model.duplicateContainerName`,
  `config.unknownRule`, `format.missingWritePath`,
  `config.outputCollidesWithJson`, etc.). Agents and CI scripts can
  branch on the kind without scraping prose. New kinds are additive;
  renames or removals require a `schemaVersion` bump.
- `config.output.mode: "text" | "json"` in `aact.config.ts` for a
  project-wide default output mode. CLI `--json` still wins
  per-invocation.
- `aact generate --output -` — UNIX `-` sentinel explicitly routes the
  artefact to stdout. Multi-file artefacts (e.g. `kubernetes`) reject
  `-` with `config.missingOutputPath`.

### Changed

- `aact rule list` no longer silently swallows config errors. A broken
  or schema-invalid config exits 2 with a typed diagnostic instead of
  falling back to built-ins. A missing config (no file in cwd) still
  falls back to built-ins-only — the legitimate discovery use case.
- `aact check` no longer prints inline "Suggested fixes" outside
  `--dry-run` text mode. Agents read `data.suggestedFixes[]` from the
  JSON envelope; humans see the preview only when they ask via
  `--dry-run`.
- `aact generate --json --output <file>` writes the artefact to disk
  and emits the envelope on stdout. `aact generate --json` without
  `--output` exits 2 — the artefact and the envelope cannot both own
  stdout.
- GitHub Actions annotations still auto-enable on `aact check` when
  `GITHUB_ACTIONS=true` is set; the explicit `--format=github` flag is
  gone alongside `--format=json`.

### Internal

- New `src/cli/output/` module owns every `stdout`/`stderr` write.
  Commands return a typed `ExecuteResult<TData>`; the wrapper
  (`cliCommand` / `cliCommandWithConfig`) picks `JsonReporter` or
  `HumanReporter` and exits with `envelope.exitCode`. The only
  remaining command-side `process.stdout.write` lives in `generate.ts`
  for explicit `--output -` artefact streaming.

### Migration

```bash
# Before
aact check --format json | jq '.results[]'
aact analyze --format json

# After
aact check --json | jq '.data.violations[]'
aact analyze --json | jq '.data'
```

Exit-code matrix for CI / agents:

```bash
aact check --json > report.json
case $? in
  0) ;;                                # clean
  1) echo "Violations remain" ;;       # domain failure
  2) echo "aact tool error" ;;         # config / source / format
esac
```

## v3.0.0-beta.5 — 2026-05-17

Agent skill installer. No library API changes; safe upgrade.

### Added

- `aact skill` / `aact skill install` command for installing the community
  `aact-architect` skill from
  `https://github.com/ChS23/aact-architect-skill.git`.
- Client targets for shared Agent Skills (`~/.agents/skills`), Claude Code
  (`~/.claude/skills`) and Cline (`~/.cline/skills`). Codex, Cursor and
  GitHub Copilot resolve to the shared target.
- `--target`, `--repo`, `--ref`, `--force`, `--dry-run`, `--client` and
  per-client flags for controlled installation/update flows.

## v3.0.0-beta.4 — 2026-05-14

PlantUML loader robustness. No API changes; safe upgrade.

### Fixed

- `Component_Boundary` no longer crashes the PlantUML loader. The
  underlying `plantuml-parser` 0.4 grammar lacks this token; the loader
  now rewrites it to `Container_Boundary` before parsing and restores
  `kind: "Component"` from the captured aliases.
- `$index=` on a `Rel` no longer drops the entire relation. The named
  argument previously made `plantuml-parser` discard the relation
  silently; it is now extracted and populates `Relation.order` (both
  `$index=1` and `$index="1"` forms; non-numeric values degrade to
  `undefined`).

## v3.0.0-beta.3 — 2026-05-13

Docs / template polish on top of beta.2. No API changes; safe upgrade.

### Changed

- `aact init` template now includes a commented `customRules` block
  showing how to switch from the type-only import to `defineConfig` for
  project-specific rules. Type-only import remains the default so
  `npx aact@beta init` still works without a local install.

### Docs

- `examples/custom-rules/` reworked around two realistic rules:
  `bcIsolation` (DDD bounded-context isolation) and `requireOwnerTag`
  (operational ownership). README walks through anatomy, registration,
  and when to write a custom rule.

## v3.0.0-beta.2 — 2026-05-13

### Added

- `customRules: RuleDefinition[]` config field for project-specific rules.
  Auto-enabled; disable via `rules: { name: false }`; pass options via
  `rules: { name: { ... } }` — identical syntax to built-ins.
- `defineRule()` helper preserves the rule's literal `name` for
  TypeScript inference.
- `aact rule list` command. Shows the effective rule set with source
  labels (built-in / custom) and enabled state. Add `--json` for tooling.
- `examples/custom-rules/` — end-to-end example with two custom rules.

### Changed

- `defineConfig` is generic over its `customRules`. TypeScript now
  autocompletes custom rule names and option shapes in `rules{}`, the
  same as built-in rules.
- `config.rules` accepts unknown keys; typos surface as a runtime warning
  instead of a parse error.
- `RuleDefinition.check` / `.fix` are declared as methods so typed rules
  fit `RuleDefinition[]` arrays without casts.

### Conflict policy

A custom rule whose `name` matches a built-in or another custom rule is
rejected at startup. Prefix rule names per project (for example,
`acmeBffBoundary`) to keep them unique.

### Migration from beta.1

None. `customRules` is additive.

## v3.0.0-beta.1 — 2026-05-12

First v3 beta. Use for evaluation before the stable cut.

### Breaking

| v2                                               | v3                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `ArchitectureModel`                              | `Model`                                                                           |
| `model.allContainers`                            | `Object.values(model.containers)` or `import { allContainers } from "aact"`       |
| `model.allContainers.find(c => c.name === x)`    | `model.containers[x]` or `getContainer(model, x)`                                 |
| `model.allContainers.some(c => c.name === x)`    | `x in model.containers`                                                           |
| `container.type === "ContainerDb"`               | `container.kind === "ContainerDb"`                                                |
| `container.type === "System_Ext"`                | `container.external === true && container.kind === "System"`                      |
| `relation.to.name`                               | `relation.to` (it is the name now)                                                |
| `relation.to.kind`                               | `model.containers[relation.to]?.kind` or `targetOf(model, relation)?.kind`        |
| `boundary.containers`                            | `boundary.containerNames.map(n => model.containers[n]!)`                          |
| `boundary.boundaries`                            | `boundary.boundaryNames.map(n => model.boundaries[n]!)`                           |
| `boundary.type`                                  | `boundary.kind` (typed: `"System" \| "Container" \| "Component" \| "Enterprise"`) |
| `checkAcl(containers, options)`                  | `aclRule.check(model, options)`                                                   |
| `fixAcl(model, violations, syntax, options)`     | `aclRule.fix(model, violations, syntax, options)`                                 |
| `loadPlantumlElements(path)` + mapper            | `plantumlFormat.load(path)` returns `{ model, issues }`                           |
| `loadStructurizrElements(path)`                  | `structurizrFormat.load(path)`                                                    |
| `generatePlantumlFromModel(model)`               | `plantumlFormat.generate(model)`                                                  |
| `generateKubernetes(model)`                      | `kubernetesFormat.generate(model)`                                                |
| `EXTERNAL_SYSTEM_TYPE`, `CONTAINER_DB_TYPE`, ... | literal strings (`"System"`, `"ContainerDb"`)                                     |
| `import ... from "aact/loaders/..."`             | `import ... from "aact/formats/..."`                                              |
| `import ... from "aact/generators/..."`          | `import ... from "aact/formats/..."`                                              |

### Added

- `ContainerKind` typed union (full C4 stdlib: `Person`, `System`,
  `Container`, `ContainerDb`, `ContainerQueue`, `Component`, `ComponentDb`,
  `ComponentQueue`).
- `BoundaryKind` typed union (`System`, `Container`, `Component`,
  `Enterprise`).
- `external: boolean` orthogonal to `kind`. Replaces the `_Ext` kind
  variants from PlantUML and Mermaid.
- `validateModel(model)` returns `ModelIssue[]` for dangling references,
  duplicate names, boundary cycles, self-relations, and unknown kinds.
- `Container.technology`, `Container.sprite` (separated from tags),
  `Container.link`, `Container.properties`, `Relation.link`,
  `Relation.description`, `Relation.order`, `Boundary.link` — all
  preserved on round-trip.
- `Format` capability interface with `canLoad` / `canGenerate` / `canFix`
  type guards. Adding a format is a single folder under
  `src/formats/<name>/`.

### Changed

- One file per rule under `src/rules/<name>.ts` containing the full
  `RuleDefinition` object.
- `src/loaders/` and `src/generators/` collapsed into `src/formats/<name>/`.

### Removed

- The v1 YAML→PUML migrator (`src/generators/plantuml.ts`).
- `containerTypes.ts` constants, replaced by typed unions.
- Stringly-typed rule options (`externalType`, `dbType`); detection flows
  from typed `kind` / `external` fields.
- `enrichTagsFromNames` heuristic in the Structurizr loader.

### Known limitations

**Structurizr.** Component-level elements are not loaded yet. System-level
relations between internal `SoftwareSystem`s are dropped (internal systems
map to a `Boundary`, which has no outgoing relations). Dynamic-view step
ordering is not extracted.

**PlantUML (`plantuml-parser` 0.4).** Properties (`SetPropertyHeader` /
`AddProperty`), `Boundary` description, `$index=` for dynamic diagrams,
and `Component_Boundary` are not exposed by the parser. File:line source
locations are not populated yet.

**Kubernetes.** Generate-only; reverse-engineering from YAML is deferred
to a later v3.x.

## v2.1.5 — 2026-05-07

### Fixed

- `cohesion` rule: custom option values were ignored for inner
  boundaries; the rule now applies the configured external / internal
  types at every call site.
- `kubernetes` generator: `System` and `Component` elements leaked into
  the output. Switched to a whitelist — only `Container`-typed elements
  produce deployment YAML.
- `plantuml` generator: `System` and `Component` containers were
  re-rendered as `Container`, losing their C4 level. Both kinds are now
  emitted with the matching macro.

## v2.1.4 — 2026-05-07

### Changed

- README rewritten with a two-modes intro (CLI vs library).

### Fixed

- The fix preview in `aact check --fix` is labelled and aligned.

## v2.1.3 — 2026-05-07

### Added

- `aact init` scaffolds a runnable starter project (config plus
  `architecture.puml`).

### Changed

- Quick Start section in the README rewritten to match what `aact init`
  produces.

### Fixed

- Friendly error messages when the source file is missing or malformed,
  instead of raw Node stack traces.
- `aact --help` reads the version from `package.json` and stays in sync.
- Codex-review findings in the `crud` rule and `kubernetes` generator.

## v2.1.2 — 2026-03-31

### Fixed

- Added a default-export fallback in `package.json` so library consumers
  on legacy resolvers can still `import` from `aact`.

## v2.1.1 — 2026-03-21

### Fixed

- Added `jiti` as a runtime dependency so that loading `aact.config.ts`
  works without an additional install step.

## v2.1.0 — 2026-03-21

### Added

- `commonReuse` rule with its ADR.
- `apiGateway` rule.
- `stableDependencies` rule.
- Auto-fix for the `crud` rule.
- Naming-convention auto-detection for fix-generated identifiers
  (snake_case / camelCase / PascalCase) — fixes blend in with the rest
  of the project.
- Structurizr DSL output and a write-target workflow via
  `source.writePath` for `aact check --fix` against Structurizr inputs.
- `--config` flag on `check`, `analyze`, and `generate`.
- `ecommerce-structurizr` example.
- `aclSuffix` option on the `acl` rule.

### Changed

- Hardcoded type strings replaced by named constants throughout the
  loaders, rules, and generators.
- Boundary-aware redirect logic extracted into a shared helper used by
  the `dbPerService` fix.
- `O(1)` rule lookup in `generateFixes`; parallel writes for Kubernetes
  output; `Set`-based replacement for previously `O(n²)` patterns in hot
  paths.

### Fixed

- Source indentation is preserved when applying fix edits.
- Structurizr loader naming bug for nested elements.
- Cleaner CLI output (summary lines, fix preview layout).

## v2.0.2 — 2026-02-14

### Fixed

- CLI shebang line and npm keywords. Required for `npx aact` to resolve
  the bin correctly and for discoverability on the npm registry.

## v2.0.1 — 2026-02-14

### Fixed

- Re-publish shortly after v2.0.0 to correct an issue spotted in the
  freshly-published tarball.

## v2.0.0 — 2026-02-14

First v2 release. Full rewrite from the v1 hand-rolled checks.

### Added

- CLI with `check`, `generate`, and `init` commands.
- Built-in rules: `acl`, `acyclic`, `crud`, `dbPerService`, `cohesion`.
- Auto-fix for `acl` and `dbPerService` rules with a `SourceSyntax`
  adapter for PlantUML.
- Code generators for PlantUML and Kubernetes manifests.
- Structurizr DSL loader.
- Architecture metrics (`aact analyze`) over boundaries (cohesion,
  coupling, instability, nested attribution).
- Config validation via `valibot` (`aact.config.ts`).
- Rule registry as the extension point for built-ins.

### Changed

- TypeScript- and ESM-first rewrite with modernised tooling.
- Project layout restructured to match the target ADR layout (`loaders/`,
  `generators/`, `rules/`, `cli/`).

## v1.0.0 — 2026-02-07

Initial publish. Hand-rolled boundary checks for a single example
PlantUML project, no CLI, no config schema. Superseded by the v2
rewrite.
