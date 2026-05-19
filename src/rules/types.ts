import type { SourceSyntax } from "../formats/types";
import type { Model, SourceLocation } from "../model";

export interface Violation {
  readonly container: string;
  readonly message: string;
  /**
   * Optional location pointing at the offending construct in source.
   * When omitted, the CLI falls back to the violation's container's
   * `model.containers[container].sourceLocation` so that legacy rules
   * (that emit just `container` + `message`) still get diagnostic
   * anchoring "for free". Rules that flag a specific relation /
   * boundary / property may set this explicitly to point at the more
   * precise byte range.
   */
  readonly sourceLocation?: SourceLocation;
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
 * Function-type aliases — useful когда user пишет check / fix отдельно от
 * RuleDefinition объекта. Внутри RuleDefinition объявлены как методы
 * (bivariant): `RuleDefinition<MyOptions>` assignable to `RuleDefinition<unknown>`,
 * чтобы typed rules без cast'а попадали в `customRules: readonly RuleDefinition[]`.
 *
 * Fix получает `SourceSyntax` (regex primitives). Будущее — `FixCapability`
 * с AST primitives. Эволюция non-breaking: добавляется новое поле SourceSyntax.
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
  // Method syntax (не arrow property) — bivariant под strictFunctionTypes,
  // чтобы typed RuleDefinition<O> упаковывался в RuleDefinition[] arrays
  // (customRules, registry) без манипуляций.
  check(model: Model, options?: O): readonly Violation[];
  fix?(
    model: Model,
    violations: readonly Violation[],
    syntax: SourceSyntax,
    options?: O,
  ): readonly FixResult[];
}

/**
 * Identity helper для inline RuleDefinition declaracий. Generic с `<const T>`
 * сохраняет literal type для всех полей — particularly `name`, что позволяет
 * defineConfig'у через mapped type вытащить literal rule name и propagate'нуть
 * autocomplete в `rules{}`.
 *
 * `T extends RuleDefinition` (constraint без widening через `extends`) валидирует
 * shape без потери literal'ов.
 *
 * Built-ins и custom rules используют один и тот же `RuleDefinition<O>` —
 * defineRule одинаково применим к обоим.
 */
export const defineRule: <const T extends RuleDefinition>(rule: T) => T = (
  rule,
) => rule;
