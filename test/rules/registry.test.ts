import { checkAcl } from "../../src/rules/acl";
import { checkAcyclic } from "../../src/rules/acyclic";
import { checkApiGateway } from "../../src/rules/apiGateway";
import { checkCohesion } from "../../src/rules/cohesion";
import { checkCommonReuse } from "../../src/rules/commonReuse";
import { checkCrud } from "../../src/rules/crud";
import { checkDbPerService } from "../../src/rules/dbPerService";
import { fixAcl } from "../../src/rules/fixAcl";
import { fixCrud } from "../../src/rules/fixCrud";
import { fixDbPerService } from "../../src/rules/fixDbPerService";
import { ruleRegistry } from "../../src/rules/registry";
import { checkStableDependencies } from "../../src/rules/stableDependencies";

// The registry is the canonical mapping the CLI iterates over for `check`
// and `--fix`. A rename, a missing fix, or a wired-up wrong implementation
// here silently breaks config: a rule disabled in `aact.config.ts` under
// its old name keeps firing, or a fix never runs. Stryker showed 0% score
// on this file because nothing was asserting the shape.

const RULE_NAMES = [
  "acl",
  "acyclic",
  "apiGateway",
  "crud",
  "dbPerService",
  "cohesion",
  "stableDependencies",
  "commonReuse",
] as const;

const RULES_WITH_FIX = new Set(["acl", "crud", "dbPerService"]);

describe("ruleRegistry", () => {
  it("contains exactly the eight published rules", () => {
    const actual = ruleRegistry
      .map((r) => r.name)
      .toSorted((a, b) => a.localeCompare(b));
    const expected = [...RULE_NAMES].toSorted((a, b) => a.localeCompare(b));
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

  it("wires each entry to the correct underlying check", () => {
    // Verify by reference equality on the closure boundary: the registry
    // call should reach the imported `check*` function for the same name.
    // We can't compare functions directly (the registry wraps them in
    // arrow functions), so we assert that calling the registry entry on a
    // known-empty model produces the same result as calling the underlying
    // function directly.
    const model = { allContainers: [], boundaries: [] };
    const expected: Record<string, () => unknown> = {
      acl: () => checkAcl(model.allContainers),
      acyclic: () => checkAcyclic(model.allContainers),
      apiGateway: () => checkApiGateway(model.allContainers),
      crud: () => checkCrud(model.allContainers),
      dbPerService: () => checkDbPerService(model.allContainers),
      cohesion: () => checkCohesion(model),
      stableDependencies: () => checkStableDependencies(model.allContainers),
      commonReuse: () => checkCommonReuse(model),
    };
    for (const rule of ruleRegistry) {
      const baseline = expected[rule.name]();
      expect(rule.check(model)).toEqual(baseline);
    }
  });

  it("wires each fix entry to the correct underlying fixer", () => {
    const fixerByName: Record<string, unknown> = {
      acl: fixAcl,
      crud: fixCrud,
      dbPerService: fixDbPerService,
    };
    for (const rule of ruleRegistry) {
      if (!rule.fix) continue;
      expect(rule.fix).toBe(fixerByName[rule.name]);
    }
  });
});
