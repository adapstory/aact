import { fc, test } from "@fast-check/vitest";

import { Container, CONTAINER_TYPE } from "../../src/model";
import { checkStableDependencies } from "../../src/rules";

const typeArb = fc
  .string({ minLength: 3, maxLength: 12 })
  .filter((s) => /^[A-Z][a-zA-Z_]*$/.test(s));

const makeContainer = (
  over: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: over.name,
  type: CONTAINER_TYPE,
  description: "",
  relations: [],
  ...over,
});

describe("checkStableDependencies", () => {
  it("returns no violations when unstable depends on stable", () => {
    // B is stable (Ca=1, Ce=0, I=0), A is unstable (Ca=0, Ce=1, I=1)
    // A→B: I(A)=1 >= I(B)=0 ✓
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
      relations: [{ to: b }],
    };

    expect(checkStableDependencies([a, b])).toHaveLength(0);
  });

  it("returns violation when stable depends on unstable", () => {
    // C depends on both A and B; A depends on C (cycle-like instability)
    // A: Ce=1 (→C), Ca=1 (C→A), I=0.5
    // B: Ce=0, Ca=1 (C→B), I=0
    // C: Ce=2 (→A,→B), Ca=1 (A→C), I=0.67
    // A→C: I(A)=0.5 < I(C)=0.67 → violation
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
      relations: [],
    };
    const c: Container = {
      name: "c",
      label: "C",
      type: "Container",
      description: "",
      relations: [{ to: a }, { to: b }],
    };
    (a as { relations: Container["relations"] }).relations = [{ to: c }];

    const violations = checkStableDependencies([a, b, c]);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const aViolation = violations.find((v) => v.container === "a");
    expect(aViolation).toBeDefined();
    // Assert message format, not just existence — Stryker showed a
    // surviving StringLiteral mutation that emptied the message.
    expect(aViolation!.message).toMatch(
      /stable module \(I=\d\.\d{2}\) depends on less stable "c" \(I=\d\.\d{2}\) — dependencies should point toward stability/,
    );
  });

  it("equal-instability A→B does NOT fire (strict-less-than boundary)", () => {
    // Both A and B end up at I=0.5: each has one in-degree and one out-degree
    // through the cycle. Stryker mutated `iSource < iTarget` to `<=`, which
    // would make equal instabilities fire — this pin guards that boundary.
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

    // I(a) = 1/(1+1) = 0.5, I(b) = 1/(1+1) = 0.5 → equal, no violation
    expect(checkStableDependencies([a, b])).toHaveLength(0);
  });

  it("counts each internal relation in efferent/afferent maps (regression)", () => {
    // a → b → c → a (cycle): every node has Ce=1, Ca=1, I=0.5 — no violation.
    // Mutation `ce.get(c)! - 1` would make Ce=-1, perturbing I and causing
    // spurious violations.
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

    expect(checkStableDependencies([a, b, c])).toHaveLength(0);
  });

  it("returns no violations for isolated container", () => {
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [],
    };

    expect(checkStableDependencies([a])).toHaveLength(0);
  });

  it("excludes external systems from calculation", () => {
    const ext: Container = {
      name: "ext",
      label: "External",
      type: "System_Ext",
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

    expect(checkStableDependencies([a, ext])).toHaveLength(0);
  });

  it("respects custom externalType option", () => {
    const legacy: Container = {
      name: "legacy",
      label: "Legacy",
      type: "Legacy_System",
      description: "",
      relations: [],
    };
    const svc: Container = {
      name: "svc",
      label: "Svc",
      type: "Container",
      description: "",
      relations: [{ to: legacy }],
    };

    // Without option, legacy is treated as internal → violation possible
    const withDefault = checkStableDependencies([svc, legacy]);
    // With custom externalType, legacy is excluded → no violations
    const withOption = checkStableDependencies([svc, legacy], {
      externalType: "Legacy_System",
    });
    expect(withOption).toHaveLength(0);
    // Default should include legacy as internal (I=0 for leaf, I=1 for svc)
    // svc→legacy: I(svc)=1 >= I(legacy)=0 ✓ no violation either
    expect(withDefault).toHaveLength(0);
  });

  it("handles chain A→B→C correctly", () => {
    // C: Ce=0, Ca=1, I=0
    // B: Ce=1, Ca=1, I=0.5
    // A: Ce=1, Ca=0, I=1
    // A→B: I(A)=1 >= I(B)=0.5 ✓
    // B→C: I(B)=0.5 >= I(C)=0 ✓
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

    expect(checkStableDependencies([a, b, c])).toHaveLength(0);
  });

  // Property-based: containers of the configured externalType must be excluded
  // from coupling calculation regardless of the literal type name used.
  test.prop([typeArb])(
    "containers of the configured externalType are excluded from coupling calculation",
    (customExternalType) => {
      const ext = makeContainer({ name: "ext", type: customExternalType });
      const stable = makeContainer({ name: "stable" });
      const unstable = makeContainer({
        name: "unstable",
        relations: [{ to: stable }, { to: ext }],
      });
      const withExternal = checkStableDependencies([stable, unstable, ext], {
        externalType: customExternalType,
      });
      const withoutExternal = checkStableDependencies([stable, unstable], {
        externalType: customExternalType,
      });
      expect(withExternal).toEqual(withoutExternal);
    },
  );
});
