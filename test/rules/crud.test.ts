import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import { crudRule } from "../../src/rules";
import { applyEdits } from "../../src/rules/lib/applyEdits";
import type { BoundarySpec, ElementSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const dbSpec = (name = "orders_db", label = "Orders DB"): ElementSpec => ({
  name,
  label,
  kind: "ContainerDb",
});

const violation = (element: string) => ({ element, message: "" });

const buildModel = (elements: ElementSpec[], boundaries?: BoundarySpec[]) =>
  makeModel({ elements, boundaries });

const fixPuml = (
  containers: ElementSpec[],
  violationContainer: string,
  options?: { repoTags?: string[] },
  boundaries?: BoundarySpec[],
) => {
  const model = buildModel(containers, boundaries);
  return crudRule.fix!(
    model,
    [violation(violationContainer)],
    plantumlSyntax,
    options,
  );
};

describe("crudRule.check", () => {
  it("no violation when only repo accesses DB", () => {
    const model = buildModel([
      { name: "orders_repo", tags: ["repo"], relations: [{ to: "orders_db" }] },
      dbSpec(),
    ]);
    expect(crudRule.check(model)).toHaveLength(0);
  });

  it("violation when non-repo accesses DB", () => {
    const model = buildModel([
      { name: "orders", relations: [{ to: "orders_db" }] },
      dbSpec(),
    ]);
    const v = crudRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].element).toBe("orders");
    expect(v[0].message).toMatch(/repo/);
  });

  it("violation when repo has non-DB dependencies", () => {
    const model = buildModel([
      {
        name: "orders_repo",
        tags: ["repo"],
        relations: [{ to: "orders_db" }, { to: "other_service" }],
      },
      dbSpec(),
      { name: "other_service" },
    ]);
    const v = crudRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/non-database/);
  });

  it("respects repoTags option", () => {
    const model = buildModel([
      { name: "orders_dao", tags: ["dao"], relations: [{ to: "orders_db" }] },
      dbSpec(),
    ]);
    expect(crudRule.check(model, { repoTags: ["dao"] })).toHaveLength(0);
  });
});

