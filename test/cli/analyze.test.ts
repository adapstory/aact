import { PassThrough } from "node:stream";

import {
  executeAnalyze,
  renderAnalyzeText,
} from "../../src/cli/commands/analyze";
import { loadModel } from "../../src/cli/loadModel";
import { buildEnvelope } from "../../src/cli/output";
import type { AactConfig } from "../../src/config";
import { makeModel } from "../helpers/makeModel";

vi.mock("../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/cli/loadModel")
  >("../../src/cli/loadModel");
  return {
    ...actual,
    loadModel: vi.fn(),
  };
});

const mockLoadModel = vi.mocked(loadModel);

const config: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

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

const captureSink = (): {
  sink: NodeJS.WritableStream;
  output: () => string;
} => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return {
    sink: stream,
    output: () => Buffer.concat(chunks).toString("utf8"),
  };
};

describe("executeAnalyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AnalysisReport as data with exitCode 0", async () => {
    mockLoadModel.mockResolvedValue({ model: testModel(), issues: [] });

    const result = await executeAnalyze(config);

    expect(result.exitCode).toBe(0);
    expect(result.data).toHaveProperty("elementsCount");
    expect(result.data).toHaveProperty("syncApiCalls");
    expect(result.data).toHaveProperty("asyncApiCalls");
    expect(result.data).toHaveProperty("databases");
    expect(result.data).toHaveProperty("boundaries");
  });

  it("maps loader issues to diagnostics with stable kinds", async () => {
    mockLoadModel.mockResolvedValue({
      model: testModel(),
      issues: [
        { kind: "duplicate-container-name", name: "orders_db" },
        { kind: "self-relation", container: "svc_a" },
      ],
    });

    const result = await executeAnalyze(config);

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics?.[0]).toMatchObject({
      kind: "model.duplicateContainerName",
      severity: "warning",
    });
    expect(result.diagnostics?.[1]).toMatchObject({
      kind: "model.selfRelation",
      severity: "warning",
    });
  });

  it("propagates ToolError from loadModel (source missing) unchanged", async () => {
    const { ToolError } = await import("../../src/cli/output");
    mockLoadModel.mockRejectedValue(
      new ToolError("model.sourceNotFound", "missing", { path: "x.puml" }),
    );

    await expect(executeAnalyze(config)).rejects.toMatchObject({
      kind: "model.sourceNotFound",
    });
  });
});

describe("renderAnalyzeText", () => {
  const sampleEnvelope = () =>
    buildEnvelope({
      command: "analyze",
      exitCode: 0,
      data: {
        elementsCount: 2,
        syncApiCalls: 0,
        asyncApiCalls: 0,
        databases: { count: 1, consumes: 1 },
        boundaries: [
          {
            name: "project",
            label: "Project",
            cohesion: 0.5,
            coupling: 0.2,
            couplingRelations: [{ from: "svc_a", to: "external_x" }],
          },
        ],
      },
      meta: {
        durationMs: 5,
        configPath: null,
        source: "test.puml",
      },
    });

  it("writes metrics and boundary breakdown to the sink", () => {
    const { sink, output } = captureSink();

    renderAnalyzeText(sampleEnvelope(), sink);

    const text = output();
    expect(text).toContain("Elements: 2");
    expect(text).toContain("Sync API calls: 0");
    expect(text).toContain("Async API calls: 0");
    expect(text).toContain("Databases: 1");
    expect(text).toContain('Boundary "Project"');
    expect(text).toContain("cohesion=0.5");
    expect(text).toContain("coupling=0.2");
    expect(text).toContain("svc_a → external_x");
  });
});
