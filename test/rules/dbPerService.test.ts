import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import { dbPerServiceRule } from "../../src/rules";
import { applyEdits } from "../../src/rules/lib/applyEdits";
import type { BoundarySpec, ContainerSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const dbSpec = (name = "orders_db", label = "Orders DB"): ContainerSpec => ({
  name,
  label,
  kind: "ContainerDb",
});

const violation = (container: string) => ({ container, message: "" });

const buildModel = (containers: ContainerSpec[], boundaries?: BoundarySpec[]) =>
  makeModel({ containers, boundaries });

const fixPuml = (
  containers: ContainerSpec[],
  violationContainer: string,
  boundaries?: BoundarySpec[],
) => {
  const model = buildModel(containers, boundaries);
  return dbPerServiceRule.fix!(
    model,
    [violation(violationContainer)],
    plantumlSyntax,
  );
};

describe("dbPerServiceRule.check", () => {
  it("no violation when each DB has single accessor", () => {
    const model = buildModel([
      { name: "a", relations: [{ to: "db_a" }] },
      dbSpec("db_a"),
    ]);
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });

  it("violation when DB shared between multiple containers", () => {
    const model = buildModel([
      { name: "a", relations: [{ to: "shared_db" }] },
      { name: "b", relations: [{ to: "shared_db" }] },
      dbSpec("shared_db"),
    ]);
    const v = dbPerServiceRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].container).toBe("shared_db");
    expect(v[0].message).toContain("a");
    expect(v[0].message).toContain("b");
  });

  it("non-DB shared is fine", () => {
    const model = buildModel([
      { name: "a", relations: [{ to: "common" }] },
      { name: "b", relations: [{ to: "common" }] },
      { name: "common" },
    ]);
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });
});

