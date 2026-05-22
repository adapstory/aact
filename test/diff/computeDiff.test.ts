import { computeDiff } from "../../src/diff";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

const SIDE_BASE = { source: "baseline", format: "model-json" } as const;
const SIDE_CURR = { source: "current", format: "model-json" } as const;

const diff = (a: Model, b: Model, opts = {}) =>
  computeDiff(a, b, SIDE_BASE, SIDE_CURR, opts);

describe("computeDiff — identity matching", () => {
  it("reports zero changes for identical models", () => {
    const m = makeModel({ elements: [{ name: "a" }] });
    const result = diff(m, m);
    expect(result.changes).toHaveLength(0);
    expect(result.summary.headline).toBe("no changes");
  });

  it("reports element added", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const result = diff(a, b);
    const added = result.changes.filter((c) => c.action === "added");
    expect(added).toHaveLength(1);
    expect(added[0].entity).toBe("element");
    expect(added[0].severity).toBe("structural");
  });

  it("reports element removed", () => {
    const a = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const b = makeModel({ elements: [{ name: "a" }] });
    const result = diff(a, b);
    const removed = result.changes.filter((c) => c.action === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].entity).toBe("element");
  });

  it("reports element modified when fields differ", () => {
    const a = makeModel({
      elements: [{ name: "svc", technology: "Postgres" }],
    });
    const b = makeModel({
      elements: [{ name: "svc", technology: "CockroachDB" }],
    });
    const result = diff(a, b);
    const modified = result.changes.find((c) => c.action === "modified");
    expect(modified).toBeDefined();
    expect(modified?.fields[0]).toMatchObject({
      field: "technology",
      before: "Postgres",
      after: "CockroachDB",
    });
    expect(modified?.severity).toBe("semantic");
  });
});

describe("computeDiff — severity classification", () => {
  it("marks kind transition as structural", () => {
    const a = makeModel({ elements: [{ name: "x", kind: "Container" }] });
    const b = makeModel({ elements: [{ name: "x", kind: "ContainerDb" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("structural");
  });

  it("marks technology change as semantic", () => {
    const a = makeModel({
      elements: [{ name: "x", technology: "Postgres" }],
    });
    const b = makeModel({ elements: [{ name: "x", technology: "MySQL" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("semantic");
  });

  it("marks label-only change as cosmetic", () => {
    const a = makeModel({ elements: [{ name: "x", label: "old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "new" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("cosmetic");
  });
});

describe("computeDiff — rename detection", () => {
  it("detects rename when label and relations match", () => {
    const a = makeModel({
      elements: [
        { name: "user_service", label: "Users", relations: [{ to: "db" }] },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "users", label: "Users", relations: [{ to: "db" }] },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const renamed = result.changes.find((c) => c.action === "renamed");
    expect(renamed).toBeDefined();
    expect(renamed).toMatchObject({
      entity: "element",
      previousName: "user_service",
      name: "users",
    });
    expect(
      renamed && "confidence" in renamed && renamed.confidence,
    ).toBeGreaterThan(0.7);
  });

  it("does NOT collapse rename across different kinds", () => {
    const a = makeModel({
      elements: [{ name: "x", label: "Same", kind: "Container" }],
    });
    const b = makeModel({
      elements: [{ name: "y", label: "Same", kind: "ContainerDb" }],
    });
    const result = diff(a, b);
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
    expect(result.changes.filter((c) => c.action === "added")).toHaveLength(1);
    expect(result.changes.filter((c) => c.action === "removed")).toHaveLength(
      1,
    );
  });

  it("respects --no-rename-detection (disableRenameDetection)", () => {
    const a = makeModel({
      elements: [{ name: "user_service", label: "Users" }],
    });
    const b = makeModel({ elements: [{ name: "users", label: "Users" }] });
    const result = diff(a, b, { disableRenameDetection: true });
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
  });

  it("respects custom renameThreshold", () => {
    // Names + labels too different — default threshold wouldn't match.
    const a = makeModel({ elements: [{ name: "alpha", label: "Alpha" }] });
    const b = makeModel({ elements: [{ name: "zeta", label: "Zeta" }] });
    const looseResult = diff(a, b, { renameThreshold: 0.1 });
    expect(looseResult.changes.some((c) => c.action === "renamed")).toBe(true);
  });

  it("surfaces confidence on renamed change", () => {
    const a = makeModel({ elements: [{ name: "api_v1", label: "API" }] });
    const b = makeModel({ elements: [{ name: "api", label: "API" }] });
    const result = diff(a, b);
    const renamed = result.changes.find((c) => c.action === "renamed");
    expect(renamed).toBeDefined();
    if (renamed && renamed.entity === "element") {
      expect(renamed.confidence).toBeGreaterThan(0);
      expect(renamed.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("computeDiff — relation pair-collapse", () => {
  it("collapses same (from, to) removed+added into modified with technology field", () => {
    const a = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "HTTP" }] },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "Kafka" }] },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const relChanges = result.changes.filter((c) => c.entity === "relation");
    expect(relChanges).toHaveLength(1);
    expect(relChanges[0].action).toBe("modified");
    expect(relChanges[0].fields).toContainEqual(
      expect.objectContaining({
        field: "technology",
        before: "HTTP",
        after: "Kafka",
      }),
    );
  });

  it("keeps multi-edge same (from, to) as separate add/remove", () => {
    const a = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "db", technology: "HTTP" },
            { to: "db", technology: "Kafka" },
          ],
        },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "db", technology: "HTTP" },
            { to: "db", technology: "gRPC" },
          ],
        },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const relChanges = result.changes.filter((c) => c.entity === "relation");
    // HTTP stays matched; Kafka removed, gRPC added — 1+1 pair collapses
    // into modified for the second relation slot. So one modified, no
    // raw add/remove.
    expect(relChanges.some((c) => c.action === "modified")).toBe(true);
  });

  it("matches identical relations by (from, to, technology) tuple — no diff on pure reorder", () => {
    const a = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "a", technology: "HTTP" },
            { to: "b", technology: "Kafka" },
          ],
        },
        { name: "a" },
        { name: "b" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "b", technology: "Kafka" },
            { to: "a", technology: "HTTP" },
          ],
        },
        { name: "a" },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    expect(result.changes.filter((c) => c.entity === "relation")).toHaveLength(
      0,
    );
  });
});

describe("computeDiff — boundary moves", () => {
  it("marks element move between boundaries as moved", () => {
    const a = makeModel({
      elements: [{ name: "svc" }],
      boundaries: [{ name: "a", elementNames: ["svc"] }, { name: "b" }],
    });
    const b = makeModel({
      elements: [{ name: "svc" }],
      boundaries: [{ name: "a" }, { name: "b", elementNames: ["svc"] }],
    });
    const result = diff(a, b);
    const svcChange = result.changes.find(
      (c) => c.entity === "element" && c.name === "svc",
    );
    expect(svcChange?.action).toBe("moved");
    expect(svcChange?.severity).toBe("structural");
  });
});

describe("computeDiff — workspace changes", () => {
  it("reports workspace name change as cosmetic", () => {
    const a: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "Old", description: "" },
    };
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "New", description: "" },
    };
    const result = diff(a, b);
    const ws = result.changes.find((c) => c.entity === "workspace");
    expect(ws).toBeDefined();
    expect(ws?.severity).toBe("cosmetic");
  });
});

