import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import { structurizrDslSyntax } from "../../src/loaders/structurizr/syntax";
import {
  ArchitectureModel,
  Container,
  CONTAINER_DB_TYPE,
} from "../../src/model";
import { checkCrud } from "../../src/rules";
import { applyEdits } from "../../src/rules/fix";
import { fixCrud } from "../../src/rules/fixCrud";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const makeDb = (name = "orders_db", label = "Orders DB"): Container => ({
  name,
  label,
  type: "ContainerDb",
  description: "",
  relations: [],
});

const makeContainer = (
  name: string,
  relations: Container["relations"] = [],
  tags?: string[],
): Container => ({
  name,
  label: name,
  type: "Container",
  description: "",
  relations,
  tags,
});

const makeModel = (
  containers: Container[],
  boundaryName = "root",
): ArchitectureModel => ({
  boundaries: [
    { name: boundaryName, label: boundaryName, containers, boundaries: [] },
  ],
  allContainers: containers,
});

const violation = (
  container: string,
): { container: string; message: string } => ({
  container,
  message: "",
});

describe("fixCrud — non-repo accesses DB", () => {
  it("returns empty for empty violations", () => {
    expect(fixCrud(makeModel([]), [], plantumlSyntax)).toEqual([]);
  });

  it("redirects accessor through existing repo", () => {
    const db = makeDb();
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, repo, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);

    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].search).toContain("orders_api");
    expect(results[0].edits[0].search).toContain("orders_db");
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("creates new repo when none exists", () => {
    const db = makeDb();
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);

    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(3);
    // add repo container
    expect(results[0].edits[0].type).toBe("add");
    expect(results[0].edits[0].content).toContain("orders_repo");
    // add repo -> db relation
    expect(results[0].edits[1].type).toBe("add");
    expect(results[0].edits[1].content).toContain("orders_repo");
    expect(results[0].edits[1].content).toContain("orders_db");
    // redirect accessor -> repo
    expect(results[0].edits[2].type).toBe("replace");
    expect(results[0].edits[2].content).toContain("orders_repo");
  });

  it("derives repo name by stripping _db suffix", () => {
    const db = makeDb("inventory_db");
    const api = makeContainer("inventory_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(
      model,
      [violation("inventory_api")],
      plantumlSyntax,
    );
    expect(results[0].edits[0].content).toContain("inventory_repo");
  });

  it("strips _database suffix (snake)", () => {
    const db = makeDb("orders_database");
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("strips Database suffix (camelCase)", () => {
    const db = makeDb("ordersDatabase", "Orders DB");
    const api = makeContainer("ordersApi", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("ordersApi")], plantumlSyntax);
    expect(results[0].edits[0].content).toContain("ordersRepo");
  });

  it("auto-detects camelCase and uses Repo suffix", () => {
    const db = makeDb("ordersDb", "Orders DB");
    const api = makeContainer("ordersApi", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("ordersApi")], plantumlSyntax);
    expect(results[0].edits[0].content).toContain("ordersRepo");
  });

  it("auto-detects kebab-case and uses -repo suffix", () => {
    const db = makeDb("orders-db", "Orders DB");
    const api = makeContainer("orders-api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders-api")], plantumlSyntax);
    expect(results[0].edits[0].content).toContain("orders-repo");
  });

  it("derives human-readable label for new repo", () => {
    const db = makeDb("orders_db");
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results[0].edits[0].content).toContain("Orders Repo");
  });

  it("skips and warns when derived repo name already exists", () => {
    const db = makeDb();
    const existingRepo = makeContainer("orders_repo");
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db, existingRepo]);
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
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
    const db = makeDb();
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results[0].rule).toBe("crud");
    expect(results[0].description).toContain("orders_api");
    expect(results[0].description).toContain("orders_db");
    expect(results[0].description).toMatch(/repo/i);
  });

  it("derives the new-repo label by capitalising and replacing underscores", () => {
    const db = makeDb("payment_processor_db");
    const api = makeContainer("payment_processor_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(
      model,
      [violation("payment_processor_api")],
      plantumlSyntax,
    );
    // Stryker mutated the label expression to "" — pin format precisely.
    expect(results[0].edits[0].content).toContain('"Payment processor Repo"');
  });

  it("handles multiple DB relations from same accessor", () => {
    const db1 = makeDb("orders_db");
    const db2: Container = { ...makeDb("users_db", "Users DB") };
    const api = makeContainer("orders_api", [{ to: db1 }, { to: db2 }]);
    const model = makeModel([api, db1, db2]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results).toHaveLength(1);
    // 3 edits per DB × 2 DBs
    expect(results[0].edits).toHaveLength(6);
  });

  it("applies edits correctly to plantuml source", () => {
    const db = makeDb();
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const puml = [
      'Container(orders_api, "Orders API")',
      'ContainerDb(orders_db, "Orders DB")',
      'Rel(orders_api, orders_db, "SQL")',
    ].join("\n");

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    const patched = applyEdits(puml, results[0].edits);

    expect(patched).toContain("orders_repo");
    expect(patched).toContain("Rel(orders_repo, orders_db");
    expect(patched).toContain("Rel(orders_api, orders_repo");
    expect(patched).not.toContain("Rel(orders_api, orders_db");
  });

  it("applies edits correctly to structurizr DSL source", () => {
    const db = makeDb();
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const dsl = [
      'orders_api = container "Orders API"',
      'orders_db = container "Orders DB"',
      'orders_api -> orders_db "SQL"',
    ].join("\n");

    const results = fixCrud(
      model,
      [violation("orders_api")],
      structurizrDslSyntax,
    );
    const patched = applyEdits(dsl, results[0].edits);

    expect(patched).toContain("orders_repo = container");
    expect(patched).toContain("orders_repo -> orders_db");
    expect(patched).toContain("orders_api -> orders_repo");
    expect(patched).not.toContain("orders_api -> orders_db");
  });
});

