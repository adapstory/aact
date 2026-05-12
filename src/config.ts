import * as v from "valibot";

const ruleOption = <T extends v.ObjectEntries>(entries: T) =>
  v.optional(v.union([v.boolean(), v.strictObject(entries)]));

/**
 * AactConfig — что пишет пользователь в `aact.config.ts`. Source + rules
 * (per-rule опции) + generate (target-specific options).
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
    v.strictObject({
      acl: ruleOption({
        tag: v.optional(v.string()),
      }),
      acyclic: v.optional(v.boolean()),
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
      cohesion: v.optional(v.boolean()),
      stableDependencies: v.optional(v.boolean()),
      commonReuse: v.optional(v.boolean()),
    }),
  ),
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
});

/** Raw shape — что юзер пишет в aact.config.ts. */
export type AactConfigInput = v.InferInput<typeof AactConfigSchema>;

/** Normalized — то что `loadAndValidateConfig` возвращает. Source всегда object с populated `type`. */
export interface AactConfig {
  readonly source: {
    readonly path: string;
    readonly type: string;
    readonly writePath?: string;
  };
  readonly rules?: v.InferOutput<typeof AactConfigSchema>["rules"];
  readonly generate?: v.InferOutput<typeof AactConfigSchema>["generate"];
}

export const defineConfig = (config: AactConfigInput): AactConfigInput =>
  config;