describe("crudRule.fix — non-repo accesses DB", () => {
  it("returns empty for empty violations", () => {
    expect(crudRule.fix!(buildModel([]), [], plantumlSyntax)).toEqual([]);
  });

  it("redirects accessor through existing repo", () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_api",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].search).toContain("orders_api");
    expect(results[0].edits[0].search).toContain("orders_db");
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("creates new repo when none exists", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
    expect(results[0].edits[0].type).toBe("add");
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[1].type).toBe("add");
    expect(results[0].edits[1].content).toContain("orders_repo");
    expect(results[0].edits[1].content).toContain("orders_db");
    expect(results[0].edits[2].type).toBe("replace");
    expect(results[0].edits[2].content).toContain("orders_repo");
  });

  it("derives repo name by stripping _db suffix", () => {
    const results = fixPuml(
      [
        { name: "inventory_api", relations: [{ to: "inventory_db" }] },
        dbSpec("inventory_db"),
      ],
      "inventory_api",
    );
    expect(results[0].edits[0].content).toContain("inventory_repo");
  });

  it("strips _database suffix (snake)", () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_database" }] },
        dbSpec("orders_database"),
      ],
      "orders_api",
    );
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("strips Database suffix (camelCase)", () => {
    const results = fixPuml(
      [
        { name: "ordersApi", relations: [{ to: "ordersDatabase" }] },
        dbSpec("ordersDatabase"),
      ],
      "ordersApi",
    );
    expect(results[0].edits[0].content).toContain("ordersRepo");
  });

  it("auto-detects camelCase and uses Repo suffix", () => {
    const results = fixPuml(
      [
        { name: "ordersApi", relations: [{ to: "ordersDb" }] },
        dbSpec("ordersDb"),
      ],
      "ordersApi",
    );
    expect(results[0].edits[0].content).toContain("ordersRepo");
  });

  it("auto-detects kebab-case and uses -repo suffix", () => {
    const results = fixPuml(
      [
        { name: "orders-api", relations: [{ to: "orders-db" }] },
        dbSpec("orders-db"),
      ],
      "orders-api",
    );
    expect(results[0].edits[0].content).toContain("orders-repo");
  });

  it("derives human-readable label for new repo", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    expect(results[0].edits[0].content).toContain("Orders Repo");
  });

  it("skips and warns when derived repo name already exists", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        dbSpec(),
        { name: "orders_repo" },
      ],
      "orders_api",
    );
    expect(results).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud");
    expect(msg).toContain("cannot create repo for");
    expect(msg).toContain("orders_db");
    expect(msg).toContain("orders_repo");
    expect(msg).toContain("already exists");
  });

  it('tags every FixResult with rule="crud" and a human-readable description', () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    expect(results[0].rule).toBe("crud");
    expect(results[0].description).toContain("orders_api");
    expect(results[0].description).toContain("orders_db");
    expect(results[0].description).toMatch(/repo/i);
  });

  it("ignores non-db outbound relations when computing dbRels", () => {
    const results = fixPuml(
      [
        {
          name: "orders_api",
          relations: [{ to: "orders_db" }, { to: "notifications" }],
        },
        dbSpec(),
        { name: "notifications" },
      ],
      "orders_api",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
    for (const edit of results[0].edits) {
      const text = `${edit.search} ${edit.content ?? ""}`;
      expect(text).not.toContain("notifications");
    }
  });

  it("does not consider accessor itself when scanning for an existing repo", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    expect(results[0].edits).toHaveLength(3);
    expect(results[0].edits[0].type).toBe("add");
    expect(results[0].edits[2].type).toBe("replace");
    expect(results[0].edits[2].content).not.toContain(
      "Rel(orders_api, orders_api",
    );
  });

  it("accepts existing repo with mixed relations as long as ONE reaches the db", () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }, { to: "orders_cache" }],
        },
        dbSpec(),
        { name: "orders_cache" },
      ],
      "orders_api",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("requires the candidate repo to actually reach the same db", () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        {
          name: "other_repo",
          tags: ["repo"],
          relations: [{ to: "other_db" }],
        },
        dbSpec(),
        dbSpec("other_db", "Other DB"),
      ],
      "orders_api",
    );
    expect(results[0].edits).toHaveLength(3);
    for (const edit of results[0].edits) {
      const text = `${edit.search} ${edit.content ?? ""}`;
      expect(text).not.toContain("other_repo");
    }
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("treats an untagged candidate as not-a-repo", () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        { name: "orders_helper", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_api",
    );
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[0].content).not.toContain("orders_helper");
  });

  it("emits the cross-boundary no-repo warning with rule, accessor and db names", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    fixPuml(
      [{ name: "fulfillment_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "fulfillment_api",
      undefined,
      [
        { name: "orders", elementNames: ["orders_db"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    );
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud");
    expect(msg).toContain("fulfillment_api");
    expect(msg).toContain("orders_db");
    expect(msg).toContain("cross-boundary");
    expect(msg).toContain("no existing repo");
    expect(msg).toContain("fix manually");
  });

  it('falls back to "repo" when ownerTags is an empty array', () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
      { repoTags: [] },
    );
    expect(results[0].edits[0].content).toContain('$tags="repo"');
  });

  it('uses the default repoTags=["repo","relay"] when no options passed', () => {
    const results = fixPuml(
      [
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        {
          name: "orders_relay",
          tags: ["relay"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_api",
    );
    expect(results[0].edits[0].content).toContain("orders_relay");
  });

  it("propagates custom repoTags as the tag of the created repo", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
      { repoTags: ["relay"] },
    );
    expect(results[0].edits[0].content).toContain('$tags="relay"');
    expect(results[0].edits[0].content).not.toContain('$tags="repo"');
  });

  it('tags repo-with-non-db-deps fixes with rule="crud"', () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }, { to: "audit_svc" }],
        },
        dbSpec(),
        { name: "audit_svc" },
      ],
      "orders_repo",
    );
    expect(results[0].rule).toBe("crud");
    expect(results[0].description).toBe(
      "Remove non-database dependencies from repo orders_repo",
    );
  });

  it("silently skips a violation that names a non-existent container", () => {
    const model = buildModel([dbSpec()]);
    expect(
      crudRule.fix!(model, [violation("ghost")], plantumlSyntax),
    ).toHaveLength(0);
  });

  it("description pins exact `Add repo intermediary for X -> Y` format", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    expect(results[0].description).toBe(
      "Add repo intermediary for orders_api → orders_db",
    );
  });

  it("derives the new-repo label by capitalising and replacing underscores", () => {
    const results = fixPuml(
      [
        {
          name: "payment_processor_api",
          relations: [{ to: "payment_processor_db" }],
        },
        dbSpec("payment_processor_db"),
      ],
      "payment_processor_api",
    );
    expect(results[0].edits[0].content).toContain('"Payment processor Repo"');
  });

  it("handles multiple DB relations from same accessor", () => {
    const results = fixPuml(
      [
        {
          name: "orders_api",
          relations: [{ to: "orders_db" }, { to: "users_db" }],
        },
        dbSpec(),
        dbSpec("users_db", "Users DB"),
      ],
      "orders_api",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(6);
  });

  it("applies edits correctly to plantuml source", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
    );
    const puml = [
      'Container(orders_api, "Orders API")',
      'ContainerDb(orders_db, "Orders DB")',
      'Rel(orders_api, orders_db, "SQL")',
    ].join("\n");
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("orders_repo");
    expect(patched).toContain("Rel(orders_repo, orders_db");
    expect(patched).toContain("Rel(orders_api, orders_repo");
    expect(patched).not.toContain("Rel(orders_api, orders_db");
  });

  it("applies edits correctly to structurizr DSL source", () => {
    const model = buildModel([
      { name: "orders_api", relations: [{ to: "orders_db" }] },
      dbSpec(),
    ]);
    const results = crudRule.fix!(
      model,
      [violation("orders_api")],
      structurizrDslSyntax,
    );
    const dsl = [
      'orders_api = container "Orders API"',
      'orders_db = container "Orders DB"',
      'orders_api -> orders_db "SQL"',
    ].join("\n");
    const patched = applyEdits(dsl, results[0].edits);
    expect(patched).toContain("orders_repo = container");
    expect(patched).toContain("orders_repo -> orders_db");
    expect(patched).toContain("orders_api -> orders_repo");
    expect(patched).not.toContain("orders_api -> orders_db");
  });
});

