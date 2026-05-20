import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { modelJsonFormat } from "../../../src/formats/model-json";
import { canGenerate, canLoad } from "../../../src/formats/types";
import { makeModel } from "../../helpers/makeModel";

const writeTmp = (content: string, ext = ".aact.json"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "aact-model-json-"));
  const file = path.join(dir, `arch${ext}`);
  writeFileSync(file, content, "utf8");
  return file;
};

const cleanupParent = (file: string): void => {
  try {
    rmSync(path.dirname(file), { recursive: true, force: true });
  } catch {
    // benign
  }
};

describe("modelJsonFormat — Format capabilities", () => {
  it("exposes load + generate, but NOT fix", () => {
    expect(canLoad(modelJsonFormat)).toBe(true);
    expect(canGenerate(modelJsonFormat)).toBe(true);
    expect(modelJsonFormat.fix).toBeUndefined();
  });

  it("has the canonical defaultPattern `*.aact.json`", () => {
    expect(modelJsonFormat.defaultPattern).toBe("*.aact.json");
  });
});

describe("modelJsonFormat.load — canonical { schemaVersion, model } shape", () => {
  it("loads a minimal canonical document", async () => {
    const payload = {
      schemaVersion: 1,
      model: {
        elements: {
          svc: {
            name: "svc",
            label: "svc",
            kind: "Container",
            external: false,
            description: "",
            tags: [],
            relations: [],
          },
        },
        boundaries: {},
        rootBoundaryNames: [],
      },
    };
    const file = writeTmp(JSON.stringify(payload));
    try {
      const result = await modelJsonFormat.load!(file);
      expect(result.model.elements.svc.name).toBe("svc");
      expect(result.issues).toEqual([]);
    } finally {
      cleanupParent(file);
    }
  });

  it("rejects unknown schemaVersion", async () => {
    const file = writeTmp(
      JSON.stringify({
        schemaVersion: 99,
        model: { elements: {}, boundaries: {}, rootBoundaryNames: [] },
      }),
    );
    try {
      await expect(modelJsonFormat.load!(file)).rejects.toThrow(
        /unsupported schemaVersion/,
      );
    } finally {
      cleanupParent(file);
    }
  });

  it("rejects canonical when `model` is missing structural keys", async () => {
    const file = writeTmp(JSON.stringify({ schemaVersion: 1, model: {} }));
    try {
      await expect(modelJsonFormat.load!(file)).rejects.toThrow(
        /requires "model" with/,
      );
    } finally {
      cleanupParent(file);
    }
  });
});

describe("modelJsonFormat.load — CliEnvelope<ModelData> compat shape", () => {
  it("accepts `aact model --json` envelope output", async () => {
    const envelope = {
      schemaVersion: 1,
      command: "model",
      ok: true,
      exitCode: 0,
      data: {
        model: {
          elements: {
            svc: {
              name: "svc",
              label: "svc",
              kind: "Container",
              external: false,
              description: "",
              tags: [],
              relations: [],
            },
          },
          boundaries: {},
          rootBoundaryNames: [],
        },
        issues: [],
      },
      diagnostics: [],
      meta: {
        aactVersion: "3.0.0-test",
        durationMs: 1,
        configPath: null,
        source: null,
      },
    };
    const file = writeTmp(JSON.stringify(envelope));
    try {
      const result = await modelJsonFormat.load!(file);
      expect(result.model.elements.svc.name).toBe("svc");
    } finally {
      cleanupParent(file);
    }
  });
});

