import {
    ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES,
    ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES,
    ADAPSTORY_ARCHITECTURE_RULE_PACK_VERSION,
} from "../../src/rules";
import { ruleRegistry } from "../../src/rules/registry";

describe("Adapstory Architecture Rule Pack", () => {
    it("defines the v1 rule contract", () => {
        expect(ADAPSTORY_ARCHITECTURE_RULE_PACK_VERSION).toBe("v1");
        expect(ADAPSTORY_ARCHITECTURE_RULE_PACK_RULE_NAMES).toEqual([
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

        expect(ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES).toEqual([
            "adapstory-widget-lake-contract",
            "adapstory-smart-line-tenant-scope",
            "adapstory-mcp-plugin-first-boundary",
            "adapstory-tenant-isolation-evidence",
            "adapstory-ai-capability-governance",
        ]);
        expect(
            ADAPSTORY_ARCHITECTURE_INCUBATING_RULE_NAMES.every((ruleName) =>
                registered.has(ruleName),
            ),
        ).toBe(true);
    });
});