describe("crudRule.fix invariants", () => {
  test.prop([nameArb])(
    "round-trip: applying edits to a synthetic source and re-checking yields fewer crud violations",
    (svcName) => {
      const model = buildModel([
        { name: svcName, relations: [{ to: "db" }] },
        dbSpec("db", "db"),
      ]);
      const before = crudRule.check(model);
      if (before.length === 0) return;

      const source = [
        "@startuml",
        `Container(${svcName}, "${svcName}")`,
        `ContainerDb(db, "db")`,
        `Rel(${svcName}, db, "")`,
        "@enduml",
      ].join("\n");

      const fixes = crudRule.fix!(model, before, plantumlSyntax);
      expect(fixes.length).toBeGreaterThan(0);

      const newSource = fixes.reduce(
        (s, fix) => applyEdits(s, fix.edits),
        source,
      );
      expect(newSource).not.toBe(source);
      expect(newSource).toContain("repo");
    },
  );

  test.prop([nameArb])(
    "edits reference real containers or generated `_repo` names — never invented identifiers",
    (svcName) => {
      const model = buildModel([
        { name: svcName, relations: [{ to: "db" }] },
        dbSpec("db", "db"),
      ]);
      const violations = crudRule.check(model);
      const fixes = crudRule.fix!(model, violations, plantumlSyntax);
      for (const fix of fixes) {
        for (const edit of fix.edits) {
          expect(typeof edit.search).toBe("string");
          expect(edit.search.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe("crudRule.fix — cross-boundary", () => {
  const crossBoundary: BoundarySpec[] = [
    {
      name: "orders",
      elementNames: ["orders_public_api", "orders_repo", "orders_db"],
    },
    { name: "fulfillment", elementNames: ["fulfillment_api"] },
  ];
  const crossBoundaryContainers: ElementSpec[] = [
    { name: "orders_public_api" },
    { name: "orders_repo", tags: ["repo"], relations: [{ to: "orders_db" }] },
    dbSpec(),
    { name: "fulfillment_api", relations: [{ to: "orders_db" }] },
  ];

  it("redirects cross-boundary accessor through public API of target boundary", () => {
    const results = fixPuml(
      crossBoundaryContainers,
      "fulfillment_api",
      undefined,
      crossBoundary,
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].content).toContain("orders_public_api");
    expect(results[0].edits[0].content).not.toContain("orders_repo");
  });

  it("creates repo when accessor has no boundary", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
      undefined,
      [{ name: "orders", elementNames: ["orders_db"] }],
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
  });

  it("creates repo when db has no boundary", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
      undefined,
      [{ name: "orders", elementNames: ["orders_api"] }],
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
  });

  it("does NOT treat same-boundary access as cross-boundary", () => {
    const results = fixPuml(
      [{ name: "orders_api", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_api",
      undefined,
      [{ name: "orders", elementNames: ["orders_api", "orders_db"] }],
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
  });

  it("warns and skips when cross-boundary has no public API", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
        { name: "fulfillment_api", relations: [{ to: "orders_db" }] },
      ],
      "fulfillment_api",
      undefined,
      [
        { name: "orders", elementNames: ["orders_repo", "orders_db"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    );
    expect(results).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud:");
  });

  it("warns and skips when no repo exists cross-boundary", () => {
    const results = fixPuml(
      [dbSpec(), { name: "fulfillment_api", relations: [{ to: "orders_db" }] }],
      "fulfillment_api",
      undefined,
      [
        { name: "orders", elementNames: ["orders_db"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    );
    expect(results).toHaveLength(0);
  });
});

describe("crudRule.fix — repo has non-database dependencies", () => {
  it("removes non-db relation from repo", () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }, { to: "external_svc" }],
        },
        dbSpec(),
        { name: "external_svc" },
      ],
      "orders_repo",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("remove");
    expect(results[0].edits[0].search).toContain("orders_repo");
    expect(results[0].edits[0].search).toContain("external_svc");
  });

  it("removes multiple non-db relations", () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }, { to: "svc1" }, { to: "svc2" }],
        },
        dbSpec(),
        { name: "svc1" },
        { name: "svc2" },
      ],
      "orders_repo",
    );
    expect(results[0].edits).toHaveLength(2);
  });

  it("does not remove db relations", () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_repo",
    );
    expect(results).toHaveLength(0);
  });
});
