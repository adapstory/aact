import type { SourceSyntax } from "../formats/types";
import type { Model } from "../model";

export interface Violation {
  readonly container: string;
  readonly message: string;
}

export interface SourceEdit {
  readonly type: "add" | "remove" | "replace";
  readonly search: string;
  readonly content?: string;
}

export interface FixResult {
  readonly rule: string;
  readonly description: string;
  readonly edits: readonly SourceEdit[];
}

/**
 * Uniform rule signature — все правила принимают `Model`, не `Container[]`.
 * Fix-функции получают `SourceSyntax` (regex primitives для inline edit'ов
 * в исходном файле). Будущее: `FixCapability` вместо `SourceSyntax` —
 * non-breaking когда AST primitives добавятся.
 */
export type CheckFn<O = unknown> = (
  model: Model,
  options?: O,
) => readonly Violation[];

export type FixFn<O = unknown> = (
  model: Model,
  violations: readonly Violation[],
  syntax: SourceSyntax,
  options?: O,
) => readonly FixResult[];

export interface RuleDefinition<O = unknown> {
  readonly name: string;
  /** Human-readable description — для CLI `rules list`, docs, CHANGELOG. */
  readonly description: string;
  readonly check: CheckFn<O>;
  readonly fix?: FixFn<O>;
}
