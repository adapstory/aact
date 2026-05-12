import type { BoundaryKind, ContainerKind } from "../../model";

/**
 * PlantUML C4 stdlib и Mermaid C4 имеют идентичные macro names (Microsoft
 * скопировали API). Один mapper покрывает оба формата.
 *
 * `external` orthogonal flag — для variants с `_Ext` суффиксом возвращаем
 * базовый kind + external=true. Это убирает 8 дополнительных kind'ов из
 * ContainerKind union'а.
 */
interface C4Kind {
  readonly kind: ContainerKind;
  readonly external: boolean;
}

const C4_KIND_MAP: Readonly<Record<string, C4Kind>> = Object.freeze({
  // Person
  Person: { kind: "Person", external: false },
  Person_Ext: { kind: "Person", external: true },
  // System / SystemDb / SystemQueue + _Ext variants
  System: { kind: "System", external: false },
  SystemDb: { kind: "System", external: false },
  SystemQueue: { kind: "System", external: false },
  System_Ext: { kind: "System", external: true },
  SystemDb_Ext: { kind: "System", external: true },
  SystemQueue_Ext: { kind: "System", external: true },
  // Container variants
  Container: { kind: "Container", external: false },
  ContainerDb: { kind: "ContainerDb", external: false },
  ContainerQueue: { kind: "ContainerQueue", external: false },
  Container_Ext: { kind: "Container", external: true },
  ContainerDb_Ext: { kind: "ContainerDb", external: true },
  ContainerQueue_Ext: { kind: "ContainerQueue", external: true },
  // Component variants
  Component: { kind: "Component", external: false },
  ComponentDb: { kind: "ComponentDb", external: false },
  ComponentQueue: { kind: "ComponentQueue", external: false },
  Component_Ext: { kind: "Component", external: true },
  ComponentDb_Ext: { kind: "ComponentDb", external: true },
  ComponentQueue_Ext: { kind: "ComponentQueue", external: true },
});

/**
 * Распарсить C4 macro name (PlantUML stdlib / Mermaid C4 — синтаксис идентичен)
 * в Container kind + external flag. Возвращает undefined для unknown macros —
 * loader решает что делать (fallback "Container" + warn, или сохранить
 * как "unknown-kind" ModelIssue).
 */
export const parseC4MacroKind = (macroName: string): C4Kind | undefined =>
  C4_KIND_MAP[macroName];

const BOUNDARY_KIND_MAP: Readonly<Record<string, BoundaryKind>> = Object.freeze(
  {
    Boundary: "System", // generic — sensible default
    System_Boundary: "System",
    Container_Boundary: "Container",
    Component_Boundary: "Component",
    Enterprise_Boundary: "Enterprise",
  },
);

/**
 * Распарсить boundary macro в BoundaryKind. Generic `Boundary(...)` без
 * префикса маппится на "System" (наиболее распространённый use case в
 * existing diagrams).
 */
export const parseBoundaryMacro = (macroName: string): BoundaryKind =>
  BOUNDARY_KIND_MAP[macroName] ?? "System";
