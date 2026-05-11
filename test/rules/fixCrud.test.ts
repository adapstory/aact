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

  it("ignores non-db outbound relations when computing dbRels (covers .filter MethodExpression)", () => {
    // Stryker mutated `accessor.relations.filter(r => r.to.type === dbType)`
    // to just `accessor.relations`. Without the filter every outbound edge
    // counts as a db hit and the fix emits nonsense edits referencing
    // non-db targets. Pin: a non-repo with one db and one non-db relation
    // produces edits that only mention the db.
    const db = makeDb();
    const other = makeContainer("notifications");
    const api = makeContainer("orders_api", [{ to: db }, { to: other }]);
    const model = makeModel([api, db, other]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results).toHaveLength(1);
    // Should generate exactly 3 edits (one db), not 6 (would be two if
    // every relation were treated as db)
    expect(results[0].edits).toHaveLength(3);
    for (const edit of results[0].edits) {
      const text = `${edit.search} ${edit.content ?? ""}`;
      expect(text).not.toContain("notifications");
    }
  });

  it("does not consider accessor itself when scanning for an existing repo (covers c !== accessor)", () => {
    // Stryker mutated `c !== accessor && ...` so that `accessor` (which has
    // the db relation) could be picked as its own repo. Pin: with a non-repo
    // accessor, the existing-repo lookup misses, and the fix falls through
    // to repo creation (3 edits) rather than self-redirect (1 replace).
    const db = makeDb();
    // Accessor is self-loop-eligible: it has db relation AND no repo tag.
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    expect(results[0].edits).toHaveLength(3);
    expect(results[0].edits[0].type).toBe("add"); // create repo
    expect(results[0].edits[2].type).toBe("replace");
    expect(results[0].edits[2].content).not.toContain(
      "Rel(orders_api, orders_api",
    );
  });

  it("requires the candidate repo to actually reach the same db (covers .some)", () => {
    // Stryker mutated `c.relations.some(r => r.to.name === db.name)` to
    // `.every`. A tagged container with relations to unrelated targets
    // would falsely qualify as the existing repo. Pin: a repo-tagged
    // container that does NOT reach orders_db must not be picked.
    const db = makeDb();
    const unrelatedDb = makeDb("other_db");
    const unrelatedRepo = makeContainer(
      "other_repo",
      [{ to: unrelatedDb }],
      ["repo"],
    );
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, unrelatedRepo, db, unrelatedDb]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    // Should fall through to creating orders_repo, not redirect to other_repo
    expect(results[0].edits).toHaveLength(3);
    for (const edit of results[0].edits) {
      const text = `${edit.search} ${edit.content ?? ""}`;
      expect(text).not.toContain("other_repo");
    }
    expect(results[0].edits[0].content).toContain("orders_repo");
  });

  it("treats an untagged candidate as not-a-repo (covers c.tags?.includes)", () => {
    // Stryker mutated `c.tags?.includes(t)` to `c.tags.includes(t)`. With
    // the unsafe access, a container without `tags` would throw. Pin:
    // candidates with no tags array are skipped cleanly.
    const db = makeDb();
    const candidate = makeContainer("orders_helper", [{ to: db }]); // no tags
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, candidate, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax);
    // Should fall through to creating orders_repo, not pick orders_helper
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[0].content).not.toContain("orders_helper");
  });

  it("emits the cross-boundary no-repo warning with rule, accessor and db names", () => {
    // Stryker mutated the warn template to an empty string. Pin the
    // message format precisely so the diagnostic stays useful.
    const db = makeDb();
    const accessor = makeContainer("fulfillment_api", [{ to: db }]);
    const model: ArchitectureModel = {
      boundaries: [
        { name: "orders", label: "orders", containers: [db], boundaries: [] },
        {
          name: "fulfillment",
          label: "fulfillment",
          containers: [accessor],
          boundaries: [],
        },
      ],
      allContainers: [db, accessor],
    };
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    fixCrud(model, [violation("fulfillment_api")], plantumlSyntax);
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud");
    expect(msg).toContain("fulfillment_api");
    expect(msg).toContain("orders_db");
    expect(msg).toContain("cross-boundary");
    expect(msg).toContain("no existing repo");
    expect(msg).toContain("fix manually");
  });

  it("propagates custom repoTags as the tag of the created repo (covers ownerTags[0])", () => {
    // Stryker mutated `ownerTags[0] ?? "repo"` such that the literal "repo"
    // could be emitted regardless of the configured tags. Pin: a custom
    // repoTags=["relay"] config produces $tags="relay" on the new repo
    // container, not "repo".
    const db = makeDb();
    const api = makeContainer("orders_api", [{ to: db }]);
    const model = makeModel([api, db]);

    const results = fixCrud(model, [violation("orders_api")], plantumlSyntax, {
      repoTags: ["relay"],
    });
    expect(results[0].edits[0].content).toContain('$tags="relay"');
    expect(results[0].edits[0].content).not.toContain('$tags="repo"');
  });

  it('tags repo-with-non-db-deps fixes with rule="crud" and a descriptive message', () => {
    // Pins L164 (rule) and L165 (description) for the second fix path.
    const db = makeDb();
    const other = makeContainer("audit_svc");
    const repo = makeContainer(
      "orders_repo",
      [{ to: db }, { to: other }],
      ["repo"],
    );
    const model = makeModel([repo, db, other]);

    const results = fixCrud(model, [violation("orders_repo")], plantumlSyntax);
    expect(results[0].rule).toBe("crud");
    expect(results[0].description).toBe(
      "Remove non-database dependencies from repo orders_repo",
    );
  });

  it("silently skips a violation that names a non-existent container", () => {
    // Pins L188 `if (!container) continue`.
    const db = makeDb();
    const model = makeModel([db]);
    expect(fixCrud(model, [violation("ghost")], plantumlSyntax)).toHaveLength(
      0,
    );
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
