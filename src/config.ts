import * as v from "valibot";

import type { AclOptions } from "./rules/acl";
import type { AcyclicOptions } from "./rules/acyclic";
import type { ApiGatewayOptions } from "./rules/apiGateway";
import type { CohesionOptions } from "./rules/cohesion";
import type { CommonReuseOptions } from "./rules/commonReuse";
import type { CrudOptions } from "./rules/crud";
import type { DbPerServiceOptions } from "./rules/dbPerService";
import type { StableDependenciesOptions } from "./rules/stableDependencies";
import type { RuleDefinition } from "./rules/types";

const ruleOption = <T extends v.ObjectEntries>(entries: T) =>
  v.optional(v.union([v.boolean(), v.strictObject(entries)]));

/**
 * AactConfig — что пишет пользователь в `aact.config.ts`. Source + rules
 * (per-rule опции) + customRules (external RuleDefinition[]) + generate.
 *
 * v3: убраны legacy options (externalType, dbType, internalType) — kind
 * и external теперь typed fields на Model, а не configurable. Если нужно
 * переопределить detection — это сейчас loader-side concern, не rule.
 *
 * Source shape — accepts:
 *   1. String shorthand: `source: "./architecture.puml"` — type inferred from path
 *   2. Object form: `source: { path, type?, writePath? }` — type optional,
 *      inferred from path if missing; explicit overrides infer
 *
 * Type accepts arbitrary string (validated against runtime format registry at
 * load time) — добавление нового формата = entry в registry, не breaking-bump.
 *
 * Rules — looseObject: typed entries для built-ins (autocomplete +
 * options валидация), extra keys разрешены для custom rules. Custom rule
 * options проверяются на check() time через rule.optionsSchema (если есть).
 *
 * CustomRules — array of RuleDefinition. Auto-enabled при load'е (не нужно
 * писать `rules: { myRule: true }`). Чтобы выключить — `rules.<name>: false`.
 */
export const AactConfigSchema = v.strictObject({
  source: v.union([
    v.string(),
    v.strictObject({
      path: v.string(),
      /** Optional — infer'ится из `path` через format registry `defaultPattern` если опущен. */
      type: v.optional(v.string()),
      /** Structurizr only: куда писать fix'ы (workspace.dsl). */
      writePath: v.optional(v.string()),
    }),
  ]),
  rules: v.optional(
    v.looseObject({
      acl: ruleOption({
        tag: v.optional(v.string()),
      }),
      // The four option-less rules accept `boolean | {}` so the
      // config shape is symmetric with the option-bearing rules.
      // `ruleOption({})` produces `boolean | strictObject({})` —
      // empty object literal is the only accepted object form
      // until any of these rules grows real options (at which
      // point the entry widens additively).
      acyclic: ruleOption({}),
      apiGateway: ruleOption({
        aclTag: v.optional(v.string()),
        gatewayPattern: v.optional(v.instance(RegExp)),
      }),
      crud: ruleOption({
        repoTags: v.optional(v.array(v.string())),
      }),
      dbPerService: ruleOption({
        ownerTags: v.optional(v.array(v.string())),
      }),
      cohesion: ruleOption({}),
      stableDependencies: ruleOption({}),
      commonReuse: ruleOption({}),
    }),
  ),
  // RuleDefinition содержит function fields (check/fix) — valibot не валидирует
  // shape глубже массива. Структурная проверка делается в check.ts на activation
  // time (name/check required, conflict detection vs built-ins).
  customRules: v.optional(v.array(v.any())),
  generate: v.optional(
    v.strictObject({
      kubernetes: v.optional(
        v.strictObject({
          path: v.optional(v.string()),
        }),
      ),
      boundaryLabel: v.optional(v.string()),
    }),
  ),
  output: v.optional(
    v.strictObject({
      mode: v.optional(v.picklist(["text", "json", "sarif"])),
    }),
  ),
});

/**
 * Built-in rules config — handcrafted interface (вместо v.InferOutput) чтобы
 * TS user получал чистые option types в `rules{}` без `[key: string]: unknown`
 * index-signature leak из looseObject inference.
 *
 * Runtime parsing идёт через `AactConfigSchema.rules` looseObject; этот TS-тип
 * это user-facing surface для autocomplete.
 */
export interface BuiltinRulesConfig {
  readonly acl?: boolean | AclOptions;
  readonly acyclic?: boolean | AcyclicOptions;
  readonly apiGateway?: boolean | ApiGatewayOptions;
  readonly crud?: boolean | CrudOptions;
  readonly dbPerService?: boolean | DbPerServiceOptions;
  readonly cohesion?: boolean | CohesionOptions;
  readonly stableDependencies?: boolean | StableDependenciesOptions;
  readonly commonReuse?: boolean | CommonReuseOptions;
}

/**
 * Extract'ит options type из RuleDefinition'а через сигнатуру `check(model, options?: O)`.
 * Используется defineConfig'ом для inference custom rule options types в `rules{}`.
 */
type ExtractRuleOptions<R> = R extends RuleDefinition
  ? Exclude<Parameters<R["check"]>[1], undefined>
  : never;

/**
 * Maps кастомные правила к их config-shape: `{ <rule.name>?: false | options }`.
 * Через `<const C>` в defineConfig — TS preserves литеральные имена,
 * R['name'] становится narrow string literal, а не `string`.
 */
export type CustomRulesConfig<C extends readonly RuleDefinition[]> = {
  readonly [R in C[number] as R["name"]]?: boolean | ExtractRuleOptions<R>;
};

export type AactRulesConfig<C extends readonly RuleDefinition[]> =
  BuiltinRulesConfig & CustomRulesConfig<C>;

/**
 * Raw user-facing shape — это что юзер пишет в aact.config.ts. Generic'и
 * подбираются через `defineConfig<const C>` чтобы дать autocomplete на
 * custom rule options в `rules{}`.
 */
export interface AactConfigInput<
  C extends readonly RuleDefinition[] = readonly RuleDefinition[],
> {
  readonly source:
    | string
    | {
        readonly path: string;
        readonly type?: string;
        readonly writePath?: string;
      };
  readonly rules?: AactRulesConfig<C>;
  readonly customRules?: C;
  readonly generate?: v.InferInput<typeof AactConfigSchema>["generate"];
  readonly output?: v.InferInput<typeof AactConfigSchema>["output"];
}

/** Normalized — то что `loadAndValidateConfig` возвращает. Source всегда object с populated `type`. */
export interface AactConfig {
  readonly source: {
    readonly path: string;
    readonly type: string;
    readonly writePath?: string;
  };
  readonly rules?: BuiltinRulesConfig & Readonly<Record<string, unknown>>;
  readonly customRules?: readonly RuleDefinition[];
  readonly generate?: v.InferOutput<typeof AactConfigSchema>["generate"];
  readonly output?: v.InferOutput<typeof AactConfigSchema>["output"];
}

/**
 * Typed config builder. `<const C>` captures customRules array's literal type
 * — каждое правило сохраняет свой `name` (literal) и `Parameters<check>[1]`
 * (options type). Через mapped type `CustomRulesConfig<C>` это даёт user'у
 * autocomplete + type validation на `rules: { customRuleName: { ←tab } }`.
 */
export const defineConfig = <const C extends readonly RuleDefinition[]>(
  config: AactConfigInput<C>,
): AactConfigInput<C> => config;
