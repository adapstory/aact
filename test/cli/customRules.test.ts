import { loadConfig } from "c12";
import consola from "consola";

import { loadAndValidateConfig } from "../../src/cli/loadConfig";
import { loadModel } from "../../src/cli/loadModel";
import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { loadFormat } from "../../src/formats/registry";
import type { Format } from "../../src/formats/types";
import type { Model } from "../../src/model";
import type {RuleDefinition} from "../../src/rules/types";
import { defineRule  } from "../../src/rules/types";
import { makeModel } from "../helpers/makeModel";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", () => ({
  loadModel: vi.fn(),
}));

vi.mock("../../src/formats/registry", () => ({
  loadFormat: vi.fn(),
  knownFormatNames: () => ["plantuml", "structurizr", "kubernetes"],
}));

vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockLoadConfig = vi.mocked(loadConfig);
const mockLoadModel = vi.mocked(loadModel);
const mockLoadFormat = vi.mocked(loadFormat);

const fakeFormat = (name = "plantuml"): Format => ({
  name,
  load: vi.fn(),
  fix: { syntax: plantumlSyntax },
});

const cleanModel = (): Model =>
  makeModel({
    containers: [{ name: "svc_a" }, { name: "svc_b" }],
    boundaries: [{ name: "project", containerNames: ["svc_a", "svc_b"] }],
  });

const taggedModel = (): Model =>
  makeModel({
    containers: [{ name: "svc_a", tags: ["legacy"] }, { name: "svc_b" }],
    boundaries: [{ name: "project", containerNames: ["svc_a", "svc_b"] }],
  });

interface LegacyTagOptions {
  readonly tag?: string;
}

// Custom rule: container с тэгом "legacy" не разрешён
const noLegacyRule = defineRule({
  name: "noLegacy",
  description: "Containers must not carry legacy tag",
  check(model: Model, options?: LegacyTagOptions) {
    const tag = options?.tag ?? "legacy";
    return Object.values(model.containers)
      .filter((c) => c.tags.includes(tag))
      .map((c) => ({ container: c.name, message: `tagged "${tag}"` }));
  },
});

// Custom rule с fix capability
const noLegacyWithFixRule = defineRule({
  name: "noLegacyFix",
  description: "Containers must not carry legacy tag (with fix)",
  check(model: Model, options?: LegacyTagOptions) {
    const tag = options?.tag ?? "legacy";
    return Object.values(model.containers)
      .filter((c) => c.tags.includes(tag))
      .map((c) => ({ container: c.name, message: `tagged "${tag}"` }));
  },
  fix(_model: Model, violations) {
    return violations.map((v) => ({
      rule: "noLegacyFix",
      description: `Remove legacy tag from ${v.container}`,
      edits: [],
    }));
  },
});

const setupConfig = (config: Record<string, unknown>): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
      ...config,
    },
  });
};

const runCheck = async (args: Record<string, unknown> = {}): Promise<void> => {
  const mod = await import("../../src/cli/commands/check");
  await (
    mod.check as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("defineRule", () => {
  it("returns the same rule object (identity)", () => {
    const rule: RuleDefinition = {
      name: "x",
      description: "y",
      check: () => [],
    };
    expect(defineRule(rule)).toBe(rule);
  });
});

describe("loadAndValidateConfig — customRules shape validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid customRules array", async () => {
    setupConfig({ customRules: [noLegacyRule] });
    const result = await loadAndValidateConfig();
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules?.[0]?.name).toBe("noLegacy");
  });

  it("throws when customRules entry missing name", async () => {
    setupConfig({
      customRules: [{ description: "d", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/missing "name"/);
  });

  it("throws when customRules entry has empty name", async () => {
    setupConfig({
      customRules: [{ name: "", description: "d", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/missing "name"/);
  });

  it("throws when customRules entry missing description", async () => {
    setupConfig({
      customRules: [{ name: "x", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/description/);
  });

  it("throws when customRules entry missing check", async () => {
    setupConfig({
      customRules: [{ name: "x", description: "d" }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/check/);
  });

  it("throws when customRules entry has non-function fix", async () => {
    setupConfig({
      customRules: [
        { name: "x", description: "d", check: () => [], fix: "not a fn" },
      ],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/fix/);
  });

  it("throws when customRules entry is not an object", async () => {
    setupConfig({ customRules: ["string-not-object"] });
    await expect(loadAndValidateConfig()).rejects.toThrow(/RuleDefinition/);
  });

  it("accepts looseObject extra keys in rules (for custom rule names)", async () => {
    setupConfig({
      customRules: [noLegacyRule],
      rules: { noLegacy: { tag: "legacy" } },
    });
    const result = await loadAndValidateConfig();
    expect(result.rules).toBeDefined();
  });
});

describe("check command — customRules integration", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat());
    // Built-in rules могут fire'нуть на test models и вызвать process.exit —
    // mock'аем чтобы не падать в тестах, которые проверяют другую ortho.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("runs custom rule and reports violations", async () => {
    setupConfig({ customRules: [noLegacyRule] });
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    const noLegacy = output.results.find(
      (r: { rule: string }) => r.rule === "noLegacy",
    );
    expect(noLegacy).toBeDefined();
    expect(noLegacy.passed).toBe(false);
    expect(noLegacy.violations).toHaveLength(1);
    expect(noLegacy.violations[0].container).toBe("svc_a");
  });

  it("auto-enables customRules without rules.<name> entry", async () => {
    setupConfig({ customRules: [noLegacyRule] });
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.results.map((r: { rule: string }) => r.rule)).toContain(
      "noLegacy",
    );
  });

  it("disables custom rule via rules.<name>: false", async () => {
    setupConfig({
      customRules: [noLegacyRule],
      rules: { noLegacy: false, acl: false, acyclic: false },
    });
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.results.map((r: { rule: string }) => r.rule)).not.toContain(
      "noLegacy",
    );
  });

  it("passes options from rules.<name> to custom rule check", async () => {
    const captured: { tag?: string }[] = [];
    const captureRule = defineRule({
      name: "captureTag",
      description: "captures options",
      check(_model: Model, options?: { tag?: string }) {
        captured.push(options ?? {});
        return [];
      },
    });

    setupConfig({
      customRules: [captureRule],
      rules: { captureTag: { tag: "deprecated" } },
    });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(captured[0]?.tag).toBe("deprecated");
  });

  it("throws when custom rule name collides with built-in", async () => {
    const collide = defineRule({
      name: "acl",
      description: "collides",
      check: () => [],
    });
    setupConfig({ customRules: [collide] });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    await expect(runCheck()).rejects.toThrow(
      /conflicts with existing built-in/,
    );
  });

  it("throws when two customRules share name", async () => {
    const a = defineRule({ name: "dup", description: "a", check: () => [] });
    const b = defineRule({ name: "dup", description: "b", check: () => [] });
    setupConfig({ customRules: [a, b] });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    await expect(runCheck()).rejects.toThrow(/conflicts with existing custom/);
  });

  it("warns on unknown rule name in rules but does not crash", async () => {
    setupConfig({ rules: { typoRule: true } });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown rule "typoRule"'),
    );
  });

  it("does not warn for unknown rules when entry IS a customRule", async () => {
    setupConfig({
      customRules: [noLegacyRule],
      rules: { noLegacy: { tag: "legacy" } },
    });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(consola.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown rule "noLegacy"'),
    );
  });

  it("collects fixes from custom rule with fix capability", async () => {
    setupConfig({ customRules: [noLegacyWithFixRule] });
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ fix: true, "dry-run": true });

    const allOutput = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("noLegacyFix");
  });
});
