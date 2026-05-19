# Changelog

All notable changes to `aact` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## v3.0.0-beta.7 — 2026-05-19

Architecture-as-code parsers rewritten from scratch on chevrotain;
every third-party parsing dependency is dropped. `SourceLocation`
(file + line + byte offset) now lands on every `Container` /
`Boundary` / `Relation`, anchored to original-file bytes through
whitespace-preserving pre-lex strip passes.

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
