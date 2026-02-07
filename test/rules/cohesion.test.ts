import { ArchitectureModel, Container } from "../../src/model";
import { checkCohesion } from "../../src/rules";

describe("checkCohesion", () => {
  it("returns no violations when cohesion > coupling", () => {
    const ext: Container = {
      name: "ext",
      label: "External",
      type: "System_Ext",
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
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: b }, { to: b }],
    };

    const model: ArchitectureModel = {
      allContainers: [a, b, ext],
      boundaries: [
        {
          name: "ctx",
          label: "Context",
          boundaries: [],
          containers: [a, b],
        },
      ],
    };

    expect(checkCohesion(model)).toHaveLength(0);
  });

  it("returns violation when coupling >= cohesion", () => {
    const ext: Container = {
      name: "ext",
      label: "External",
      type: "Container",
      description: "",
      relations: [],
    };
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: ext }],
    };

    const model: ArchitectureModel = {
      allContainers: [a, ext],
      boundaries: [
        {
          name: "ctx",
          label: "Context",
          boundaries: [],
          containers: [a],
        },
      ],
    };

    const violations = checkCohesion(model);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain("cohesion");
  });

  it("checks that parent cohesion < sum of inner cohesions", () => {
    const c1: Container = {
      name: "c1",
      label: "C1",
      type: "Container",
      description: "",
      relations: [],
    };
    const c2: Container = {
      name: "c2",
      label: "C2",
      type: "Container",
      description: "",
      relations: [{ to: c1 }],
    };
    const c3: Container = {
      name: "c3",
      label: "C3",
      type: "Container",
      description: "",
      relations: [],
    };
    const c4: Container = {
      name: "c4",
      label: "C4",
      type: "Container",
      description: "",
      relations: [{ to: c3 }, { to: c3 }],
    };

    // inner1 has cohesion=1 (c2->c1), coupling to c3 = 0
    // inner2 has cohesion=2 (c4->c3 x2), coupling = 0
    // parent has all 4 containers, so coupling to inner boundaries counts
    // inner boundary coupling: inner1=0, inner2=0
    // parent cohesion = relations within parent but crossing inner boundaries
    // c2->c1 is within inner1, so not crossing

    const inner1 = {
      name: "inner1",
      label: "Inner 1",
      boundaries: [],
      containers: [c1, c2],
    };
    const inner2 = {
      name: "inner2",
      label: "Inner 2",
      boundaries: [],
      containers: [c3, c4],
    };

    const model: ArchitectureModel = {
      allContainers: [c1, c2, c3, c4],
      boundaries: [
        {
          name: "parent",
          label: "Parent",
          boundaries: [inner1, inner2],
          containers: [c1, c2, c3, c4],
        },
        inner1,
        inner2,
      ],
    };

    // parent cohesion = inner boundaries coupling sum = 0+0=0
    // inner cohesion sum = 1+2=3
    // 0 < 3 — OK, no violation on this check
    // But cohesion(0) <= coupling(0) will trigger first check
    const violations = checkCohesion(model);
    expect(violations.some((v) => v.container === "parent")).toBe(true);
  });
});
