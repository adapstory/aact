# Changelog

## v3.0.0-beta.1 — Foundations (beta)

**Beta release.** Core API (Model, Format, Rule) finalized; partial test
suite migrated, full pipeline not yet validated. Use for evaluation and
feedback before stable v3.0.0 ships.

aact 3.0 — major bump для Solution Architects, использующих C4 для конкретных
решений. Один раз breaking Model API, дальше additive minor releases без боли.

### Why this release

- **Понятные слои + унификация** — code structure для лёгкого вклада контрибьюторов
- **Self-sufficient C4 Model** — round-trip через PlantUML/Mermaid/Structurizr без
  потерь данных (technology, sprite, link, description, properties)
- **Capability-based Format API** — добавление нового формата = одна папка
  `src/formats/<name>/`, zero core changes
- **eslint-plugin-boundaries** — clear layers enforced в CI, не convention

### Breaking changes

Model API переработан. См. migration table ниже.

| v2                                                | v3                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ArchitectureModel`                               | `Model`                                                                           |
| `model.allContainers`                             | `Object.values(model.containers)` или `import { allContainers } from "aact"`      |
| `model.allContainers.find(c => c.name === x)`     | `model.containers[x]` или `getContainer(model, x)`                                |
| `model.allContainers.some(c => c.name === x)`     | `x in model.containers`                                                           |
| `container.type === "ContainerDb"`                | `container.kind === "ContainerDb"` (typed!)                                       |
| `container.type === "System_Ext"`                 | `container.external === true && container.kind === "System"`                      |
| `relation.to.name`                                | `relation.to` (it IS the name now)                                                |
| `relation.to.kind`                                | `model.containers[relation.to]?.kind` или `targetOf(model, relation)?.kind`       |
| `boundary.containers`                             | `boundary.containerNames.map(n => model.containers[n]!)`                          |
| `boundary.boundaries`                             | `boundary.boundaryNames.map(n => model.boundaries[n]!)`                           |
| `boundary.type`                                   | `boundary.kind` (typed: `"System" \| "Container" \| "Component" \| "Enterprise"`) |
| `JSON.stringify(model)`                           | `JSON.stringify(model)` — работает напрямую (Record<>, не Map)                    |
| `checkAcl(containers, options)`                   | `aclRule.check(model, options)`                                                   |
| `fixAcl(model, violations, syntax, options)`      | `aclRule.fix(model, violations, syntax, options)`                                 |
| `loadPlantumlElements(path)` + mapper             | `plantumlFormat.load(path)` returns `{ model, issues }`                           |
| `loadStructurizrElements(path)`                   | `structurizrFormat.load(path)`                                                    |
| `generatePlantumlFromModel(model)`                | `plantumlFormat.generate(model)` returns `FormatOutput`                           |
| `generateKubernetes(model)`                       | `kubernetesFormat.generate(model)` returns `FormatOutput`                         |
| `EXTERNAL_SYSTEM_TYPE`, `CONTAINER_DB_TYPE`, etc. | literal strings (`"System"`, `"ContainerDb"`) — TS подсветит typo                 |
| `import { ... } from "aact/loaders/..."`          | `import { ... } from "aact/formats/..."`                                          |
| `import { ... } from "aact/generators/..."`       | `import { ... } from "aact/formats/..."`                                          |
| `analyzer.ts`                                     | `analyze.ts` (file renamed)                                                       |

### Added

- `ContainerKind` typed union: Person | System | Container | ContainerDb |
  ContainerQueue | Component | ComponentDb | ComponentQueue. Полный C4 stdlib.
- `BoundaryKind` typed union: System | Container | Component | Enterprise.
  Round-trip без шумного diff'а в git.
- `external: boolean` orthogonal к kind — заменяет System_Ext kind, покрывает
  все 8 `_Ext` вариантов PlantUML/Mermaid.
- `validateModel(model)` returns `ModelIssue[]` — dangling refs, duplicate names,
  boundary cycles, self-relations, unknown kinds. Заменяет silent drops в loader'ах.
- `Container.technology` — реально C4 поле, раньше silently lost в Structurizr.
- `Container.sprite` — отдельно от tags (раньше PlantUML sprite попадал в tags).
- `Container.link` / `Relation.link` / `Boundary.link` — `$link` для clickable diagrams.
- `Container.properties` — Structurizr archetype + arbitrary properties round-trip.
- `Relation.description` — PlantUML Rel label / Structurizr rel.description.
- `Relation.order` — Dynamic diagram sequence ($index=Index() / dynamic step).
- `SourceLocation` foundation — file+line tracking для future terminal-link OSC8.
- `buildModel({ containers, boundaries, rootBoundaryNames })` — единая точка
  construction'а Model с dedup + validate pipeline.
- `src/formats/_shared/` — c4Mapping, kindHeuristics, tags, biRel helpers.
- `Format` capability-based interface с `canLoad` / `canGenerate` / `canFix`
  type guards.
- eslint-plugin-boundaries — architectural layer enforcement в CI.

### Changed

- Project structure: `src/loaders/` + `src/generators/` collapsed into
  `src/formats/<name>/`. Один folder = один формат с load + generate + syntax.
- Rules collapsed: каждое правило — единый файл `src/rules/<name>.ts` с
  RuleDefinition объектом (check + fix + options + description).
- `resources/` renamed to `fixtures/` — это test data, не runtime resources.

### Removed

- `src/generators/plantuml.ts` (v1 YAML→PUML migrator, не используется в v3).
- `containerTypes.ts` constants — replaced typed unions.
- Stringly-typed options (externalType, dbType в правилах) — теперь через
  typed `kind`/`external` flag.
- `enrichTagsFromNames` heuristic в Structurizr loader.

### Beta status

This is a beta release. Known gaps before stable 3.0.0:

- ~22 test files в `test/` и `examples/` ещё используют v2 API. 8 rule
  check tests мигрированы as proof-of-pattern. Остальные mechanical rewrites.
- Full pipeline (`pnpm test:coverage` + `pnpm test:mutation`) не зелёный.
- E2E tests против собранного CLI требуют верификации.

После migration оставшихся тестов и validation pipeline'а → stable 3.0.0.

### Known limitations

**Structurizr:**

- Component-level элементы не загружаются (opt-in в future minor).
- System-level relations на internal SoftwareSystems silently дропаются — internal system мапится в Boundary, у которого нет relations. Container-level и cross-system-external relations работают.
- Dynamic view step ordering (Relation.order) — пока не извлекается из `views[].dynamic`.

**PlantUML (plantuml-parser 0.4 limitations):**

- `SetPropertyHeader` / `AddProperty` macros — parser не expose'ит, Container.properties для PUML always undefined.
- `Boundary` description (6-й positional arg) — parser принимает только 4 positional, descr не доступен.
- `$index=` для Dynamic diagrams — Relation.order undefined для PUML.
- `Component_Boundary` macro — parser падает на нём (упоминается в filterElements list как dead branch).
- File:line source locations — foundation в типах есть (Container.sourceLocation), но loader пока не заполняет. Planned v3.x.

Каждый gap pinned тестом в `test/formats/plantuml/load.test.ts` под `KNOWN GAP:` describe block. Подъём этих limitations = v3.x parser strategy (chevrotain replacement of plantuml-parser).

**Kubernetes:**

- Generate only. Load (reverse-engineering) deferred к v3.x.

**General IaC (k8s, future Docker Compose):**

- Heuristic mapping (technology hints, image patterns), не proper C4 sources. Document какой semantic mapping корректен per-format.

### Migration tooling

Manual migration через table выше. `codemod-aact-v2-to-v3` через ts-morph не
делаем (users-as-library пара человек — manual достаточно).
