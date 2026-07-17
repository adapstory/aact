export const ADAPSTORY_ARCHITECTURE_RULE_PACK_VERSION = "v1";

export type AdapstoryArchitectureRulePackStatus =
  | "incubating"
  | "burn-in"
  | "blocking";

export interface AdapstoryArchitectureRulePackRule {
  readonly name: string;
  readonly status: AdapstoryArchitectureRulePackStatus;
  readonly intent: string;
  readonly sourceOfTruth: readonly string[];
  readonly remediation: readonly string[];
}

export const ADAPSTORY_ARCHITECTURE_RULE_PACK_RULES = [
  {
    name: "adapstory-no-core-bc-cycles",
    status: "burn-in",
    intent: "Core bounded contexts must not form dependency cycles.",
    sourceOfTruth: [
      "GitOps service topology",
      "OpenAPI clients",
      "package dependency graph",
      "reviewed bounded-context overlays",
    ],
    remediation: [
      "reverse or remove the cyclic dependency",
      "route collaboration through an approved API or domain event",
      "document a temporary exception only with owner and expiry",
    ],
  },
  {
    name: "adapstory-bff-boundary",
    status: "burn-in",
    intent:
      "BFFs may call approved BC APIs and gateways, not plugin internals or random infrastructure.",
    sourceOfTruth: [
      "BFF OpenAPI and generated SDK usage",
      "GitOps downstream configuration",
      "component tags in the generated architecture model",
    ],
    remediation: [
      "move plugin access behind Plugin Gateway or a capability API",
      "remove direct BFF infrastructure access unless an explicit policy exists",
      "model approved BC/API/gateway targets in source evidence",
    ],
  },
  {
    name: "adapstory-external-through-gateway-or-acl",
    status: "burn-in",
    intent:
      "Telegram, Dify, n8n, LLMs, and external APIs must be reached through an explicit gateway, ACL, or capability boundary.",
    sourceOfTruth: [
      "GitOps integration configuration",
      "plugin manifests",
      "source-code external client evidence",
      "reviewed capability-boundary overlays",
    ],
    remediation: [
      "introduce or tag the gateway/ACL/capability boundary",
      "move the external call behind that boundary",
      "approve the plugin itself as the boundary through reviewed overlay",
    ],
  },
  {
    name: "adapstory-schema-per-bc-not-db-per-service",
    status: "burn-in",
    intent:
      "Shared PostgreSQL is allowed only when logical schema ownership per bounded context is explicit.",
    sourceOfTruth: [
      "migration tooling",
      "GitOps database configuration",
      "relation tags in the generated model",
      "reviewed schema ownership overlays",
    ],
    remediation: [
      "add schema-per-BC ownership evidence to migrations or overlays",
      "assign owner BC tags to services that use shared PostgreSQL",
      "promote vendor/platform exceptions only with owner approval",
    ],
  },
  {
    name: "adapstory-plugin-capabilities-from-manifest",
    status: "burn-in",
    intent:
      "Plugin capability, MCP, and model surfaces are valid only when sourced from a manifest or reviewed overlay.",
    sourceOfTruth: [
      "plugin-manifest.yaml/json",
      "MCP capability manifests",
      "model configuration manifests",
      "reviewed capability overlays",
    ],
    remediation: [
      "add or fix plugin manifest provenance",
      "map manifest ownership to the generated component",
      "add a reviewed overlay for non-inferable approved capability surfaces",
    ],
  },
] as const satisfies readonly AdapstoryArchitectureRulePackRule[];

export const ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES =
  ADAPSTORY_ARCHITECTURE_RULE_PACK_RULES.map((rule) => rule.name);

