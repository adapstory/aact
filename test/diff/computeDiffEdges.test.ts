import { computeDiff } from "../../src/diff";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

const SIDE = { source: "x", format: "plantuml" } as const;
const diff = (a: Model, b: Model, opts = {}) =>
  computeDiff(a, b, SIDE, SIDE, opts);

describe("computeDiff — additional field-level coverage", () => {
  it("detects label change as cosmetic field on element", () => {
    const a = makeModel({ elements: [{ name: "x", label: "Old Label" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New Label" }] });
    const result = diff(a, b);
    expect(result.changes[0].fields).toContainEqual(
      expect.objectContaining({ field: "label" }),
    );
  });

  it("detects external flag flip as semantic", () => {
    const a = makeModel({
      elements: [{ name: "ext", kind: "System", external: false }],
    });
    const b = makeModel({
      elements: [{ name: "ext", kind: "System", external: true }],
    });
    const result = diff(a, b);
    const change = result.changes.find((c) => c.entity === "element");
    expect(change?.fields).toContainEqual(
      expect.objectContaining({
        field: "external",
        before: false,
        after: true,
      }),
    );
    expect(change?.severity).toBe("semantic");
  });

  it("detects description / sprite / link / properties changes", () => {
    const a = makeModel({
      elements: [
        {
          name: "x",
          description: "old",
          sprite: "old_sprite",
          link: "old_link",
          properties: { k: "v1" },
        },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "x",
          description: "new",
          sprite: "new_sprite",
          link: "new_link",
          properties: { k: "v2" },
        },
      ],
    });
    const result = diff(a, b);
    const fields = result.changes[0].fields.map((f) => f.field);
    expect(fields).toEqual(
      expect.arrayContaining(["description", "sprite", "link", "properties"]),
    );
  });

  it("detects tag set delta with added/removed lists", () => {
    const a = makeModel({ elements: [{ name: "x", tags: ["a", "b"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["b", "c"] }] });
    const result = diff(a, b);
    const tagField = result.changes[0].fields.find((f) => f.field === "tags");
    expect(tagField?.added).toEqual(["c"]);
    expect(tagField?.removed).toEqual(["a"]);
  });

  it("treats properties with same keys but different values as changed", () => {
    const a = makeModel({
      elements: [{ name: "x", properties: { a: "1", b: "2" } }],
    });
    const b = makeModel({
      elements: [{ name: "x", properties: { a: "1", b: "9" } }],
    });
    const result = diff(a, b);
    const propField = result.changes[0].fields.find(
      (f) => f.field === "properties",
    );
    expect(propField).toBeDefined();
  });

  it("ignores properties when both undefined", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b);
    expect(result.changes).toHaveLength(0);
  });
});

describe("computeDiff — boundary edge cases", () => {
  it("detects boundary added/removed", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "b", elementNames: ["x"] }],
    });
    const result = diff(a, b);
    const added = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "added",
    );
    expect(added).toBeDefined();
  });

  it("detects boundary rename when label and children match", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx_old", label: "Context", elementNames: ["x"] }],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "Context", elementNames: ["x"] }],
    });
    const result = diff(a, b);
    const renamed = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "renamed",
    );
    expect(renamed).toBeDefined();
  });

  it("detects boundary fields changes: kind, description, link, tags", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [
        {
          name: "b",
          kind: "System",
          description: "old",
          link: "old_link",
          tags: ["a"],
          elementNames: ["x"],
        },
      ],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [
        {
          name: "b",
          kind: "Container",
          description: "new",
          link: "new_link",
          tags: ["b"],
          elementNames: ["x"],
        },
      ],
    });
    const result = diff(a, b);
    const change = result.changes.find((c) => c.entity === "boundary");
    const fieldNames = change?.fields.map((f) => f.field) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining(["kind", "description", "link", "tags"]),
    );
  });

  it("detects nested boundary additions via boundaryNames delta", () => {
    const a = makeModel({
      boundaries: [{ name: "parent" }, { name: "leaf" }],
    });
    const b = makeModel({
      boundaries: [
        { name: "parent", boundaryNames: ["leaf"] },
        { name: "leaf" },
      ],
    });
    const result = diff(a, b);
    const change = result.changes.find(
      (c) => c.entity === "boundary" && c.name === "parent",
    );
    const boundaryNamesField = change?.fields.find(
      (f) => f.field === "boundaryNames",
    );
    expect(boundaryNamesField?.added).toEqual(["leaf"]);
  });
});

describe("computeDiff — relation edge cases", () => {
  it("detects relation description/tags/order changes (same identity)", () => {
    const a = makeModel({
      elements: [
        {
          name: "a",
          relations: [
            {
              to: "b",
              technology: "HTTP",
              description: "old",
              tags: ["x"],
              order: 1,
            },
          ],
        },
        { name: "b" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "a",
          relations: [
            {
              to: "b",
              technology: "HTTP",
              description: "new",
              tags: ["y"],
              order: 2,
            },
          ],
        },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    const relChange = result.changes.find((c) => c.entity === "relation");
    const fieldNames = relChange?.fields.map((f) => f.field) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining(["description", "tags", "order"]),
    );
  });

  it("treats absent technology consistently (empty string and undefined match)", () => {
    const a = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
    });
    const b = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b", technology: "  " }] },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    // Pure whitespace technology matches absent technology — no diff.
    expect(result.changes).toHaveLength(0);
  });

  it("renames boundary respects threshold", () => {
    const a = makeModel({
      boundaries: [{ name: "very_different_name", label: "Foo" }],
    });
    const b = makeModel({
      boundaries: [{ name: "totally_other", label: "Bar" }],
    });
    const result = diff(a, b);
    // No rename — too different.
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
  });
});

describe("computeDiff — workspace edge cases", () => {
  it("detects workspace extendsTarget change", () => {
    const a: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", extendsTarget: "old.dsl" },
    };
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", extendsTarget: "new.dsl" },
    };
    const result = diff(a, b);
    const wsChange = result.changes.find((c) => c.entity === "workspace");
    expect(wsChange?.fields).toContainEqual(
      expect.objectContaining({ field: "workspace.extendsTarget" }),
    );
  });

  it("emits no workspace change when both undefined", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b);
    expect(result.changes.some((c) => c.entity === "workspace")).toBe(false);
  });

  it("detects workspace added (undefined → present)", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "new" },
    };
    const result = diff(a, b);
    expect(result.changes.some((c) => c.entity === "workspace")).toBe(true);
  });
});

describe("computeDiff — RFC 6902 patch shape", () => {
  it("emits replace ops for value changes", () => {
    const a = makeModel({ elements: [{ name: "x", label: "Old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "replace")).toBe(true);
  });

  it("emits add ops for new elements", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "add")).toBe(true);
  });

  it("emits remove ops for deleted elements", () => {
    const a = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "remove")).toBe(true);
  });
});

describe("computeDiff — summary edge cases", () => {
  it("falls back to `N change(s)` headline when no recognised category fires", () => {
    // Only cosmetic-modify changes that don't fit any of the
    // headline part patterns we count specifically.
    const a = makeModel({ elements: [{ name: "x", label: "Old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New" }] });
    const result = diff(a, b);
    expect(result.summary.headline).toContain("[cosmetic]");
  });
});
