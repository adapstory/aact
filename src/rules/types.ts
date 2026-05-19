import type { FormatSyntax } from "../formats/types";
import type { Model, SourceLocation } from "../model";

/**
 * A rule violation. `target` is the name of the offending node;
 * `targetKind` says whether to look it up in `model.elements` or
 * `model.boundaries`. Most rules fire on elements (acl, crud,
 * acyclic, stableDependencies, apiGateway, dbPerService); two
 * boundary-level rules (cohesion, commonReuse) set
 * `targetKind: "boundary"` so consumers don't have to guess which
 * lookup table to use.
 *
 * `sourceLocation` is optional but strongly recommended — rules
 * that anchor on a specific relation / declaration give the CLI
 * (and any LSP / agent consumer) precise click-to-jump. When
 * omitted, the CLI falls back to the target node's own
 * `sourceLocation`.
 */
export interface Violation {
  readonly target: string;
  readonly targetKind: "element" | "boundary";
  readonly message: string;
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
