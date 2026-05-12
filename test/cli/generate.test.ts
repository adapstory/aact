import fs from "node:fs/promises";

import { loadConfig } from "c12";
import consola from "consola";
import type { MockedFunction } from "vitest";

import { loadModel } from "../../src/cli/loadModel";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", () => ({
  loadModel: vi.fn(),
}));

vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir) as unknown as MockedFunction<
  () => Promise<void>
>;
const mockLoadModel = vi.mocked(loadModel);

const setupConfig = (overrides?: {
  generate?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: overrides?.source ?? { type: "plantuml", path: "test.puml" },
      generate: overrides?.generate,
    },
  });
};

const setupModel = (model: Model): void => {
  mockLoadModel.mockResolvedValue({ model, issues: [] });
};

const runGenerate = async (
  args: { output?: string; format?: string } = {},
): Promise<void> => {
  const mod = await import("../../src/cli/commands/generate");
  const command = mod.generate;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("generate command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("plantuml format (default)", () => {
    it("outputs plantuml to stdout by default", async () => {
      setupConfig();
      setupModel(makeModel({ containers: [{ name: "orders" }] }));
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      expect(spy).toHaveBeenCalledOnce();
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("@startuml");
      expect(output).toContain("@enduml");
      expect(output).toContain("Container(orders");
    });

    it("outputs plantuml when --format plantuml", async () => {
      setupConfig();
      setupModel(makeModel({ containers: [{ name: "svc" }] }));
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate({ format: "plantuml" });

      expect(spy).toHaveBeenCalledOnce();
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("@startuml");
    });

    it("writes to file when --output is provided", async () => {
      setupConfig();
      setupModel(makeModel({ containers: [{ name: "svc" }] }));
      mockWriteFile.mockResolvedValue();

      await runGenerate({ output: "out.puml" });

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const [filePath, content] = mockWriteFile.mock.calls[0];
      expect(filePath).toBe("out.puml");
      expect(content as string).toContain("@startuml");
      expect(consola.success).toHaveBeenCalled();
    });

    it("renders relations in output", async () => {
      setupConfig();
      setupModel(
        makeModel({
          containers: [
            {
              name: "orders",
              relations: [{ to: "payments", technology: "REST" }],
            },
            { name: "payments" },
          ],
        }),
      );
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("Rel(orders, payments");
    });

    it("loads model via loadModel", async () => {
      setupConfig();
      setupModel(makeModel({ containers: [{ name: "svc" }] }));
      vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      expect(mockLoadModel).toHaveBeenCalledOnce();
    });
  });

  describe("kubernetes format", () => {
    it("generates kubernetes YAML files to output dir", async () => {
      setupConfig();
      setupModel(
        makeModel({
          containers: [
            { name: "orders", relations: [{ to: "payments" }] },
            { name: "payments" },
          ],
        }),
      );
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes", output: "./k8s" });

      expect(mockMkdir).toHaveBeenCalledWith("./k8s", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("2 file(s)"),
      );
    });

    it("uses config kubernetes path as default output dir", async () => {
      setupConfig({ generate: { kubernetes: { path: "custom/k8s" } } });
      setupModel(
        makeModel({
          containers: [{ name: "a" }, { name: "b" }],
        }),
      );
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes" });

      expect(mockMkdir).toHaveBeenCalledWith("custom/k8s", { recursive: true });
    });

    it("uses default path when no config and no --output", async () => {
      setupConfig();
      setupModel(
        makeModel({
          containers: [{ name: "a" }, { name: "b" }],
        }),
      );
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes" });

      expect(mockMkdir).toHaveBeenCalledWith(
        "fixtures/kubernetes/microservices",
        { recursive: true },
      );
    });

    it("throws when no source configured", async () => {
      mockLoadConfig.mockResolvedValue({ config: {} });
      await expect(runGenerate({ format: "kubernetes" })).rejects.toThrow();
    });

    it("throws for unknown format", async () => {
      setupConfig();
      setupModel(makeModel({}));
      await expect(runGenerate({ format: "unknown" })).rejects.toThrow(
        /Unknown format/,
      );
    });

    it("warns when model has no deployable containers", async () => {
      setupConfig();
      setupModel(
        makeModel({
          containers: [{ name: "orders_db", kind: "ContainerDb" }],
        }),
      );
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes", output: "./k8s" });

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("no files"),
      );
    });
  });
});
