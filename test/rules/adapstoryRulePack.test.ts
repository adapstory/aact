import {
  ADAPSTORY_ARCHITECTURE_INCUBATING_RULES,
  ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES,
  ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES,
  ADAPSTORY_ARCHITECTURE_RULE_PACK_VERSION,
} from "../../src/rules";
import { ruleRegistry } from "../../src/rules/registry";

describe("Adapstory Architecture Rule Pack", () => {
  it("defines the v1 rule contract", () => {
    expect(ADAPSTORY_ARCHITECTURE_RULE_PACK_VERSION).toBe("v1");
    expect(ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES).toMatchObject([
      "adapstory-no-core-bc-cycles",
      "adapstory-bff-boundary",
      "adapstory-external-through-gateway-or-acl",
      "adapstory-schema-per-bc-not-db-per-service",
      "adapstory-plugin-capabilities-from-manifest",
    ]);
  });

  it("keeps every v1 rule registered in the AACT rule registry", () => {
    const registered = new Set(ruleRegistry.map((rule) => rule.name));

    expect(
      ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES.every((ruleName) =>
        registered.has(ruleName),
      ),
    ).toBe(true);
  });

  it("tracks incubating Adapstory rules outside the v1 burn-in pack", () => {
    const registered = new Set(ruleRegistry.map((rule) => rule.name));

    expect(ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES).toMatchObject([
      "adapstory-widget-lake-contract",
      "adapstory-smart-line-tenant-scope",
      "adapstory-mcp-plugin-first-boundary",
      "adapstory-tenant-isolation-evidence",
      "adapstory-ai-capability-governance",
      "adapstory-frontend-through-bff",
      "adapstory-llm-gateway-boundary",
      "adapstory-polyglot-data-boundary",
      "adapstory-event-contract-evidence",
      "adapstory-runtime-observability-evidence",
      "adapstory-stateful-workload-evidence",
    ]);
    expect(
      ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES.every((ruleName) =>
        registered.has(ruleName),
      ),
    ).toBe(true);
  });

  it("binds regulation-derived rules to canonical live authorities", () => {
    // Context: archived discovery-era regulation paths silently outlived their authority.
    // Decision: pin every derived rule to a live policy, contract, inventory, or executable test.
    // Reason: architecture findings must lead maintainers to reviewable current evidence.
    // Revisit when: ADR-019 changes the authoritative source hierarchy.
    const authorities = Object.fromEntries(
      ADAPSTORY_ARCHITECTURE_INCUBATING_RULES.map((rule) => [
        rule.name,
        rule.sourceOfTruth,
      ]),
    );

    expect(authorities).toMatchObject({
      "adapstory-frontend-through-bff": [
        "docs/design-system/implementation.md#platform-alignment",
        "specs/architecture-inventory/current-architecture.bff-boundary.c4.puml",
        "frontend routes",
        "BFF OpenAPI",
        "reviewed frontend integration overlays",
      ],
      "adapstory-llm-gateway-boundary": [
        "docs/adr/ADR-020-ai-course-modular-pipeline-boundaries.md",
        "Adapstory-GitOps/infra/ci/jenkins/scripts/test_bc10_model_gateway_gitops_contract.py",
        "model configuration manifests",
        "LLM Gateway routes",
        "reviewed capability-boundary overlays",
      ],
      "adapstory-polyglot-data-boundary": [
        "docs/adr/ADR-019-architecture-model-source-of-truth.md#authoritative-source-hierarchy",
        "specs/architecture-inventory/postgres-schema-ownership-decisions.md",
        "GitOps database values",
        "migration/schema ownership overlays",
      ],
      "adapstory-event-contract-evidence": [
        "docs/adr/ADR-015-integration-header-contract.md",
        "event schemas",
        "Kafka topic manifests",
        "consumer idempotency/DLT overlays",
      ],
      "adapstory-runtime-observability-evidence": [
        "docs/monitoring-observability-regulation.md",
        "ServiceMonitor manifests",
        "OpenTelemetry environment values",
        "logging/alerting overlays",
      ],
      "adapstory-stateful-workload-evidence": [
        "docs/storage-retention-policy.md",
        "Adapstory-GitOps/infra/argocd/templates/applications/backup-system.yaml",
        "GitOps Helm values",
        "reviewed durability gap overlays",
      ],
    });
    expect(
      Object.values(authorities).flat().some((authority) =>
        authority.startsWith("03-" + "regulation/"),
      ),
    ).toBe(false);
  });
});