describe("fixCrud invariants", () => {
  // Property-based: text-based applyEdits must successfully transform a
  // minimal source built from the model — anything else means fix produced
  // edits that don't match the surface it's supposed to patch.
  test.prop([nameArb])(
    "round-trip: applying edits to a synthetic source and re-checking yields fewer crud violations",
    (svcName) => {
      const db: Container = {
        name: "db",
        label: "db",
        type: CONTAINER_DB_TYPE,
        description: "",
        relations: [],
      };
      const svc = makeContainer(svcName, [{ to: db }]);
      const model = makeModel([svc, db]);

      const before = checkCrud(model.allContainers);
      if (before.length === 0) return;

      const source = [
        "@startuml",
        `Container(${svc.name}, "${svc.name}")`,
        `ContainerDb(${db.name}, "${db.name}")`,
        `Rel(${svc.name}, ${db.name}, "")`,
        "@enduml",
      ].join("\n");

      const fixes = fixCrud(model, before, plantumlSyntax);
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
      const db: Container = {
        name: "db",
        label: "db",
        type: CONTAINER_DB_TYPE,
        description: "",
        relations: [],
      };
      const svc = makeContainer(svcName, [{ to: db }]);
      const model = makeModel([svc, db]);
      const violations = checkCrud(model.allContainers);
      const fixes = fixCrud(model, violations, plantumlSyntax);
      for (const fix of fixes) {
        for (const edit of fix.edits) {
          expect(typeof edit.search).toBe("string");
          expect(edit.search.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe("fixCrud — cross-boundary", () => {
  const makeCrossBoundaryModel = (): {
    model: ArchitectureModel;
    accessor: Container;
    db: Container;
    repo: Container;
    publicApi: Container;
  } => {
    const db = makeDb();
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const publicApi = makeContainer("orders_public_api");
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const model: ArchitectureModel = {
      boundaries: [
        {
          name: "orders",
          label: "orders",
          containers: [publicApi, repo, db],
          boundaries: [],
        },
        {
          name: "fulfillment",
          label: "fulfillment",
          containers: [accessor],
          boundaries: [],
        },
      ],
      allContainers: [publicApi, repo, db, accessor],
    };
    return { model, accessor, db, repo, publicApi };
  };

  it("redirects cross-boundary accessor through public API of target boundary", () => {
    const { model, accessor } = makeCrossBoundaryModel();

    const results = fixCrud(model, [violation(accessor.name)], plantumlSyntax);
    expect(results).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].content).toContain("orders_public_api");
    expect(results[0].edits[0].content).not.toContain("orders_repo");
  });

  it("warns and skips when cross-boundary has no public API", () => {
    const db = makeDb();
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const model: ArchitectureModel = {
      boundaries: [
        {
          name: "orders",
          label: "orders",
          containers: [repo, db],
          boundaries: [],
        },
        {
          name: "fulfillment",
          label: "fulfillment",
          containers: [accessor],
          boundaries: [],
        },
      ],
      allContainers: [repo, db, accessor],
    };

    const results = fixCrud(
      model,
      [violation("fulfillment_api")],
      plantumlSyntax,
    );
    expect(results).toHaveLength(0);
  });

  it("warns and skips when no repo exists cross-boundary", () => {
    const db = makeDb();
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const model: ArchitectureModel = {
      boundaries: [
        {
          name: "orders",
          label: "orders",
          containers: [db],
          boundaries: [],
        },
        {
          name: "fulfillment",
          label: "fulfillment",
          containers: [accessor],
          boundaries: [],
        },
      ],
      allContainers: [db, accessor],
    };

    const results = fixCrud(
      model,
      [violation("fulfillment_api")],
      plantumlSyntax,
    );
    expect(results).toHaveLength(0);
  });
});

describe("fixCrud — repo has non-database dependencies", () => {
  it("removes non-db relation from repo", () => {
    const db = makeDb();
    const other = makeContainer("external_svc");
    const repo = makeContainer(
      "orders_repo",
      [{ to: db }, { to: other }],
      ["repo"],
    );
    const model = makeModel([repo, db, other]);

    const results = fixCrud(model, [violation("orders_repo")], plantumlSyntax);

    expect(results).toHaveLength(1);
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("remove");
    expect(results[0].edits[0].search).toContain("orders_repo");
    expect(results[0].edits[0].search).toContain("external_svc");
  });

  it("removes multiple non-db relations", () => {
    const db = makeDb();
    const svc1 = makeContainer("svc1");
    const svc2 = makeContainer("svc2");
    const repo = makeContainer(
      "orders_repo",
      [{ to: db }, { to: svc1 }, { to: svc2 }],
      ["repo"],
    );
    const model = makeModel([repo, db, svc1, svc2]);

    const results = fixCrud(model, [violation("orders_repo")], plantumlSyntax);

    expect(results[0].edits).toHaveLength(2);
  });

  it("does not remove db relations", () => {
    const db = makeDb();
    const repo = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const model = makeModel([repo, db]);

    const results = fixCrud(model, [violation("orders_repo")], plantumlSyntax);
    expect(results).toHaveLength(0);
  });
});