export const ADAPSTORY_ARCHITECTURE_INCUBATING_RULES = [
  {
    name: "adapstory-widget-lake-contract",
    status: "incubating",
    intent:
      "Plugin UI and SDUI surfaces must declare a Widget Lake contract instead of private styling/runtime surfaces.",
    sourceOfTruth: [
      "plugin manifests",
      "Widget Lake UI devkit",
      "frontend composition contracts",
      "reviewed UI overlays",
    ],
    remediation: [
      "declare ui.contract: widget-lake-v1",
      "move plugin UI to WidgetShell, PluginSurface, and DataPanel primitives",
      "document a reviewed exception for trusted non-Widget-Lake UI",
    ],
  },
  {
    name: "adapstory-smart-line-tenant-scope",
    status: "incubating",
    intent:
      "Smart Line components must show explicit tenant-scoped request, session, event, and retrieval boundaries.",
    sourceOfTruth: [
      "Smart Line OpenAPI",
      "Redis session schema",
      "Kafka event contracts",
      "Neo4j/Qdrant retrieval adapters",
    ],
    remediation: [
      "propagate tenant evidence through Smart Line BFF/API boundaries",
      "persist session state with tenant-scoped keys",
      "filter retrieval and events by tenant before returning AI output",
    ],
  },
  {
    name: "adapstory-mcp-plugin-first-boundary",
    status: "incubating",
    intent:
      "MCP tools and plugin-first calls must resolve through Plugin Gateway and manifest-declared capabilities.",
    sourceOfTruth: [
      "plugin manifests",
      "MCP tool registry",
      "Plugin Gateway routes",
      "agent manifests",
    ],
    remediation: [
      "route MCP tools/list and tools/call through Plugin Gateway",
      "declare MCP capability in plugin manifest",
      "remove agent.tools and plugin_tools contracts",
      "replace hardcoded plugin slugs with requiredCapabilities, optionalCapabilities, and providerBindings",
    ],
  },
  {
    name: "adapstory-tenant-isolation-evidence",
    status: "incubating",
    intent:
      "Tenant-scoped APIs, plugins, data stores, events, and AI surfaces must carry tenant isolation evidence.",
    sourceOfTruth: [
      "OpenAPI tenant headers/claims",
      "database and graph schemas",
      "Kafka event contracts",
      "tenant isolation tests",
    ],
    remediation: [
      "add tenant_id, tenantId, X-Tenant-Id, or exact providerBindings evidence",
      "document row-level, schema, graph, event, or gateway isolation",
      "add cross-tenant isolation tests for ambiguous surfaces",
    ],
  },
  {
    name: "adapstory-ai-capability-governance",
    status: "incubating",
    intent:
      "AI, LLM, RAG, model, Dify, n8n, and agent capability surfaces must be manifest-governed and reviewable.",
    sourceOfTruth: [
      "AI/plugin manifests",
      "model configuration",
      "capability overlays",
      "guardrail and trust policies",
    ],
    remediation: [
      "declare AI capability provenance in manifest or reviewed overlay",
      "route external model/tool calls through approved capability boundary",
      "attach guardrail, tenant, and secret-management evidence",
    ],
  },
  {
    name: "adapstory-frontend-through-bff",
    status: "incubating",
    intent:
      "Frontend clients must reach backend capabilities through the BFF/web-api boundary.",
    sourceOfTruth: [
      "03-regulation/bff-development.md",
      "frontend routes",
      "BFF OpenAPI",
      "reviewed frontend integration overlays",
    ],
    remediation: [
      "replace direct /api/bc-* calls with /web-api/adapstory routes",
      "route backend access through the BFF or approved gateway",
      "document static/public asset exceptions with reviewed evidence",
    ],
  },
  {
    name: "adapstory-llm-gateway-boundary",
    status: "incubating",
    intent:
      "AI, LLM, and agent services must reach model providers through BC-10 LLM Gateway.",
    sourceOfTruth: [
      "03-regulation/ai-development-regulation.md",
      "model configuration manifests",
      "LLM Gateway routes",
      "reviewed capability-boundary overlays",
    ],
    remediation: [
      "move OpenAI/OpenRouter/Ollama provider calls behind BC-10 LLM Gateway",
      "declare model provider access in a manifest-backed capability",
      "remove direct SDK/client wiring from AI services and plugins",
    ],
  },
  {
    name: "adapstory-polyglot-data-boundary",
    status: "incubating",
    intent:
      "Python AI services must not access transactional PostgreSQL without own-schema/read-model/CDC evidence.",
    sourceOfTruth: [
      "03-regulation/architecture-base-principles.md",
      "03-regulation/integration-rules.md",
      "GitOps database values",
      "migration/schema ownership overlays",
    ],
    remediation: [
      "route Java/Python collaboration through REST, gRPC, Kafka, or CDC read models",
      "add explicit own-schema or schema-per-BC evidence for AI persistence",
      "remove shared Java BC database access from Python services",
    ],
  },
  {
    name: "adapstory-event-contract-evidence",
    status: "incubating",
    intent:
      "Kafka/event relations must show CloudEvents, tenant, initiator, and version contract evidence.",
    sourceOfTruth: [
      "03-regulation/integration-rules.md",
      "event schemas",
      "Kafka topic manifests",
      "consumer idempotency/DLT overlays",
    ],
    remediation: [
      "add CloudEvents 1.0 and eventversion evidence to the relation",
      "propagate tenant-id and request-initiator headers",
      "document topic/schema ownership and idempotent consumer behavior",
    ],
  },
  {
    name: "adapstory-runtime-observability-evidence",
    status: "incubating",
    intent:
      "Adapstory runtime services must expose metrics, tracing/correlation, and structured logs evidence.",
    sourceOfTruth: [
      "03-regulation/monitoring-observability-regulation.md",
      "ServiceMonitor manifests",
      "OpenTelemetry environment values",
      "logging/alerting overlays",
    ],
    remediation: [
      "add /metrics or ServiceMonitor evidence",
      "propagate trace_id/correlation_id through API/event edges",
      "declare structured JSON logs and dashboard/alert ownership",
    ],
  },
  {
    name: "adapstory-stateful-workload-evidence",
    status: "incubating",
    intent:
      "Adapstory stateful surfaces must show PVC/storageClass and backup/restore evidence.",
    sourceOfTruth: [
      "03-regulation/storage-data-management-regulation.md",
      "03-regulation/backup-disaster-recovery-regulation.md",
      "GitOps Helm values",
      "reviewed durability gap overlays",
    ],
    remediation: [
      "add explicit PVC/storageClass/storage-tier evidence",
      "attach backup, snapshot, restore, or retention evidence",
      "keep durable state on the home data plane unless explicitly reviewed",
    ],
  },
] as const satisfies readonly AdapstoryArchitectureRulePackRule[];

export const ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES =
  ADAPSTORY_ARCHITECTURE_INCUBATING_RULES.map((rule) => rule.name);