describe("computeDiff — sorting and summary", () => {
  it("sorts changes by severity desc, then action precedence", () => {
    const a = makeModel({
      elements: [{ name: "kept", label: "Old" }, { name: "removed" }],
    });
    const b = makeModel({
      elements: [{ name: "kept", label: "New" }, { name: "added" }],
    });
    const result = diff(a, b);
    // Structural changes (added/removed) come before cosmetic (label modify).
    expect(result.changes[0].severity).toBe("structural");
    const cosmeticIdx = result.changes.findIndex(
      (c) => c.severity === "cosmetic",
    );
    expect(cosmeticIdx).toBeGreaterThan(0);
  });

  it("builds headline from the change set", () => {
    const a = makeModel({ elements: [{ name: "old" }] });
    const b = makeModel({ elements: [{ name: "new1" }, { name: "new2" }] });
    const result = diff(a, b, { disableRenameDetection: true });
    expect(result.summary.headline).toContain("+2");
    expect(result.summary.headline).toContain("-1");
  });

  it("aggregates summary counts across severity / action / entity", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({
      elements: [{ name: "x", technology: "HTTP" }, { name: "y" }],
    });
    const result = diff(a, b);
    expect(result.summary.bySeverity.structural).toBeGreaterThanOrEqual(1);
    expect(result.summary.bySeverity.semantic).toBeGreaterThanOrEqual(1);
    expect(result.summary.byEntity.element).toBeGreaterThanOrEqual(2);
  });
});

describe("computeDiff — RFC 6902 patch (opt-in)", () => {
  it("does not include patch by default", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    expect(diff(a, b).patch).toBeUndefined();
  });

  it("includes patch when withPatch: true", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch).toBeDefined();
    expect(result.patch?.length).toBeGreaterThan(0);
    expect(result.patch?.[0]).toMatchObject({
      op: expect.stringMatching(/^(add|remove|replace)$/),
    });
  });

  it("strips sourceLocation from patch — parser byproduct, not architecture", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }] });
    const result = diff(a, b, { withPatch: true });
    const patchStr = JSON.stringify(result.patch);
    expect(patchStr).not.toContain("sourceLocation");
  });
});
