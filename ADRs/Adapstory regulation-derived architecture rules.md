# Adapstory regulation-derived architecture rules

## Status

Accepted

## Context

Adapstory uses AACT as an architecture test layer for bounded contexts,
plugins, AI services, platform integrations, and GitOps-derived evidence. The
discovery kit regulations in `03-regulation/` contain a mix of architectural
boundaries, delivery controls, runtime policies, and implementation checklists.

AACT can enforce the parts that are visible in an architecture model: which
components talk to which targets, which capability boundary they use, and
whether the model carries evidence tags or descriptions for required contracts.
Lower-level checks such as static code style, CI pipeline mechanics, Kubernetes
admission policies, and secret scanners remain in their owning gates.

## Decision

Add an incubating Adapstory rule set derived from the regulations. The rules use
the same `RuleDefinition` and typed `rules{}` option surface as built-ins and
custom rules, so projects can tune patterns without runtime adapters.

| Rule                                       | Regulation source                                                                 | Enforced architecture evidence                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `adapstory-frontend-through-bff`           | `bff-development.md`, `frontend-development-regulation.md`                        | Frontend clients call backend capabilities through BFF/web-api, not direct BC/internal routes.                  |
| `adapstory-llm-gateway-boundary`           | `ai-development-regulation.md`, `architecture-base-principles.md`                 | AI/LLM callers use BC-10 LLM Gateway/capability boundary for OpenAI, OpenRouter, Ollama, and similar providers. |
| `adapstory-polyglot-data-boundary`         | `architecture-base-principles.md`, `integration-rules.md`                         | Python AI services do not access PostgreSQL directly without own-schema, read-model, or CDC evidence.           |
| `adapstory-event-contract-evidence`        | `integration-rules.md`                                                            | Kafka/event relations carry CloudEvents, tenant, request-initiator, and eventversion evidence.                  |
| `adapstory-runtime-observability-evidence` | `monitoring-observability-regulation.md`                                          | Adapstory runtime services show metrics/ServiceMonitor, tracing/correlation, and structured log evidence.       |
| `adapstory-stateful-workload-evidence`     | `storage-data-management-regulation.md`, `backup-disaster-recovery-regulation.md` | Stateful data-plane surfaces show PVC/storageClass and backup/restore evidence.                                 |

The new rules stay incubating until they have passed enough generated-model
burn-in to become blocking. Existing burn-in rules continue to cover core BC
cycles, BFF downstream boundaries, external gateway/ACL use, schema-per-BC
ownership, and plugin manifest provenance.

## Consequences

Architecture reviews can now fail early when a model omits the evidence required
by Adapstory regulations. This pushes teams to model durable ownership and
integration contracts rather than relying on tribal knowledge.

The rules deliberately operate on names, tags, descriptions, relation
technology, and model properties. They will not prove that Helm, Java, Python,
or CI implementations are correct; they only ensure the architecture model
contains the required boundary/evidence. Implementation-specific enforcement
remains in GitOps, service tests, security scans, and CI gates.

Because these checks are pattern-based, teams may need reviewed overlays for
approved exceptions or for evidence that cannot be inferred from source code.
That is intentional: an exception should be explicit, searchable, and removable.
