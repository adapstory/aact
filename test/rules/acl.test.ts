import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import { aclRule } from "../../src/rules";
import { applyEdits } from "../../src/rules/lib/applyEdits";
import type { ElementSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const extSystem: ElementSpec = {
  name: "ext_system",
  label: "External System",
  kind: "System",
  external: true,
};

describe("aclRule.check", () => {
  it("returns no violations when acl-tagged container depends on external", () => {
    const model = makeModel({
      elements: [
        { name: "my_acl", tags: ["acl"], relations: [{ to: "ext_system" }] },
        extSystem,
      ],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("returns violation when non-acl container depends on external", () => {
    const model = makeModel({
      elements: [
        { name: "my_service", relations: [{ to: "ext_system" }] },
        extSystem,
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].element).toBe("my_service");
    expect(v[0].message).toContain("ext_system");
  });

  it("returns no violations when no external dependencies", () => {
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("includes all external systems in violation message", () => {
    const model = makeModel({
      elements: [
        { name: "svc", relations: [{ to: "ext1" }, { to: "ext2" }] },
        { name: "ext1", kind: "System", external: true },
        { name: "ext2", kind: "System", external: true },
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("ext1");
    expect(v[0].message).toContain("ext2");
    expect(v[0].message).toMatch(/systems/);
  });

  it("respects custom tag option", () => {
    const model = makeModel({
      elements: [
        {
          name: "anti_corruption",
          tags: ["custom-acl"],
          relations: [{ to: "ext" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(aclRule.check(model, { tag: "custom-acl" })).toHaveLength(0);
  });

  test.prop([nameArb])(
    "property: container with 'acl' tag never fires violation",
    () => {
      const model = makeModel({
        elements: [
          { name: "svc", tags: ["acl"], relations: [{ to: "e" }] },
          { name: "e", kind: "System", external: true },
        ],
      });
      expect(aclRule.check(model)).toHaveLength(0);
    },
  );
});

const fixWithPlantuml = (
  containers: ElementSpec[],
  violationContainer: string,
  options?: { tag?: string },
) => {
  const model = makeModel({ elements: containers });
  return aclRule.fix!(
    model,
    [{ element: violationContainer, message: "" }],
    plantumlSyntax,
    options,
  );
};

describe("aclRule.fix (plantuml syntax)", () => {
  it("returns empty for empty violations", () => {
    const model = makeModel({ elements: [extSystem] });
    expect(aclRule.fix!(model, [], plantumlSyntax)).toEqual([]);
  });

  it("generates FixResult with ACL container", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("acl");
  });

  it("adds Container(acl) after Container(svc)", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("my_service_acl"),
    );
    expect(addEdit).toBeDefined();
    expect(addEdit!.search).toContain("(my_service,");
    expect(addEdit!.content).toContain('$tags="acl"');
  });

  it("adds single Rel(svc, acl) after the ACL container", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    const addRelEdit = results[0].edits.find(
      (e) =>
        e.type === "add" &&
        e.content?.includes("Rel(my_service, my_service_acl"),
    );
    expect(addRelEdit).toBeDefined();
    expect(addRelEdit!.search).toContain("(my_service_acl,");
  });

  it("replaces Rel(svc, ext) with Rel(acl, ext)", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    const replaceEdit = results[0].edits.find((e) => e.type === "replace");
    expect(replaceEdit).toBeDefined();
    expect(replaceEdit!.search).toContain("Rel(my_service, ext_system");
    expect(replaceEdit!.content).toContain("Rel(my_service_acl, ext_system");
  });

  it("uses custom tag from options", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
      { tag: "gateway" },
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain('$tags="gateway"');
  });

  it("generates one replace per external dependency, one add for Rel(svc,acl)", () => {
    const results = fixWithPlantuml(
      [
        {
          name: "my_service",
          relations: [{ to: "ext_system" }, { to: "ext_payments" }],
        },
        extSystem,
        { name: "ext_payments", kind: "System", external: true },
      ],
      "my_service",
    );
    const replaceEdits = results[0].edits.filter((e) => e.type === "replace");
    const addRelEdits = results[0].edits.filter(
      (e) => e.type === "add" && e.content?.includes("Rel("),
    );
    expect(replaceEdits).toHaveLength(2);
    expect(addRelEdits).toHaveLength(1); // single Rel(svc, acl), no duplicates
  });

  it("applies edits correctly to puml fragment", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    const puml = [
      'Container(my_service, "My Service")',
      'System_Ext(ext_system, "External System")',
      'Rel(my_service, ext_system, "")',
    ].join("\n");
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("Container(my_service_acl,");
    expect(patched).toContain("Rel(my_service, my_service_acl");
    expect(patched).toContain("Rel(my_service_acl, ext_system");
    expect(patched).not.toContain("Rel(my_service, ext_system");
  });

  it("skips with warning when acl container already exists", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    const results = fixWithPlantuml(
      [
        { name: "my_service", relations: [{ to: "ext_system" }] },
        { name: "my_service_acl" },
        extSystem,
      ],
      "my_service",
    );
    expect(results).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix acl");
    expect(msg).toContain("skipping my_service");
    expect(msg).toContain("my_service_acl");
    expect(msg).toContain("already exists");
  });

  it("picks the container by exact name when several exist (covers === predicate)", () => {
    // Stryker mutated `c.name === violation.element` to `true`. With true,
    // the first container in allElements would be picked regardless of
    // the violation name — leading to ACLs around the wrong service.
    const results = fixWithPlantuml(
      [
        { name: "alpha", relations: [{ to: "ext_system" }] },
        { name: "beta", relations: [{ to: "ext_system" }] },
        extSystem,
      ],
      "beta",
    );
    expect(results).toHaveLength(1);
    expect(results[0].description).toContain("beta");
    expect(results[0].description).not.toContain("alpha");
    const containerEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(containerEdit!.content).toContain("beta_acl");
    expect(containerEdit!.content).not.toContain("alpha_acl");
  });

  it("silently skips a violation that names a non-existent container", () => {
    // Stryker mutated `if (!container) continue` to `false` (don't skip).
    // Pin: an unknown name yields no fix entry, no edits, no throw.
    const model = makeModel({ elements: [extSystem] });
    expect(
      aclRule.fix!(model, [{ element: "ghost", message: "" }], plantumlSyntax),
    ).toHaveLength(0);
  });

  it("returns no fix when container has no external relations", () => {
    // Pin: `if (externalRels.length === 0) continue;` — even if the rule
    // somehow emits a violation for a container without externals, the fix
    // must bail rather than synthesise edits referencing nothing.
    const results = fixWithPlantuml(
      [
        { name: "my_service", relations: [{ to: "orders_db" }] },
        { name: "orders_db", kind: "ContainerDb" },
      ],
      "my_service",
    );
    expect(results).toHaveLength(0);
  });

  it("emits exactly three edits for a single-external service (no extras)", () => {
    // Stryker mutated `edits: []` to `["Stryker was here"]`. A precise
    // length assertion guards the initial-array shape.
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    expect(results[0].edits).toHaveLength(3);
  });

  it("description contains service name", () => {
    const results = fixWithPlantuml(
      [{ name: "my_service", relations: [{ to: "ext_system" }] }, extSystem],
      "my_service",
    );
    expect(results[0].description).toContain("my_service");
  });

  it("auto-detects camelCase and names ACL with Acl suffix", () => {
    const results = fixWithPlantuml(
      [
        { name: "myService", relations: [{ to: "extPayments" }] },
        { name: "extPayments", kind: "System", external: true },
      ],
      "myService",
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("myServiceAcl");
  });

  it("auto-detects kebab-case and names ACL with -acl suffix", () => {
    const results = fixWithPlantuml(
      [
        { name: "my-service", relations: [{ to: "ext-payments" }] },
        { name: "ext-payments", kind: "System", external: true },
      ],
      "my-service",
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("my-service-acl");
  });

  test.prop([nameArb])("never throws, always returns FixResult[]", (name) => {
    const model = makeModel({
      elements: [
        { name, relations: [{ to: "ext" }] },
        { name: "ext", kind: "System", external: true },
      ],
    });
    const violations = aclRule.check(model);
    const result = aclRule.fix!(model, violations, plantumlSyntax);
    expect(Array.isArray(result)).toBe(true);
  });

  test.prop([nameArb])(
    "produces at least one edit per fixable violation",
    (name) => {
      const model = makeModel({
        elements: [
          { name, relations: [{ to: "ext" }] },
          { name: "ext", kind: "System", external: true },
        ],
      });
      const violations = aclRule.check(model);
      const fixes = aclRule.fix!(model, violations, plantumlSyntax);
      const totalEdits = fixes.flatMap((f) => f.edits).length;
      expect(totalEdits).toBeGreaterThan(0);
    },
  );

  test.prop([nameArb])("is deterministic for same input", (name) => {
    const model = makeModel({
      elements: [
        { name, relations: [{ to: "ext" }] },
        { name: "ext", kind: "System", external: true },
      ],
    });
    const violations = aclRule.check(model);
    const first = aclRule.fix!(model, violations, plantumlSyntax);
    const second = aclRule.fix!(model, violations, plantumlSyntax);
    expect(first).toEqual(second);
  });

  it("ACL name follows {svc_name}_acl convention", () => {
    const results = fixWithPlantuml(
      [
        { name: "order_processor", relations: [{ to: "ext_system" }] },
        extSystem,
      ],
      "order_processor",
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("order_processor_acl");
  });
});

describe("aclRule.fix (structurizr syntax)", () => {
  it("adds container declaration with tags block", () => {
    const model = makeModel({
      elements: [
        {
          name: "my_service",
          label: "My Service",
          relations: [{ to: "ext_system" }],
        },
        extSystem,
      ],
    });
    const results = aclRule.fix!(
      model,
      [{ element: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("my_service_acl"),
    );
    expect(addEdit!.content).toContain(
      'my_service_acl = container "My Service ACL"',
    );
    expect(addEdit!.content).toContain('tags "acl"');
  });

  it("replaces Rel(svc, ext) with Rel(acl, ext)", () => {
    const model = makeModel({
      elements: [
        { name: "my_service", relations: [{ to: "ext_system" }] },
        extSystem,
      ],
    });
    const results = aclRule.fix!(
      model,
      [{ element: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const replaceEdit = results[0].edits.find((e) => e.type === "replace");
    expect(replaceEdit!.search).toBe("my_service -> ext_system");
    expect(replaceEdit!.content).toContain("my_service_acl -> ext_system");
  });

  it("applies edits correctly to dsl fragment", () => {
    const model = makeModel({
      elements: [
        {
          name: "my_service",
          relations: [
            {
              to: "ext_system",
              technology: "https://gateway.int.com:443/v1",
            },
          ],
        },
        extSystem,
      ],
    });
    const dsl = [
      'my_service = container "My Service"',
      'ext_system = softwareSystem "External System"',
      'my_service -> ext_system "https://gateway.int.com:443/v1"',
    ].join("\n");
    const results = aclRule.fix!(
      model,
      [{ element: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const patched = applyEdits(dsl, results[0].edits);
    expect(patched).toContain("my_service_acl = container");
    expect(patched).toContain("my_service -> my_service_acl");
    expect(patched).toContain("my_service_acl -> ext_system");
    expect(patched).not.toContain("my_service -> ext_system");
  });
});
