import { aclRule } from "../../src/rules/acl";
import { acyclicRule } from "../../src/rules/acyclic";
import { adapstoryBffBoundaryRule } from "../../src/rules/adapstoryBffBoundary";
import { adapstoryEventContractEvidenceRule } from "../../src/rules/adapstoryEventContractEvidence";
import { adapstoryExternalThroughGatewayOrAclRule } from "../../src/rules/adapstoryExternalThroughGatewayOrAcl";
import { adapstoryFrontendThroughBffRule } from "../../src/rules/adapstoryFrontendThroughBff";
import {
  adapstoryAiCapabilityGovernanceRule,
  adapstoryMcpPluginFirstBoundaryRule,
  adapstorySmartLineTenantScopeRule,
  adapstoryTenantIsolationEvidenceRule,
  adapstoryWidgetLakeContractRule,
} from "../../src/rules/adapstoryIncubatingRules";
import { adapstoryLlmGatewayBoundaryRule } from "../../src/rules/adapstoryLlmGatewayBoundary";
import { adapstoryNoCoreBcCyclesRule } from "../../src/rules/adapstoryNoCoreBcCycles";
import { adapstoryPluginCapabilitiesFromManifestRule } from "../../src/rules/adapstoryPluginCapabilitiesFromManifest";
import { adapstoryPolyglotDataBoundaryRule } from "../../src/rules/adapstoryPolyglotDataBoundary";
import { adapstoryRuntimeObservabilityEvidenceRule } from "../../src/rules/adapstoryRuntimeObservabilityEvidence";
import { adapstorySchemaPerBcNotDbPerServiceRule } from "../../src/rules/adapstorySchemaPerBcNotDbPerService";
import { adapstoryStatefulWorkloadEvidenceRule } from "../../src/rules/adapstoryStatefulWorkloadEvidence";
import { apiGatewayRule } from "../../src/rules/apiGateway";
import { cohesionRule } from "../../src/rules/cohesion";
import { commonReuseRule } from "../../src/rules/commonReuse";
import { crudRule } from "../../src/rules/crud";
import { dbPerServiceRule } from "../../src/rules/dbPerService";
import { ruleRegistry } from "../../src/rules/registry";
import { stableDependenciesRule } from "../../src/rules/stableDependencies";
import { makeModel } from "../helpers/makeModel";

// Registry is the canonical mapping the CLI iterates over for `check` и
// `--fix`. Rename / missing fix / wrong wiring silently breaks user config.

const RULES_WITH_FIX = new Set(["acl", "crud", "dbPerService"]);

const EXPECTED_BY_NAME = {
  acl: aclRule,
  acyclic: acyclicRule,
  apiGateway: apiGatewayRule,
  crud: crudRule,
  dbPerService: dbPerServiceRule,
  cohesion: cohesionRule,
  stableDependencies: stableDependenciesRule,
  commonReuse: commonReuseRule,
  "adapstory-bff-boundary": adapstoryBffBoundaryRule,
  "adapstory-external-through-gateway-or-acl":
    adapstoryExternalThroughGatewayOrAclRule,
  "adapstory-no-core-bc-cycles": adapstoryNoCoreBcCyclesRule,
  "adapstory-plugin-capabilities-from-manifest":
    adapstoryPluginCapabilitiesFromManifestRule,
  "adapstory-schema-per-bc-not-db-per-service":
    adapstorySchemaPerBcNotDbPerServiceRule,
  "adapstory-widget-lake-contract": adapstoryWidgetLakeContractRule,
  "adapstory-smart-line-tenant-scope": adapstorySmartLineTenantScopeRule,
  "adapstory-mcp-plugin-first-boundary": adapstoryMcpPluginFirstBoundaryRule,
  "adapstory-tenant-isolation-evidence": adapstoryTenantIsolationEvidenceRule,
  "adapstory-ai-capability-governance": adapstoryAiCapabilityGovernanceRule,
  "adapstory-frontend-through-bff": adapstoryFrontendThroughBffRule,
  "adapstory-llm-gateway-boundary": adapstoryLlmGatewayBoundaryRule,
  "adapstory-polyglot-data-boundary": adapstoryPolyglotDataBoundaryRule,
  "adapstory-event-contract-evidence": adapstoryEventContractEvidenceRule,
  "adapstory-runtime-observability-evidence":
    adapstoryRuntimeObservabilityEvidenceRule,
  "adapstory-stateful-workload-evidence": adapstoryStatefulWorkloadEvidenceRule,
} as const;

describe("ruleRegistry", () => {
  it("contains exactly the published built-in rules", () => {
    const actual = ruleRegistry.map((r) => r.name).toSorted();
    const expected = Object.keys(EXPECTED_BY_NAME).toSorted();
    expect(actual).toEqual(expected);
  });

  it("has unique names", () => {
    const names = ruleRegistry.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes a `fix` only for rules that ship an auto-fix", () => {
    for (const rule of ruleRegistry) {
      const expectFix = RULES_WITH_FIX.has(rule.name);
      expect(typeof rule.fix === "function").toBe(expectFix);
    }
  });

  it("wires each entry to its underlying RuleDefinition by reference", () => {
    for (const rule of ruleRegistry) {
      expect(rule).toBe(
        EXPECTED_BY_NAME[rule.name as keyof typeof EXPECTED_BY_NAME],
      );
    }
  });

  it("every rule's check returns an array on an empty model", () => {
    // Smoke check: each registry entry can be invoked against a valid Model
    // shape without throwing. Per-rule semantics are covered in rule tests.
    const empty = makeModel({});
    for (const rule of ruleRegistry) {
      expect(rule.check(empty, {})).toEqual([]);
    }
  });
});
