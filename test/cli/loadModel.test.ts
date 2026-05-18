import { loadModel } from "../../src/cli/loadModel";
import { ToolError } from "../../src/cli/output";
import type { AactConfig } from "../../src/config";
import { loadFormat } from "../../src/formats/registry";
import type { Format } from "../../src/formats/types";
import { makeModel } from "../helpers/makeModel";

vi.mock("../../src/formats/registry", () => ({
  loadFormat: vi.fn(),
  knownFormatNames: () => ["plantuml", "structurizr", "kubernetes"],
}));

const mockLoadFormat = vi.mocked(loadFormat);

const plantumlConfig: AactConfig = {
  source: { type: "plantuml", path: "./architecture.puml" },
};

const structurizrConfig: AactConfig = {
  source: { type: "structurizr", path: "./workspace.json" },
};

const fakeFormat = (load: Format["load"]): Format => ({
  name: "fake",
  load,
});

const enoent = (): NodeJS.ErrnoException => {
  const err: NodeJS.ErrnoException = new Error("ENOENT: no such file");
  err.code = "ENOENT";
  return err;
};

describe("loadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to format.load when format supports load capability", async () => {
    const empty = makeModel({});
    const load = vi.fn().mockResolvedValue({ model: empty, issues: [] });
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    const result = await loadModel(plantumlConfig);

    expect(mockLoadFormat).toHaveBeenCalledWith("plantuml");
    expect(load).toHaveBeenCalledOnce();
    expect(result.model).toBe(empty);
  });

  it("throws ToolError model.unsupportedLoad when format doesn't expose `load`", async () => {
    mockLoadFormat.mockResolvedValue({ name: "kubernetes" });

    await expect(loadModel(plantumlConfig)).rejects.toMatchObject({
      name: "ToolError",
      kind: "model.unsupportedLoad",
    });
  });

  it("throws ToolError model.sourceNotFound when source file is missing (plantuml)", async () => {
    const load = vi.fn().mockRejectedValue(enoent());
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    await expect(loadModel(plantumlConfig)).rejects.toMatchObject({
      name: "ToolError",
      kind: "model.sourceNotFound",
      message: expect.stringContaining("./architecture.puml"),
    });
  });

  it("throws ToolError model.sourceNotFound when source file is missing (structurizr)", async () => {
    const load = vi.fn().mockRejectedValue(enoent());
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    await expect(loadModel(structurizrConfig)).rejects.toMatchObject({
      name: "ToolError",
      kind: "model.sourceNotFound",
    });
  });

  it("throws ToolError model.parseError on invalid JSON for structurizr", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new SyntaxError("Unexpected token } in JSON"));
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    await expect(loadModel(structurizrConfig)).rejects.toMatchObject({
      name: "ToolError",
      kind: "model.parseError",
      message: expect.stringContaining("Cannot parse Structurizr"),
    });
  });

  it("throws ToolError model.parseError on missing model.softwareSystems for structurizr", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(
        new TypeError(
          "Cannot read properties of undefined (reading 'softwareSystems')",
        ),
      );
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    await expect(loadModel(structurizrConfig)).rejects.toMatchObject({
      name: "ToolError",
      kind: "model.parseError",
      message: expect.stringContaining("Invalid Structurizr workspace"),
    });
  });

  it("re-throws unexpected errors instead of wrapping them in ToolError", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new Error("boom — totally unexpected"));
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    const error = await loadModel(plantumlConfig).catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom — totally unexpected");
    expect(error).not.toBeInstanceOf(ToolError);
  });
});