describe("modelJsonFormat.load — raw Model compat shape", () => {
  it("accepts raw Model JSON (hand-authored)", async () => {
    const raw = {
      elements: {
        svc: {
          name: "svc",
          label: "svc",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      },
      boundaries: {},
      rootBoundaryNames: [],
    };
    const file = writeTmp(JSON.stringify(raw));
    try {
      const result = await modelJsonFormat.load!(file);
      expect(result.model.elements.svc.name).toBe("svc");
    } finally {
      cleanupParent(file);
    }
  });
});

describe("modelJsonFormat.load — error paths", () => {
  it("throws SyntaxError for malformed JSON", async () => {
    const file = writeTmp("not json {");
    try {
      await expect(modelJsonFormat.load!(file)).rejects.toThrow(/invalid JSON/);
    } finally {
      cleanupParent(file);
    }
  });

  it("throws when top-level is not an object", async () => {
    const file = writeTmp(JSON.stringify(["array", "not", "model"]));
    try {
      await expect(modelJsonFormat.load!(file)).rejects.toThrow(
        /top-level JSON must be an object/,
      );
    } finally {
      cleanupParent(file);
    }
  });

  it("throws when JSON shape matches none of canonical/envelope/raw", async () => {
    const file = writeTmp(JSON.stringify({ foo: "bar" }));
    try {
      await expect(modelJsonFormat.load!(file)).rejects.toThrow(
        /not a recognised model-json shape/,
      );
    } finally {
      cleanupParent(file);
    }
  });

  it("surfaces ModelIssues for dangling refs via buildModel + validateModel", async () => {
    const payload = {
      schemaVersion: 1,
      model: {
        elements: {
          svc: {
            name: "svc",
            label: "svc",
            kind: "Container",
            external: false,
            description: "",
            tags: [],
            relations: [{ to: "ghost", tags: [] }],
          },
        },
        boundaries: {},
        rootBoundaryNames: [],
      },
    };
    const file = writeTmp(JSON.stringify(payload));
    try {
      const result = await modelJsonFormat.load!(file);
      expect(result.issues.some((i) => i.kind === "dangling-relation")).toBe(
        true,
      );
    } finally {
      cleanupParent(file);
    }
  });
});

describe("modelJsonFormat.generate — canonical output", () => {
  it("emits canonical shape with schemaVersion: 1", () => {
    const model = makeModel({ elements: [{ name: "svc" }] });
    const [file] = modelJsonFormat.generate!(model).files;
    const parsed = JSON.parse(file.content);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.model.elements.svc.name).toBe("svc");
  });

  it("sorts element / boundary keys alphabetically in the output text", () => {
    // Build a Model manually so synthetic sourceLocations (which
    // makeModel attaches based on declaration order) don't make
    // byte equality fragile. We only assert key order in output —
    // that's what `aact diff` actually compares.
    const m1 = makeModel({
      elements: [{ name: "z" }, { name: "a" }, { name: "m" }],
    });
    const out = modelJsonFormat.generate!(m1).files[0].content;
    // Keys appear in alphabetical order in the output text:
    expect(out).toMatch(/"a"[\s\S]+"m"[\s\S]+"z"/);
  });

  it("defaults output path to architecture.aact.json", () => {
    const model = makeModel({ elements: [{ name: "svc" }] });
    const [file] = modelJsonFormat.generate!(model).files;
    expect(file.path).toBe("architecture.aact.json");
  });

  it("omits workspace key when model has no workspace metadata", () => {
    const model = makeModel({ elements: [{ name: "svc" }] });
    const [file] = modelJsonFormat.generate!(model).files;
    const parsed = JSON.parse(file.content);
    expect(parsed.model.workspace).toBeUndefined();
  });
});

describe("modelJsonFormat — round-trip generate → load yields equivalent Model", () => {
  it("preserves elements / boundaries / relations through serialise + parse", async () => {
    const original = makeModel({
      elements: [
        { name: "svc_a", relations: [{ to: "svc_b", technology: "HTTP" }] },
        { name: "svc_b" },
      ],
      boundaries: [
        { name: "ctx", elementNames: ["svc_a", "svc_b"], kind: "System" },
      ],
    });
    const [file] = modelJsonFormat.generate!(original).files;
    const tmp = writeTmp(file.content);
    try {
      const result = await modelJsonFormat.load!(tmp);
      expect(Object.keys(result.model.elements).sort()).toEqual([
        "svc_a",
        "svc_b",
      ]);
      expect(result.model.elements.svc_a.relations[0]).toMatchObject({
        to: "svc_b",
        technology: "HTTP",
      });
      expect(result.model.boundaries.ctx.elementNames.toSorted()).toEqual([
        "svc_a",
        "svc_b",
      ]);
    } finally {
      cleanupParent(tmp);
    }
  });
});
