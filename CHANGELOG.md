# Changelog

All notable changes to `aact` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
