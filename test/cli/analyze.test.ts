import { loadConfig } from "c12";
import consola from "consola";

import { loadModel } from "../../src/cli/loadModel";
import { makeModel } from "../helpers/makeModel";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", () => ({
  loadModel: vi.fn(),
}));

vi.mock("consola", () => ({
  default: {
    info: vi.fn(),
    log: vi.fn(),
  },
}));

const mockLoadConfig = vi.mocked(loadConfig);
const mockLoadModel = vi.mocked(loadModel);

const testModel = () =>
  makeModel({
    containers: [
      { name: "orders_db", label: "DB", kind: "ContainerDb" },
      {
        name: "svc_a",
        label: "Service A",
        relations: [{ to: "orders_db", technology: "tcp" }],
      },
    ],
    boundaries: [
      {
        name: "project",
        label: "Project",
        containerNames: ["svc_a", "orders_db"],
      },
    ],
  });

const setupConfig = (): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
    },
  });
};

const runAnalyze = async (args: { format?: string } = {}): Promise<void> => {
  const mod = await import("../../src/cli/commands/analyze");
  const command = mod.analyze;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("analyze command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when config source is missing", async () => {
    mockLoadConfig.mockResolvedValue({ config: {} });
    await expect(runAnalyze()).rejects.toThrow();
  });

  it("outputs text metrics via consola", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: testModel(), issues: [] });

    await runAnalyze();

    const infoCalls = vi
      .mocked(consola.info)
      .mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((c) => c.includes("Elements:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Sync API calls:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Async API calls:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Databases:"))).toBe(true);
  });

  it("outputs json format", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: testModel(), issues: [] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runAnalyze({ format: "json" });

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveProperty("elementsCount");
    expect(output).toHaveProperty("syncApiCalls");
    expect(output).toHaveProperty("asyncApiCalls");
    expect(output).toHaveProperty("databases");
    expect(output).toHaveProperty("boundaries");
  });

  it("unknown format falls back to text output", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({ model: testModel(), issues: [] });

    await runAnalyze({ format: "unknown" });

    const infoCalls = vi
      .mocked(consola.info)
      .mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((c) => c.includes("Elements:"))).toBe(true);
  });

  it("logs coupling relations for boundaries", async () => {
    setupConfig();
    mockLoadModel.mockResolvedValue({
      model: makeModel({
        containers: [
          { name: "ext", label: "Ext", kind: "System", external: true },
          {
            name: "svc_coupling",
            label: "Coupled Service",
            relations: [{ to: "ext", technology: "http" }],
          },
        ],
        boundaries: [
          {
            name: "project",
            label: "Project",
            containerNames: ["svc_coupling"],
          },
        ],
      }),
      issues: [],
    });

    await runAnalyze();

    const logCalls = vi
      .mocked(consola.log)
      .mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((c) => c.includes("svc_coupling"))).toBe(true);
  });
});