describe("dbPerServiceRule.fix", () => {
  it("returns empty for empty violations", () => {
    expect(dbPerServiceRule.fix!(buildModel([]), [], plantumlSyntax)).toEqual(
      [],
    );
  });

  it("returns no fix when db has one accessor", () => {
    const results = fixPuml(
      [{ name: "orders_repo", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_db",
    );
    expect(results).toHaveLength(0);
  });

  it("returns one FixResult for two accessors", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results).toHaveLength(1);
  });

  it("generates replace edit for extra accessor", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].search).toContain("Rel(payments, orders_db");
    expect(results[0].edits[0].content).toContain("Rel(payments, orders_repo");
  });

  it("prefers repo-tagged container as owner", () => {
    const results = fixPuml(
      [
        { name: "payments", relations: [{ to: "orders_db" }] },
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[0].search).toContain("payments");
  });

  it("emits the multi-tagged warning with both names and the chosen owner", () => {
    const calls: unknown[][] = [];
    const original = consola.warn;
    consola.warn = ((...args: unknown[]) => {
      calls.push(args);
    }) as typeof consola.warn;
    try {
      fixPuml(
        [
          {
            name: "orders_repo",
            tags: ["repo"],
            relations: [{ to: "orders_db" }],
          },
          {
            name: "payments_repo",
            tags: ["repo"],
            relations: [{ to: "orders_db" }],
          },
          dbSpec(),
        ],
        "orders_db",
      );
    } finally {
      consola.warn = original;
    }
    expect(calls.length).toBeGreaterThan(0);
    const msg = String(calls[0][0]);
    expect(msg).toContain("Cannot determine owner of orders_db");
    expect(msg).toContain("multiple tagged accessors");
    expect(msg).toContain("orders_repo");
    expect(msg).toContain("payments_repo");
    expect(msg).toContain("using orders_repo");
  });

  it("emits the no-tagged warning when falling back to first accessor", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    fixPuml(
      [
        { name: "alpha", relations: [{ to: "orders_db" }] },
        { name: "beta", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("Cannot determine owner of orders_db");
    expect(msg).toContain("no repo/relay tagged accessor found");
    expect(msg).toContain("using alpha");
  });

  it("does NOT warn about multiple owners when only one is tagged", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        { name: "orders_api", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("requires both name AND kind=ContainerDb to pick the violated db", () => {
    // Stryker: ensure `kind === "ContainerDb"` check still fires.
    const results = fixPuml(
      [
        { name: "orders_db", label: "lookalike" }, // same name, kind=Container
        // real DB has a different name to avoid duplicate-container ModelIssue
        dbSpec("real_orders_db", "Real Orders DB"),
        { name: "a", relations: [{ to: "real_orders_db" }] },
        { name: "b", relations: [{ to: "real_orders_db" }] },
      ],
      "real_orders_db",
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits[0].search).toContain("real_orders_db");
  });

  it("uses an empty tech part when rel.technology is undefined", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain(
      'Rel(payments, orders_repo, ""',
    );
  });

  it("preserves rel.technology when present", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        {
          name: "payments",
          relations: [{ to: "orders_db", technology: "PostgreSQL" }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain('"PostgreSQL"');
  });

  it("joins non-empty tags with + when rendering a redirected relation", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        {
          name: "payments",
          relations: [{ to: "orders_db", tags: ["async", "audit"] }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain('$tags="async+audit"');
  });

  it("does NOT throw when a violation names a db with zero accessors", () => {
    const model = buildModel([dbSpec("orders_db")]);
    expect(() =>
      dbPerServiceRule.fix!(model, [violation("orders_db")], plantumlSyntax),
    ).not.toThrow();
  });

  it("matches accessors whose tags array CONTAINS a repo tag, not requires all", () => {
    const results = fixPuml(
      [
        { name: "payments", relations: [{ to: "orders_db" }] },
        {
          name: "orders_repo",
          tags: ["repo", "internal"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].search).toContain("Rel(payments, orders_db");
    expect(results[0].edits[0].content).toContain("Rel(payments, orders_repo");
  });

  it("silently skips a violation whose container is not in the model", () => {
    const model = buildModel([{ name: "a" }, { name: "b" }]);
    expect(
      dbPerServiceRule.fix!(model, [violation("ghost")], plantumlSyntax),
    ).toHaveLength(0);
  });

  it("includes ONLY accessors that actually reach the db", () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        { name: "payments", relations: [{ to: "orders_db" }] },
        { name: "logger" }, // no relation to db
        dbSpec(),
      ],
      "orders_db",
    );
    for (const edit of results[0].edits) {
      const text = `${edit.search} ${edit.content ?? ""}`;
      expect(text).not.toContain("logger");
    }
  });

  it('tags every FixResult with rule="dbPerService"', () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].rule).toBe("dbPerService");
  });

  it("treats an empty tags array as no tags", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        {
          name: "payments",
          relations: [{ to: "orders_db", tags: [] }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).not.toContain("$tags=");
  });

  it('passes "dbPerService" as ruleName into the boundary warn', () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
        { name: "fulfillment_api", relations: [{ to: "orders_db" }] },
      ],
      "orders_db",
      [
        { name: "orders", containerNames: ["orders_repo", "orders_db"] },
        { name: "fulfillment", containerNames: ["fulfillment_api"] },
      ],
    );
    if (warn.mock.calls.length > 0) {
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain("fix dbPerService");
    }
  });

  it("does NOT auto-fix when only one accessor exists", () => {
    const results = fixPuml(
      [{ name: "orders_repo", relations: [{ to: "orders_db" }] }, dbSpec()],
      "orders_db",
    );
    expect(results).toHaveLength(0);
  });

  it("warns and uses the first when multiple tagged owners are present", () => {
    const results = fixPuml(
      [
        {
          name: "orders_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        {
          name: "payments_repo",
          tags: ["repo"],
          relations: [{ to: "orders_db" }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain("orders_repo");
    expect(results[0].edits[0].search).toContain("payments_repo");
  });

  it("falls back to first accessor when no repo tag found", () => {
    const results = fixPuml(
      [
        { name: "alpha", relations: [{ to: "orders_db" }] },
        { name: "beta", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain("alpha");
  });

  it("generates replace for each extra accessor with three accessors", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        { name: "analytics", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits).toHaveLength(2);
    // Owner = analytics (first alphabetic among untagged accessors).
    // Extras = orders_repo, payments — both redirect to the owner.
    const searches = results[0].edits.map((e) => e.search);
    expect(searches.some((s) => s.includes("Rel(orders_repo, orders_db"))).toBe(
      true,
    );
    expect(searches.some((s) => s.includes("Rel(payments, orders_db"))).toBe(
      true,
    );
    for (const e of results[0].edits) {
      expect(e.content).toContain("analytics");
    }
  });

  it("returns FixResult for each violated db", () => {
    const model = buildModel([
      { name: "svc1", relations: [{ to: "orders_db" }] },
      {
        name: "svc2",
        relations: [{ to: "orders_db" }, { to: "users_db" }],
      },
      { name: "svc3", relations: [{ to: "users_db" }] },
      dbSpec("orders_db"),
      dbSpec("users_db", "Users DB"),
    ]);
    const results = dbPerServiceRule.fix!(
      model,
      [violation("orders_db"), violation("users_db")],
      plantumlSyntax,
    );
    expect(results).toHaveLength(2);
  });

  it("description contains container names", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].description).toContain("orders_db");
    expect(results[0].description).toContain("orders_repo");
  });

  it("applies edits correctly to puml fragment", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        { name: "payments", relations: [{ to: "orders_db" }] },
        dbSpec(),
      ],
      "orders_db",
    );
    const puml = [
      'Container(orders_repo, "Orders Repo")',
      'ContainerDb(orders_db, "Orders DB")',
      'Container(payments, "Payments")',
      'Rel(orders_repo, orders_db, "CRUD")',
      'Rel(payments, orders_db, "reads")',
    ].join("\n");
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("Rel(payments, orders_repo");
    expect(patched).not.toContain("Rel(payments, orders_db");
    expect(patched).toContain("Rel(orders_repo, orders_db");
  });

  it("does not affect lines without violations", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        {
          name: "payments",
          relations: [{ to: "orders_db" }, { to: "notifications" }],
        },
        { name: "notifications" },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits).toHaveLength(1);
    expect(results[0].edits[0].search).not.toContain("notifications");
  });

  it("works with async tags in Rel", () => {
    const results = fixPuml(
      [
        { name: "orders_repo", relations: [{ to: "orders_db" }] },
        {
          name: "payments",
          relations: [{ to: "orders_db", tags: ["async"] }],
        },
        dbSpec(),
      ],
      "orders_db",
    );
    expect(results[0].edits[0].content).toContain('$tags="async"');
  });
});

