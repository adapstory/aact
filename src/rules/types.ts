import type { FormatSyntax } from "../formats/types";
import type { Model, SourceLocation } from "../model";

export interface Violation {
  readonly element: string;
  readonly message: string;
  /**
   * Optional location pointing at the offending construct in source.
   * When omitted, the CLI falls back to
   * `model.elements[element].sourceLocation` so that rules emitting
   * just `element` + `message` still get diagnostic anchoring "for
   * free". Rules that flag a specific relation / boundary / property
   * may set this explicitly to point at the more precise byte range.
   */
  readonly sourceLocation?: SourceLocation;
}

/**
 * A single source-code edit, expressed in terms of byte ranges from the
 * model's `SourceLocation`. The loader populates `SourceLocation` on
 * every Element / Boundary / Relation it emits; rules anchor edits on
 * those locations so the applier never has to guess what text to match.
 *
 * Four variants cover the full surface:
 *   - `replace`     — replace the bytes covered by `range` with `content`
 *   - `remove`      — delete the bytes covered by `range`
 *   - `insert-after`  — splice `content` immediately after `anchor.end.offset`
 *   - `insert-before` — splice `content` immediately before `anchor.start.offset`
 *
 * The applier is a pure byte-splicer (see `applyEdits`). It does not
 * interpret indentation, newlines, or comments — rules are responsible
 * for emitting `content` already framed (leading `\n`, trailing
 * whitespace, etc.) as required by the target format.
 *
 * Future-additive: more variants can be added to this union without
 * breaking plugins that ignore them; the applier returns a `conflicts`
 * list so unknown / overlapping edits surface as diagnostics rather
 * than silent drops.
 */
export type SourceEdit =
  | {
      readonly kind: "replace";
      readonly range: SourceLocation;
      readonly content: string;
    }
  | { readonly kind: "remove"; readonly range: SourceLocation }
  | {
      readonly kind: "insert-after";
      readonly anchor: SourceLocation;
      readonly content: string;
    }
  | {
      readonly kind: "insert-before";
      readonly anchor: SourceLocation;
      readonly content: string;
    };

export interface FixResult {
  readonly rule: string;
  readonly description: string;
  readonly edits: readonly SourceEdit[];
}

/**
 * Bag-of-args passed to `RuleDefinition.fix`. Single object so future
 * inputs (raw source string, multi-file map, agent hooks) land as
 * additive optional fields without changing the call signature for
 * existing plugins.
 */
export interface FixContext<O = unknown> {
  readonly model: Model;
  readonly violations: readonly Violation[];
  readonly syntax: FormatSyntax;
  readonly options: O | undefined;
}

/**
 * Function-type aliases — useful когда user пишет check / fix отдельно от
 * RuleDefinition объекта. Внутри RuleDefinition объявлены как методы
 * (bivariant): `RuleDefinition<MyOptions>` assignable to
 * `RuleDefinition<unknown>`, чтобы typed rules без cast'а попадали в
 * `customRules: readonly RuleDefinition[]`.
 */
export type CheckFn<O = unknown> = (
  model: Model,
  options?: O,
) => readonly Violation[];

export type FixFn<O = unknown> = (ctx: FixContext<O>) => readonly FixResult[];

export interface RuleDefinition<O = unknown> {
  readonly name: string;
  /** Human-readable description — для CLI `rules list`, docs, CHANGELOG. */
  readonly description: string;
  // Method syntax (не arrow property) — bivariant под strictFunctionTypes,
  // чтобы typed RuleDefinition<O> упаковывался в RuleDefinition[] arrays
  // (customRules, registry) без манипуляций.
  check(model: Model, options?: O): readonly Violation[];
  fix?(ctx: FixContext<O>): readonly FixResult[];
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
