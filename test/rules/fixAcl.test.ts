import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import {
  ArchitectureModel,
  Container,
  EXTERNAL_SYSTEM_TYPE,
} from "../../src/model";
import { checkAcl } from "../../src/rules";
import { applyEdits } from "../../src/rules/fix";
import { fixAcl } from "../../src/rules/fixAcl";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const extSystem: Container = {
  name: "ext_system",
  label: "External System",
  type: "System_Ext",
  description: "",
  relations: [],
};

const makeContainer = (
  name: string,
  label: string,
  relations: Container["relations"] = [],
): Container => ({
  name,
  label,
  type: "Container",
  description: "",
  relations,
});

const makeModel = (containers: Container[]): ArchitectureModel => ({
  boundaries: [{ name: "root", label: "Root", containers, boundaries: [] }],
  allContainers: containers,
});

describe("fixAcl", () => {
  it("returns empty for empty violations", () => {
    const model = makeModel([]);
    expect(fixAcl(model, [], plantumlSyntax)).toEqual([]);
  });

  it("generates FixResult with ACL container", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [
        {
          container: "my_service",
          message: "depends on external systems: ext_system",
        },
      ],
      plantumlSyntax,
    );
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("acl");
  });

  it("adds Container(acl) after Container(svc)", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("my_service_acl"),
    );
    expect(addEdit).toBeDefined();
    expect(addEdit!.search).toContain("(my_service,");
    expect(addEdit!.content).toContain('$tags="acl"');
  });

  it("adds single Rel(svc, acl) after the ACL container", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
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
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const replaceEdit = results[0].edits.find((e) => e.type === "replace");
    expect(replaceEdit).toBeDefined();
    expect(replaceEdit!.search).toContain("Rel(my_service, ext_system");
    expect(replaceEdit!.content).toContain("Rel(my_service_acl, ext_system");
  });

  it("uses custom tag from options", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
      { tag: "gateway" },
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain('$tags="gateway"');
  });

  it("generates one replace per external dependency, one add for Rel(svc,acl)", () => {
    const ext2: Container = {
      name: "ext_payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("my_service", "My Service", [
      { to: extSystem },
      { to: ext2 },
    ]);
    const model = makeModel([svc, extSystem, ext2]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const replaceEdits = results[0].edits.filter((e) => e.type === "replace");
    const addRelEdits = results[0].edits.filter(
      (e) => e.type === "add" && e.content?.includes("Rel("),
    );
    expect(replaceEdits).toHaveLength(2);
    expect(addRelEdits).toHaveLength(1); // single Rel(svc, acl), no duplicates
  });

  it("applies edits correctly to puml fragment", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const puml = [
      'Container(my_service, "My Service")',
      'System_Ext(ext_system, "External System")',
      'Rel(my_service, ext_system, "")',
    ].join("\n");

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("Container(my_service_acl,");
    expect(patched).toContain("Rel(my_service, my_service_acl");
    expect(patched).toContain("Rel(my_service_acl, ext_system");
    expect(patched).not.toContain("Rel(my_service, ext_system");
  });

  it("skips with warning when acl container already exists", () => {
    const aclContainer = makeContainer("my_service_acl", "My Service ACL");
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, aclContainer, extSystem]);
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    expect(results).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix acl");
    expect(msg).toContain("skipping my_service");
    expect(msg).toContain("my_service_acl");
    expect(msg).toContain("already exists");
  });

  it("silently skips a violation that names a non-existent container", () => {
    // Stryker mutated `if (!container) continue` to `false` (don't skip).
    // Pin: an unknown name yields no fix entry and no edits, no throw.
    const model = makeModel([extSystem]);
    expect(
      fixAcl(model, [{ container: "ghost", message: "" }], plantumlSyntax),
    ).toHaveLength(0);
  });

  it("returns no fix when container has no external relations", () => {
    // Pin: `if (externalRels.length === 0) continue;` — even if the rule
    // somehow emits a violation for a container without externals, the fix
    // must bail rather than synthesise edits referencing nothing.
    const db = makeContainer("orders_db", "Orders DB");
    db.type = "ContainerDb";
    const svc = makeContainer("my_service", "My Service", [{ to: db }]);
    const model = makeModel([svc, db]);
    expect(
      fixAcl(model, [{ container: "my_service", message: "" }], plantumlSyntax),
    ).toHaveLength(0);
  });

  it("emits exactly three edits for a single-external service (no extras)", () => {
    // Stryker mutated `edits: []` to `["Stryker was here"]`. A precise
    // length assertion guards the initial-array shape.
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits).toHaveLength(3); // add container, add Rel, replace Rel
  });

  it("description contains service name", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].description).toContain("my_service");
  });

  it("auto-detects camelCase and names ACL with Acl suffix", () => {
    const ext: Container = {
      name: "extPayments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("myService", "My Service", [{ to: ext }]);
    const model = makeModel([svc, ext]);

    const results = fixAcl(
      model,
      [{ container: "myService", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("myServiceAcl");
  });

  it("auto-detects kebab-case and names ACL with -acl suffix", () => {
    const ext: Container = {
      name: "ext-payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("my-service", "My Service", [{ to: ext }]);
    const model = makeModel([svc, ext]);

    const results = fixAcl(
      model,
      [{ container: "my-service", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("my-service-acl");
  });

  // Property-based invariants. Pin down guarantees that should hold for any
  // service name: never throw, produce at least one edit per fixable violation,
  // and stay deterministic across calls.
  test.prop([nameArb])("never throws, always returns FixResult[]", (name) => {
    const ext: Container = {
      name: "ext",
      label: "ext",
      type: EXTERNAL_SYSTEM_TYPE,
      description: "",
      relations: [],
    };
    const svc = makeContainer(name, name, [{ to: ext }]);
    const model = makeModel([svc, ext]);
    const violations = checkAcl(model.allContainers);
    const result = fixAcl(model, violations, plantumlSyntax);
    expect(Array.isArray(result)).toBe(true);
  });

  test.prop([nameArb])(
    "produces at least one edit per fixable violation",
    (name) => {
      const ext: Container = {
        name: "ext",
        label: "ext",
        type: EXTERNAL_SYSTEM_TYPE,
        description: "",
        relations: [],
      };
      const svc = makeContainer(name, name, [{ to: ext }]);
      const model = makeModel([svc, ext]);
      const violations = checkAcl(model.allContainers);
      const fixes = fixAcl(model, violations, plantumlSyntax);
      const totalEdits = fixes.flatMap((f) => f.edits).length;
      expect(totalEdits).toBeGreaterThan(0);
    },
  );

  test.prop([nameArb])("is deterministic for same input", (name) => {
    const ext: Container = {
      name: "ext",
      label: "ext",
      type: EXTERNAL_SYSTEM_TYPE,
      description: "",
      relations: [],
    };
    const svc = makeContainer(name, name, [{ to: ext }]);
    const model = makeModel([svc, ext]);
    const violations = checkAcl(model.allContainers);
    const first = fixAcl(model, violations, plantumlSyntax);
    const second = fixAcl(model, violations, plantumlSyntax);
    expect(first).toEqual(second);
  });

  it("ACL name follows {svc_name}_acl convention", () => {
    const svc = makeContainer("order_processor", "Order Processor", [
      { to: extSystem },
    ]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "order_processor", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("order_processor_acl");
  });
});
