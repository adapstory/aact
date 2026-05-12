import { expandBiRel } from "../../../src/formats/_shared/biRel";
import {
  boundaryMacroName,
  c4MacroName,
  parseBoundaryMacro,
  parseC4MacroKind,
} from "../../../src/formats/_shared/c4Mapping";
import {
  parseCsvTags,
  parseHashtagTags,
} from "../../../src/formats/_shared/tags";

describe("c4Mapping", () => {
  it.each([
    ["Person", "Person", false],
    ["Person_Ext", "Person", true],
    ["System", "System", false],
    ["System_Ext", "System", true],
    ["Container", "Container", false],
    ["ContainerDb", "ContainerDb", false],
    ["ContainerDb_Ext", "ContainerDb", true],
    ["Component", "Component", false],
    ["ComponentQueue_Ext", "ComponentQueue", true],
  ])("parseC4MacroKind(%s) → kind=%s external=%s", (macro, kind, external) => {
    expect(parseC4MacroKind(macro)).toEqual({ kind, external });
  });

  it("parseC4MacroKind returns undefined for unknown macro", () => {
    expect(parseC4MacroKind("Mystery")).toBeUndefined();
  });

  it.each([
    ["Boundary", "System"],
    ["System_Boundary", "System"],
    ["Container_Boundary", "Container"],
    ["Component_Boundary", "Component"],
    ["Enterprise_Boundary", "Enterprise"],
  ])("parseBoundaryMacro(%s) → %s", (macro, expected) => {
    expect(parseBoundaryMacro(macro)).toBe(expected);
  });

  it("parseBoundaryMacro defaults unknown to System", () => {
    expect(parseBoundaryMacro("Mystery")).toBe("System");
  });

  it.each([
    ["Person", false, "Person"],
    ["Person", true, "Person_Ext"],
    ["System", false, "System"],
    ["System", true, "System_Ext"],
    ["Container", false, "Container"],
    ["Container", true, "Container_Ext"],
    ["ContainerDb", false, "ContainerDb"],
    ["ContainerDb", true, "ContainerDb_Ext"],
    ["ComponentQueue", true, "ComponentQueue_Ext"],
  ])("c4MacroName(%s, external=%s) → %s", (kind, external, expected) => {
    expect(c4MacroName(kind as never, external)).toBe(expected);
  });

  it.each([
    ["System", "System_Boundary"],
    ["Container", "Container_Boundary"],
    ["Component", "Component_Boundary"],
    ["Enterprise", "Enterprise_Boundary"],
  ])("boundaryMacroName(%s) → %s", (kind, expected) => {
    expect(boundaryMacroName(kind as never)).toBe(expected);
  });
});

describe("tags helpers", () => {
  it("parseCsvTags returns [] for undefined", () => {
    expect(parseCsvTags()).toEqual([]);
  });

  it("parseCsvTags returns [] for empty string", () => {
    expect(parseCsvTags("")).toEqual([]);
  });

  it("parseCsvTags splits, trims, filters empty", () => {
    expect(parseCsvTags("a, b , , c")).toEqual(["a", "b", "c"]);
  });

  it("parseHashtagTags extracts #tag names without #", () => {
    expect(parseHashtagTags("foo #bar baz #qux-1 #under_score")).toEqual([
      "bar",
      "qux-1",
      "under_score",
    ]);
  });

  it("parseHashtagTags returns [] when no hashtags", () => {
    expect(parseHashtagTags("plain text")).toEqual([]);
  });
});

describe("expandBiRel", () => {
  it("returns symmetric pair with shared attrs", () => {
    const [forward, backward] = expandBiRel("a", "b", {
      technology: "REST",
      tags: ["sync"],
    });
    expect(forward).toEqual({
      to: "b",
      technology: "REST",
      tags: ["sync"],
    });
    expect(backward).toEqual({
      to: "a",
      technology: "REST",
      tags: ["sync"],
    });
  });

  it("uses only attrs argument, ignores extras", () => {
    const [f, b] = expandBiRel("x", "y", { tags: [] });
    expect(f.to).toBe("y");
    expect(b.to).toBe("x");
  });
});
