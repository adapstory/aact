import { readFile, writeFile } from "node:fs/promises";

import { loadConfig } from "c12";
import consola from "consola";

import { loadModel } from "../../src/cli/loadModel";
import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { loadFormat } from "../../src/formats/registry";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import type { Format } from "../../src/formats/types";
import type { Model } from "../../src/model";
import type { ContainerSpec } from "../helpers/makeModel";
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
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const fakeFormat = (
  name: string,
  fixSyntax = plantumlSyntax,
  load = vi.fn(),
): Format => ({
  name,
  load,
  fix: { syntax: fixSyntax },
});

const cleanModel = (): Model =>
  makeModel({
    containers: [
      { name: "svc_a", relations: [{ to: "svc_b", technology: "http" }] },
      { name: "svc_b" },
    ],
    boundaries: [{ name: "project", containerNames: ["svc_a", "svc_b"] }],
  });

const violatingContainers: ContainerSpec[] = [
  { name: "my_service", relations: [{ to: "ext_system" }] },
  { name: "ext_system", kind: "System", external: true },
];

const violatingModel = (): Model =>
  makeModel({
    containers: violatingContainers,
    boundaries: [
      {
        name: "project",
        containerNames: ["my_service", "ext_system"],
      },
    ],
  });

const cyclicModel = (): Model =>
  makeModel({
    containers: [
      { name: "svc_a", relations: [{ to: "svc_b" }] },
      { name: "svc_b", relations: [{ to: "svc_a" }] },
    ],
    boundaries: [{ name: "project", containerNames: ["svc_a", "svc_b"] }],
  });

const setupConfig = (overrides?: {
  rules?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
      ...overrides,
    },
  });
};

const runCheck = async (args: Record<string, unknown> = {}): Promise<void> => {
  const mod = await import("../../src/cli/commands/check");
  const command = mod.check;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("check command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat("plantuml"));
  });

  it("throws when config source is missing", async () => {
    mockLoadConfig.mockResolvedValue({ config: {} });
    await expect(runCheck()).rejects.toThrow();
  });

  it("passes when no violations found", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCheck({ format: "text" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("exits with error code when violations found", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never));

    await runCheck();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("outputs json format", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveProperty("results");
    expect(Array.isArray(output.results)).toBe(true);
  });

  it("outputs github format annotations", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never));

    await runCheck({ format: "github" });

    const calls = spy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.startsWith("::error"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("respects rules config disabling acl", async () => {
    setupConfig({ rules: { acl: false } });
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });

    await expect(runCheck()).resolves.toBeUndefined();
  });

  describe("--fix", () => {
    it("reports no violations to fix when model is clean", async () => {
      setupConfig();
      mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("No violations to fix"),
      );
    });

    it("shows edits without writing in dry-run mode", async () => {
      setupConfig();
      mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runCheck({ fix: true, "dry-run": true });

      expect(spy).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("applies edits and writes source file", async () => {
      setupConfig();
      // First call returns violating, second call (re-check) returns clean
      mockLoadModel
        .mockResolvedValueOnce({ model: violatingModel(), issues: [] })
        .mockResolvedValueOnce({ model: cleanModel(), issues: [] });

      const pumlSource = [
        'Container(my_service, "My Service")',
        'System_Ext(ext_system, "External System")',
        'Rel(my_service, ext_system, "")',
      ].join("\n");

      mockReadFile.mockResolvedValue(pumlSource);
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const written = mockWriteFile.mock.calls[0][1] as string;
      expect(written).toContain("my_service_acl");
    });

    it("shows summary after applying fixes", async () => {
      setupConfig();
      mockLoadModel
        .mockResolvedValueOnce({ model: violatingModel(), issues: [] })
        .mockResolvedValueOnce({ model: cleanModel(), issues: [] });

      mockReadFile.mockResolvedValue(
        [
          'Container(my_service, "My Service")',
          'System_Ext(ext_system, "External System")',
          'Rel(my_service, ext_system, "")',
        ].join("\n"),
      );
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("Applied"),
      );
      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("fix(es)"),
      );
    });

    it("reports remaining violations count after fix", async () => {
      setupConfig();
      mockLoadModel
        .mockResolvedValueOnce({ model: violatingModel(), issues: [] })
        .mockResolvedValueOnce({ model: violatingModel(), issues: [] });

      mockReadFile.mockResolvedValue(
        [
          'Container(my_service, "My Service")',
          'System_Ext(ext_system, "External System")',
          'Rel(my_service, ext_system, "")',
        ].join("\n"),
      );
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("violation(s) remain"),
      );
    });

    it("exits with error when violations have no auto-fix available", async () => {
      setupConfig({ rules: { acl: false } });
      mockLoadModel.mockResolvedValue({ model: cyclicModel(), issues: [] });
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined as never));

      await runCheck({ fix: true });
      expect(consola.info).toHaveBeenCalledWith(
        expect.stringContaining("No auto-fixes available"),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    describe("structurizr source", () => {
      it("warns and exits when writePath not configured", async () => {
        setupConfig({
          source: { type: "structurizr", path: "workspace.json" },
        });
        mockLoadFormat.mockResolvedValue(
          fakeFormat("structurizr", structurizrDslSyntax),
        );
        mockLoadModel.mockResolvedValue({
          model: violatingModel(),
          issues: [],
        });
        const exitSpy = vi
          .spyOn(process, "exit")
          .mockImplementation(
            (() => undefined as never),
          );

        await runCheck({ fix: true });

        expect(consola.warn).toHaveBeenCalledWith(
          expect.stringContaining("writePath"),
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockRestore();
      });

      it("writes to writePath and warns to regenerate", async () => {
        setupConfig({
          source: {
            type: "structurizr",
            path: "workspace.json",
            writePath: "workspace.dsl",
          },
        });
        mockLoadFormat.mockResolvedValue(
          fakeFormat("structurizr", structurizrDslSyntax),
        );
        mockLoadModel.mockResolvedValue({
          model: violatingModel(),
          issues: [],
        });

        const dslSource = [
          'my_service = container "My Service"',
          'ext_system = softwareSystem "External System"',
          'my_service -> ext_system ""',
        ].join("\n");

        mockReadFile.mockResolvedValue(dslSource);
        mockWriteFile.mockResolvedValue();

        await runCheck({ fix: true });

        const writtenPath = mockWriteFile.mock.calls[0][0] as string;
        expect(writtenPath).toContain("workspace.dsl");
        expect(consola.warn).toHaveBeenCalledWith(
          expect.stringContaining("regenerate"),
        );
      });
    });
  });
});