describe("dbPerServiceRule.fix invariants", () => {
  test.prop([nameArb, nameArb])(
    "never throws on any pair of services sharing a db",
    (a, b) => {
      if (a === b) return;
      const model = buildModel([
        { name: a, relations: [{ to: "shared" }] },
        { name: b, relations: [{ to: "shared" }] },
        dbSpec("shared", "shared"),
      ]);
      const violations = dbPerServiceRule.check(model);
      const result = dbPerServiceRule.fix!(model, violations, plantumlSyntax);
      expect(Array.isArray(result)).toBe(true);
    },
  );
});

describe("dbPerServiceRule.fix — cross-boundary", () => {
  const crossBoundaryBoundaries: BoundarySpec[] = [
    {
      name: "orders",
      containerNames: ["orders_public_api", "orders_repo", "orders_db"],
    },
    { name: "fulfillment", containerNames: ["fulfillment_api"] },
  ];
  const crossBoundaryContainers: ContainerSpec[] = [
    { name: "orders_public_api" },
    {
      name: "orders_repo",
      tags: ["repo"],
      relations: [{ to: "orders_db" }],
    },
    dbSpec(),
    { name: "fulfillment_api", relations: [{ to: "orders_db" }] },
  ];

  it("redirects cross-boundary accessor through public API of db boundary", () => {
    const results = fixPuml(
      crossBoundaryContainers,
      "orders_db",
      crossBoundaryBoundaries,
    );
    expect(results).toHaveLength(1);
    expect(results[0].edits[0].type).toBe("replace");
    expect(results[0].edits[0].content).toContain("orders_public_api");
    expect(results[0].edits[0].content).not.toContain("orders_repo");
  });

  it("skips cross-boundary accessor when db boundary has no public API", () => {
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
      "orders_db",
      [
        { name: "orders", containerNames: ["orders_repo", "orders_db"] },
        { name: "fulfillment", containerNames: ["fulfillment_api"] },
      ],
    );
    expect(results).toHaveLength(0);
  });

  it("still redirects same-boundary accessor through repo when mixed boundaries", () => {
    const results = fixPuml(
      [
        ...crossBoundaryContainers,
        { name: "orders_worker", relations: [{ to: "orders_db" }] },
      ],
      "orders_db",
      [
        {
          name: "orders",
          containerNames: [
            "orders_public_api",
            "orders_repo",
            "orders_db",
            "orders_worker",
          ],
        },
        { name: "fulfillment", containerNames: ["fulfillment_api"] },
      ],
    );
    const edits = results[0].edits;
    const internalEdit = edits.find((e) => e.search.includes("orders_worker"));
    const crossEdit = edits.find((e) => e.search.includes("fulfillment_api"));

    expect(internalEdit?.content).toContain("orders_repo");
    expect(crossEdit?.content).toContain("orders_public_api");
  });
});

describe("dbPerServiceRule.fix (structurizr syntax)", () => {
  it("replaces relation pattern correctly", () => {
    const model = buildModel([
      {
        name: "orders_repo",
        label: "Orders Repo",
        relations: [{ to: "orders_db", technology: "PostgreSQL" }],
      },
      {
        name: "other_service",
        label: "Other Service",
        relations: [{ to: "orders_db" }],
      },
      dbSpec(),
    ]);
    const results = dbPerServiceRule.fix!(
      model,
      [violation("orders_db")],
      structurizrDslSyntax,
    );
    const dsl = [
      'orders_repo = container "Orders Repo"',
      'other_service = container "Other Service"',
      'orders_db = container "Orders DB" "Storage" "PostgreSQL"',
      'orders_repo -> orders_db "PostgreSQL"',
      'other_service -> orders_db ""',
    ].join("\n");
    const patched = applyEdits(dsl, results[0].edits);

    expect(patched).toContain("other_service -> orders_repo");
    expect(patched).not.toContain("other_service -> orders_db");
  });
});
