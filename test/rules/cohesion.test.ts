import { cohesionRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("cohesionRule.check", () => {
  it("violation when coupling >= cohesion (no internal relations)", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "outside" }] },
        { name: "outside" },
      ],
      boundaries: [{ name: "b1", containerNames: ["a"] }],
    });
    const v = cohesionRule.check(model);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].container).toBe("b1");
  });

  it("no violation when cohesion > coupling", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }, { to: "c" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b", "c"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("ignores relations to external containers in coupling count", () => {
    // External target should NOT contribute to coupling (it's a known
    // architectural boundary, e.g. third-party SaaS).
    const model = makeModel({
      containers: [
        {
          name: "a",
          relations: [{ to: "b" }, { to: "ext_api" }],
        },
        { name: "b" },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    // cohesion = 1 (a→b), coupling = 0 (ext is external, not counted)
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("parent boundary's coupling counts inner-to-external relations", () => {
    // External relations from inner-boundary containers should bubble up
    // as parent.coupling (covers L41-50 in cohesion.ts).
    const model = makeModel({
      containers: [
        {
          name: "inner_svc",
          relations: [{ to: "ext_api" }],
        },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [
        {
          name: "parent",
          label: "parent",
          boundaryNames: ["inner"],
        },
        {
          name: "inner",
          label: "inner",
          containerNames: ["inner_svc"],
        },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    const parentViolation = violations.find((v) => v.container === "parent");
    expect(parentViolation).toBeDefined();
  });

  it("flags parent cohesion ≥ inner cohesion sum", () => {
    // Parent boundary should be LESS cohesive than its sub-boundaries.
    // When parent.cohesion ≥ Σ inner.cohesion → violation.
    const model = makeModel({
      containers: [
        {
          name: "x",
          relations: [{ to: "y" }, { to: "z" }],
        },
        { name: "y", relations: [{ to: "z" }] },
        { name: "z" },
      ],
      boundaries: [
        {
          name: "parent",
          label: "parent",
          containerNames: ["x", "y", "z"],
          boundaryNames: ["empty_inner"],
        },
        {
          name: "empty_inner",
          label: "empty inner",
          containerNames: [],
        },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    const tooCohesive = violations.find(
      (v) =>
        v.container === "parent" &&
        v.message.includes("less cohesive than its sub-boundaries"),
    );
    expect(tooCohesive).toBeDefined();
  });

  it("does not double-count: inner boundary's coupling is parent's cohesion", () => {
    // Cross-boundary inside parent's scope: inner.coupling counts (inner
    // perspective), but at parent's level same relation IS internal cohesion.
    const model = makeModel({
      containers: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      boundaries: [
        {
          name: "parent",
          boundaryNames: ["bA", "bB"],
        },
        { name: "bA", containerNames: ["a"] },
        { name: "bB", containerNames: ["b"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    // bA has coupling=1 (a→b), cohesion=0 — violation expected.
    // Parent's cohesion includes bA.coupling = 1 (which it now counts as
    // internal). Parent.coupling = 0.
    const innerViolation = violations.find((v) => v.container === "bA");
    expect(innerViolation).toBeDefined();
  });

  it("ignores dangling relation when computing cohesion/coupling", () => {
    // Cohesion/coupling shouldn't throw or mis-count when target is missing.
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "ghost" }, { to: "b" }] },
        { name: "b" },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    // cohesion = 1 (a→b), coupling = 0 (ghost is dangling, ignored)
    expect(cohesionRule.check(model)).toHaveLength(0);
  });
});
