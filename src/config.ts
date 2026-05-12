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
 */
export const AactConfigSchema = v.strictObject({
  source: v.strictObject({
    type: v.picklist(["plantuml", "structurizr"]),
    path: v.string(),
    /** Structurizr only: куда писать fix'ы (workspace.dsl). */
    writePath: v.optional(v.string()),
  }),
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

export type AactConfig = v.InferOutput<typeof AactConfigSchema>;

export const defineConfig = (config: AactConfig): AactConfig => config;
