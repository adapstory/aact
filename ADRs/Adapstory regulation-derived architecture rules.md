# Adapstory regulation-derived architecture rules

## Status

Accepted

## Context

Adapstory uses AACT as an architecture test layer for bounded contexts,
plugins, AI services, platform integrations, and GitOps-derived evidence.
Discovery-era regulation documents originally informed these rules, but they
are archived context rather than live implementation authority. Current
authority follows ADR-019: GitOps desired state, API and event contracts,
package and capability manifests, and reviewed architecture overlays.

AACT can enforce the parts that are visible in an architecture model: which
components talk to which targets, which capability boundary they use, and
whether the model carries evidence tags or descriptions for required contracts.
Lower-level checks such as static code style, CI pipeline mechanics, Kubernetes
admission policies, and secret scanners remain in their owning gates.

## Decision

Add an incubating Adapstory rule set derived from the regulations. The rules use
the same `RuleDefinition` and typed `rules{}` option surface as built-ins and
custom rules, so projects can tune patterns without runtime adapters.

| Rule                                       | Canonical live authority/evidence                                                                                                                                                               | Enforced architecture evidence                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `adapstory-frontend-through-bff`           | `docs/design-system/implementation.md#platform-alignment`, `specs/architecture-inventory/current-architecture.bff-boundary.c4.puml`                                                            | Frontend clients call backend capabilities through BFF/web-api, not direct BC/internal routes.                  |
| `adapstory-llm-gateway-boundary`           | `docs/adr/ADR-020-ai-course-modular-pipeline-boundaries.md`, `Adapstory-GitOps/infra/ci/jenkins/scripts/test_bc10_model_gateway_gitops_contract.py`                                           | AI/LLM callers use BC-10 LLM Gateway/capability boundary for OpenAI, OpenRouter, Ollama, and similar providers. |
| `adapstory-polyglot-data-boundary`         | `docs/adr/ADR-019-architecture-model-source-of-truth.md#authoritative-source-hierarchy`, `specs/architecture-inventory/postgres-schema-ownership-decisions.md`                                 | Python AI services do not access PostgreSQL directly without own-schema, read-model, or CDC evidence.           |
| `adapstory-event-contract-evidence`        | `docs/adr/ADR-015-integration-header-contract.md`                                                                                                                                               | Kafka/event relations carry CloudEvents, tenant, request-initiator, and eventversion evidence.                  |
| `adapstory-runtime-observability-evidence` | `docs/monitoring-observability-regulation.md`                                                                                                                                                   | Adapstory runtime services show metrics/ServiceMonitor, tracing/correlation, and structured log evidence.       |
| `adapstory-stateful-workload-evidence`     | `docs/storage-retention-policy.md`, `Adapstory-GitOps/infra/argocd/templates/applications/backup-system.yaml`                                                                                   | Stateful data-plane surfaces show PVC/storageClass and backup/restore evidence.                                 |

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

## Authority migration guard

- Context: discovery-era source paths were archived while AACT still exposed
  them as current provenance.
- Decision: rule metadata names only live authority or executable evidence
  identifiers from the ADR-019 hierarchy.
- Reason: every finding must be traceable to a maintained contract and the
  archive must remain context, never an implicit policy fallback.
- Revisit when: ADR-019 changes the authoritative source hierarchy or an owned
  contract moves; migrate the rule metadata and its regression test together.
