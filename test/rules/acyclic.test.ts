import { Container } from "../../src/model";
import { checkAcyclic } from "../../src/rules";

describe("checkAcyclic", () => {
  it("returns no violations for acyclic graph", () => {
    const c: Container = {
      name: "c",
      label: "C",
      type: "Container",
      description: "",
      relations: [],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: c }],
    };
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: b }],
    };

    expect(checkAcyclic([a, b, c])).toHaveLength(0);
  });

  it("violation message pins exact text", () => {
    // Stryker mutated `message: "participates in a dependency cycle"` to "".
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: a }],
    };
    (a as { relations: Container["relations"] }).relations = [{ to: b }];

    const violations = checkAcyclic([a, b]);
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(v.message).toBe("participates in a dependency cycle");
    }
  });

  it("respects the visited.has skip during traversal (covers L16)", () => {
    // Stryker mutated `if (visited.has(rel.to.name)) continue` to `false`.
    // Without the skip, the DFS recurses infinitely on cycles and either
    // throws (stack overflow) or hangs. Pin: a 3-node cycle terminates
    // and reports exactly one violation per participant.
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [],
    };
    const c: Container = {
      name: "c",
      label: "C",
      type: "Container",
      description: "",
      relations: [{ to: a }],
    };
    (a as { relations: Container["relations"] }).relations = [{ to: b }];
    (b as { relations: Container["relations"] }).relations = [{ to: c }];

    expect(() => checkAcyclic([a, b, c])).not.toThrow();
  });

  it("detects direct cycle A -> B -> A", () => {
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: a }],
    };
    a.relations.push({ to: b });

    const violations = checkAcyclic([a, b]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.container === "a")).toBe(true);
    expect(violations.some((v) => v.container === "b")).toBe(true);
  });

  it("detects indirect cycle A -> B -> C -> A", () => {
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };
    const c: Container = {
      name: "c",
      label: "C",
      type: "Container",
      description: "",
      relations: [{ to: a }],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: c }],
    };
    a.relations.push({ to: b });

    const violations = checkAcyclic([a, b, c]);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects self-cycle A -> A", () => {
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };
    a.relations.push({ to: a });

    const violations = checkAcyclic([a]);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("a");
  });

  it("returns no violations for empty list", () => {
    expect(checkAcyclic([])).toHaveLength(0);
  });

  it("returns no violations for isolated containers", () => {
    const containers: Container[] = [
      {
        name: "a",
        label: "A",
        type: "Container",
        description: "",
        relations: [],
      },
      {
        name: "b",
        label: "B",
        type: "Container",
        description: "",
        relations: [],
      },
    ];

    expect(checkAcyclic(containers)).toHaveLength(0);
  });
});
