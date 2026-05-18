/**
 * Self-sufficient C4 Model for aact. Covers full PlantUML / Mermaid C4 /
 * Structurizr DSL API surface — round-trip без потерь данных для всех
 * популярных C4-as-code инструментов.
 *
 * Scope (намеренно): Solution Architect — C4 Static (L1/L2/L3) + System
 * Landscape + Dynamic. НЕ покрывается: Deployment view (System Architect /
 * kube-score territory), ArchiMate, UML, BPMN.
 *
 * Performance: Record<string, T> вместо Map<string, T> — на масштабе aact
 * (30-300 containers) V8 inline cache даёт ~1ns lookup, Map ~50ns. Плюс
 * JSON.stringify работает нативно, console.log показывает tree.
 */

/** C4 element types. Полный stdlib набор. */
export type ContainerKind =
  | "Person"
  | "System"
  | "Container"
  | "ContainerDb"
  | "ContainerQueue"
  | "Component"
  | "ComponentDb"
  | "ComponentQueue";

/**
 * Boundary types сохраняются для round-trip без шумного diff'а в git.
 * PlantUML автор писал `System_Boundary` / `Container_Boundary` /
 * `Component_Boundary` / `Enterprise_Boundary` — `aact generate` обязан
 * вернуть тот же ключ. Generic `Boundary(...)` мапится на "System".
 */
export type BoundaryKind = "System" | "Container" | "Component" | "Enterprise";

/**
 * A position within a source file. 1-based for `line` and `col` (matches
 * editor conventions and OSC8 terminal-link expectations). `offset` is
 * 0-based byte offset from the start of the file — required for
 * range-based AST fixes ("replace bytes 1024..1051" rather than regex
 * search/replace).
 *
 * All three are mandatory. If a position is not known, the enclosing
 * `SourceLocation` must be omitted entirely (it is optional on each
 * Model node) — never fabricated with placeholder values.
 */
export interface SourcePosition {
  readonly line: number;
  readonly col: number;
  readonly offset: number;
}

/**
 * A range within a source file: `start` and `end` `SourcePosition`s plus
 * the `file` they belong to. `end` is the position **after** the last
 * character of the parsed construct (half-open interval, matching
 * chevrotain and LSP conventions).
 *
 * The chevrotain parser populates this on every Container / Boundary /
 * Relation node it emits. Regex-based loaders may omit it entirely —
 * the field is optional on each Model node. When present, the range
 * must be complete (no partial fills); the new shape exists precisely
 * so that diagnostics, terminal-link OSC8, and AST-based fixes have
 * full information.
 */
export interface SourceLocation {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/**
 * Связь между двумя контейнерами. `to` — имя целевого контейнера (name-ref),
 * не объектная ссылка — это рвёт Container↔Relation цикл, делает Model
 * сериализуемой и упрощает test fixtures (`to: "containerB"` вместо ref'а).
 */
export interface Relation {
  /** Имя целевого контейнера. Lookup через `model.containers[rel.to]` или helper `targetOf(model, rel)`. */
  readonly to: string;
  /** Описание/label. PlantUML `Rel(from, to, label, ...)`, Structurizr `rel.description`. */
  readonly description?: string;
  /** Технология. PlantUML `Rel(..., ?techn, ...)`, Structurizr `rel.technology`. */
  readonly technology?: string;
  /** Tags всегда массив (пустой если нет тегов) — убирает `?.includes()` шум в правилах. */
  readonly tags: readonly string[];
  /** Sprite. PlantUML/Mermaid `Rel(..., ?sprite, ...)`. */
  readonly sprite?: string;
  /** Sequence number для Dynamic diagrams. PlantUML `$index=Index()`, Structurizr dynamic step. */
  readonly order?: number;
  /** $link для clickable diagrams. */
  readonly link?: string;
  /** Structurizr relation properties + perspectives (через `perspective.<name>` prefix). */
  readonly properties?: Readonly<Record<string, string>>;
  /** Foundation для terminal-link OSC8. Заполняется loader'ом где возможно. */
  readonly sourceLocation?: SourceLocation;
}

/**
 * C4 element: Person, System, Container или Component. `kind` — typed union,
 * не stringly. `external` — orthogonal flag (не отдельный `System_Ext` kind),
 * покрывает все 8 `_Ext` вариантов PlantUML/Mermaid одним полем.
 */
export interface Container {
  /** Уникальное имя — ключ в `model.containers`. PlantUML alias / Structurizr `structurizr.dsl.identifier`. */
  readonly name: string;
  /** Human-readable label. PlantUML `Container(alias, label, ...)`. */
  readonly label: string;
  /** Типизированный C4 kind. Compile-error на typo. */
  readonly kind: ContainerKind;
  /** Внешний контейнер (System_Ext, Container_Ext etc.). Orthogonal к kind. */
  readonly external: boolean;
  readonly description: string;
  /** C4 technology — Structurizr `cont.technology`, PlantUML `Container(alias, label, ?techn, ...)`. */
  readonly technology?: string;
  /** Tags всегда массив, не optional — убирает `?.includes()` в правилах. */
  readonly tags: readonly string[];
  /** PlantUML/Mermaid `?sprite` — отдельно от tags (раньше попадал в tags). */
  readonly sprite?: string;
  /** Исходящие relations. Целевые контейнеры — name-refs (`relation.to`). */
  readonly relations: readonly Relation[];
  /** $link для clickable diagrams. */
  readonly link?: string;
  /** Structurizr arbitrary properties (включая archetype name + perspectives через `perspective.<name>` prefix). */
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

/**
 * Структурная граница. `containerNames` и `boundaryNames` — name-refs, не
 * object-refs (как в `Relation.to`) — делает Model сериализуемой и упрощает
 * test fixtures.
 */
export interface Boundary {
  readonly name: string;
  readonly label: string;
  readonly kind: BoundaryKind;
  /** PlantUML Boundary `?descr`, Structurizr softwareSystem.description. */
  readonly description?: string;
  readonly tags: readonly string[];
  /** Имена контейнеров внутри этой границы. Lookup через `model.containers[name]`. */
  readonly containerNames: readonly string[];
  /** Имена вложенных boundaries. Lookup через `model.boundaries[name]`. */
  readonly boundaryNames: readonly string[];
  readonly link?: string;
  /** Structurizr softwareSystem properties (archetypes etc.). */
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

/**
 * Корневая Model. Record-based для O(1) lookup'ов на масштабе aact и native
 * JSON-сериализации. Все поля readonly — после loader-фазы модель immutable.
 */
export interface Model {
  readonly containers: Readonly<Record<string, Container>>;
  readonly boundaries: Readonly<Record<string, Boundary>>;
  /** Корневые boundaries — top-level в рендере. Все остальные boundary вложены через `boundaryNames`. */
  readonly rootBoundaryNames: readonly string[];
}
