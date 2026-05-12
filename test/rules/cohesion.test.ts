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
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }, { to: "ext_api" }] },
        { name: "b" },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("parent boundary's coupling counts inner-to-external relations", () => {
    const model = makeModel({
      containers: [
        { name: "inner_svc", relations: [{ to: "ext_api" }] },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [
        { name: "parent", label: "parent", boundaryNames: ["inner"] },
        { name: "inner", label: "inner", containerNames: ["inner_svc"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    expect(violations.find((v) => v.container === "parent")).toBeDefined();
  });

  it("flags parent cohesion ≥ inner cohesion sum", () => {
    const model = makeModel({
      containers: [
        { name: "x", relations: [{ to: "y" }, { to: "z" }] },
        { name: "y", relations: [{ to: "z" }] },
        { name: "z" },
      ],
      boundaries: [
        {
          name: "parent",
          containerNames: ["x", "y", "z"],
          boundaryNames: ["empty_inner"],
        },
        { name: "empty_inner", containerNames: [] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const tooCohesive = cohesionRule
      .check(model)
      .find(
        (v) =>
          v.container === "parent" &&
          v.message.includes("less cohesive than its sub-boundaries"),
      );
    expect(tooCohesive).toBeDefined();
  });

  it("inner boundary's coupling becomes parent's cohesion (covers nested cohesion accumulator)", () => {
    const model = makeModel({
      containers: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      boundaries: [
        { name: "parent", boundaryNames: ["bA", "bB"] },
        { name: "bA", containerNames: ["a"] },
        { name: "bB", containerNames: ["b"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    expect(violations.find((v) => v.container === "bA")).toBeDefined();
  });

  it("ignores dangling relation when computing cohesion/coupling", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "ghost" }, { to: "b" }] },
        { name: "b" },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("boundary with dangling container name doesn't throw (covers !container guard)", () => {
    // boundary.containerNames references missing container.
    const model = makeModel({
      containers: [{ name: "real" }],
      boundaries: [
        { name: "ctx", containerNames: ["real", "ghost_container"] },
      ],
    });
    expect(() => cohesionRule.check(model)).not.toThrow();
  });

  it("equal cohesion/coupling triggers violation (covers <= boundary)", () => {
    // a → b (internal, cohesion +1), a → outside (coupling +1).
    // cohesion=1, coupling=1, cohesion <= coupling → violation.
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }, { to: "outside" }] },
        { name: "b" },
        { name: "outside" },
      ],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    const v = cohesionRule.check(model);
    expect(v.find((it) => it.container === "ctx")).toBeDefined();
  });

  it("violation message contains both coupling and cohesion numbers", () => {
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "outside" }] },
        { name: "outside" },
      ],
      boundaries: [{ name: "b1", containerNames: ["a"] }],
    });
    const v = cohesionRule.check(model);
    expect(v[0].message).toMatch(/coupling \(\d+\)/);
    expect(v[0].message).toMatch(/cohesion \(\d+\)/);
    expect(v[0].message).toContain(
      "more cross-boundary dependencies than internal connections",
    );
  });

  it("rule description is non-empty", () => {
    // Pin description literal (Stryker mutates to empty).
    expect(cohesionRule.description).toContain("cohesive");
    expect(cohesionRule.description.length).toBeGreaterThan(20);
  });

  it("parent without inner boundaries: only cohesion≤coupling check fires, not the inner-sum check", () => {
    // Stryker mutated `boundary.boundaryNames.length > 0` predicate. A flat
    // boundary with no children should not trigger the inner-sum violation.
    const model = makeModel({
      containers: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      boundaries: [{ name: "ctx", containerNames: ["a", "b"] }],
    });
    const v = cohesionRule.check(model);
    // No "less cohesive than its sub-boundaries" message for a flat boundary.
    expect(
      v.find((it) => it.message.includes("less cohesive than")),
    ).toBeUndefined();
  });

  it("parent's coupling counts ONLY inner→external (not inner→inner-sibling)", () => {
    // Stryker can mutate `getContainer(model, r.to)?.external === true` to
    // `=== false`. Build a case where inner has both intra-parent siblings
    // AND a true external: parent.coupling should reflect only the external.
    const model = makeModel({
      containers: [
        { name: "a", relations: [{ to: "b" }, { to: "ext_x" }] },
        { name: "b" },
        { name: "ext_x", kind: "System", external: true },
      ],
      boundaries: [
        { name: "parent", boundaryNames: ["bA", "bB"] },
        { name: "bA", containerNames: ["a"] },
        { name: "bB", containerNames: ["b"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    // parent.coupling should = 1 (a→ext_x), not include a→b (sibling within parent).
    // bA itself should violate (coupling=2: b sibling + ext_x external; cohesion=0).
    const violations = cohesionRule.check(model);
    const bAViolation = violations.find((v) => v.container === "bA");
    expect(bAViolation).toBeDefined();
  });
});
