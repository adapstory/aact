import * as v from "valibot";

const ruleOption = <T extends v.ObjectEntries>(entries: T) =>
    v.optional(v.union([v.boolean(), v.strictObject(entries)]));

export const AactConfigSchema = v.strictObject({
    source: v.strictObject({
        type: v.picklist(["plantuml", "structurizr"]),
        path: v.string(),
        writePath: v.optional(v.string()),
    }),
    rules: v.optional(
        v.strictObject({
            acl: ruleOption({
                tag: v.optional(v.string()),
                externalType: v.optional(v.string()),
            }),
            acyclic: v.optional(v.boolean()),
            "adapstory-bff-boundary": ruleOption({
                bffTagPattern: v.optional(v.instance(RegExp)),
                allowedBcTags: v.optional(v.array(v.string())),
                targetApiTags: v.optional(v.array(v.string())),
                targetGatewayTags: v.optional(v.array(v.string())),
                allowedTargetNamePattern: v.optional(v.instance(RegExp)),
                pluginInternalTagPattern: v.optional(v.instance(RegExp)),
                pluginInternalNamePattern: v.optional(v.instance(RegExp)),
            }),
            "adapstory-no-core-bc-cycles": ruleOption({
                coreBcTags: v.optional(v.array(v.string())),
            }),
            "adapstory-external-through-gateway-or-acl": ruleOption({
                externalType: v.optional(v.string()),
                boundaryTags: v.optional(v.array(v.string())),
                boundaryNamePattern: v.optional(v.instance(RegExp)),
            }),
            "adapstory-schema-per-bc-not-db-per-service": ruleOption({
                dbType: v.optional(v.string()),
                sharedDatabasePattern: v.optional(v.instance(RegExp)),
                bcTagPattern: v.optional(v.instance(RegExp)),
                schemaMarkerPattern: v.optional(v.instance(RegExp)),
            }),
            "adapstory-plugin-capabilities-from-manifest": ruleOption({
                pluginTagPattern: v.optional(v.instance(RegExp)),
                capabilitySurfacePattern: v.optional(v.instance(RegExp)),
                provenancePattern: v.optional(v.instance(RegExp)),
            }),
            apiGateway: ruleOption({
                aclTag: v.optional(v.string()),
                externalType: v.optional(v.string()),
                gatewayPattern: v.optional(v.instance(RegExp)),
            }),
            crud: ruleOption({
                repoTags: v.optional(v.array(v.string())),
                dbType: v.optional(v.string()),
            }),
            dbPerService: ruleOption({
                dbType: v.optional(v.string()),
                ownerTags: v.optional(v.array(v.string())),
            }),
            cohesion: ruleOption({
                externalType: v.optional(v.string()),
                internalType: v.optional(v.string()),
            }),
            stableDependencies: ruleOption({
                externalType: v.optional(v.string()),
            }),
            commonReuse: v.optional(v.boolean()),
        }),
    ),
    generate: v.optional(
        v.strictObject({
            kubernetes: v.optional(
                v.strictObject({
                    path: v.optional(v.string()),
                    exclude: v.optional(v.array(v.string())),
                }),
            ),
            boundaryLabel: v.optional(v.string()),
        }),
    ),
});

export type AactConfig = v.InferOutput<typeof AactConfigSchema>;

export const defineConfig = (config: AactConfig): AactConfig => config;
