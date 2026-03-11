import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import type { ArchitectureModel, Container } from "../../src/model";
import { applyEdits } from "../../src/rules/fix";
import { fixDbPerService } from "../../src/rules/fixDbPerService";

const makeDb = (name = "orders_db"): Container => ({
  name,
  label: "Orders DB",
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

const makeModel = (containers: Container[]): ArchitectureModel => ({
  boundaries: [{ name: "root", label: "Root", containers, boundaries: [] }],
  allContainers: containers,
});

describe("fixDbPerService", () => {
  it("returns empty for empty violations", () => {
    const model = makeModel([]);
    expect(fixDbPerService(model, [], plantumlSyntax)).toEqual([]);
  });

  it("returns no fix when db has one accessor", () => {
    const db = makeDb();
    const svc = makeContainer("orders_repo", [{ to: db }]);
    const model = makeModel([svc, db]);

    const results = fixDbPerService(
      model,
      [
        {
          container: "orders_db",
          message: "accessed by multiple services: orders_repo",
        },
      ],
      plantumlSyntax,
    );
    expect(results).toHaveLength(0);
  });

  it("returns one FixResult for two accessors", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [
        {
          container: "orders_db",
          message: "accessed by multiple services: orders_repo, payments",
        },
      ],
      plantumlSyntax,
    );
    expect(results).toHaveLength(1);
  });

  it("generates replace edit for extra accessor", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [
        {
          container: "orders_db",
          message: "accessed by multiple services: orders_repo, payments",
        },
      ],
      plantumlSyntax,
    );
    const edits = results[0].edits;
    expect(edits).toHaveLength(1);
    expect(edits[0].type).toBe("replace");
    expect(edits[0].search).toContain("Rel(payments, orders_db");
    expect(edits[0].content).toContain("Rel(payments, orders_repo");
  });

  it("prefers repo-tagged container as owner", () => {
    const db = makeDb();
    const svc1 = makeContainer("payments", [{ to: db }]);
    const svc2 = makeContainer("orders_repo", [{ to: db }], ["repo"]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[0].search).toContain("payments");
  });

  it("falls back to first accessor when no repo tag found", () => {
    const db = makeDb();
    const svc1 = makeContainer("alpha", [{ to: db }]);
    const svc2 = makeContainer("beta", [{ to: db }]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits[0].content).toContain("alpha");
  });

  it("generates replace for each extra accessor with three accessors", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }]);
    const svc3 = makeContainer("analytics", [{ to: db }]);
    const model = makeModel([svc1, svc2, svc3, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits).toHaveLength(2);
    expect(results[0].edits[0].search).toContain("payments");
    expect(results[0].edits[1].search).toContain("analytics");
  });

  it("returns FixResult for each violated db", () => {
    const db1 = makeDb("orders_db");
    const db2: Container = { ...makeDb("users_db"), label: "Users DB" };
    const svc1 = makeContainer("svc1", [{ to: db1 }]);
    const svc2 = makeContainer("svc2", [{ to: db1 }, { to: db2 }]);
    const svc3 = makeContainer("svc3", [{ to: db2 }]);
    const model = makeModel([svc1, svc2, svc3, db1, db2]);

    const results = fixDbPerService(
      model,
      [
        { container: "orders_db", message: "" },
        { container: "users_db", message: "" },
      ],
      plantumlSyntax,
    );
    expect(results).toHaveLength(2);
  });

  it("description contains container names", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].description).toContain("orders_db");
    expect(results[0].description).toContain("orders_repo");
  });

  it("applies edits correctly to puml fragment", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }]);
    const model = makeModel([svc1, svc2, db]);

    const puml = [
      'Container(orders_repo, "Orders Repo")',
      'ContainerDb(orders_db, "Orders DB")',
      'Container(payments, "Payments")',
      'Rel(orders_repo, orders_db, "CRUD")',
      'Rel(payments, orders_db, "reads")',
    ].join("\n");

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("Rel(payments, orders_repo");
    expect(patched).not.toContain("Rel(payments, orders_db");
    // original relation untouched
    expect(patched).toContain("Rel(orders_repo, orders_db");
  });

  it("does not affect lines without violations", () => {
    const db = makeDb();
    const other = makeContainer("notifications");
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db }, { to: other }]);
    const model = makeModel([svc1, svc2, other, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].search).not.toContain("notifications");
  });

  it("works with async tags in Rel", () => {
    const db = makeDb();
    const svc1 = makeContainer("orders_repo", [{ to: db }]);
    const svc2 = makeContainer("payments", [{ to: db, tags: ["async"] }]);
    const model = makeModel([svc1, svc2, db]);

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].edits[0].content).toContain('$tags="async"');
  });
});
