import consola from "consola";

import { loadModel } from "../../src/cli/loadModel";
import type { AactConfig } from "../../src/config";
import { loadFormat } from "../../src/formats/registry";
import type { Format } from "../../src/formats/types";
import { makeModel } from "../helpers/makeModel";

vi.mock("consola", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

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

  it("exits with error when format doesn't expose `load`", async () => {
    // generate-only format (e.g. kubernetes) — loadModel must bail clearly.
    mockLoadFormat.mockResolvedValue({ name: "kubernetes" });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await loadModel(plantumlConfig);

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("doesn't support load"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("emits friendly error and exits when source file is missing (plantuml)", async () => {
    const load = vi.fn().mockRejectedValue(enoent());
    mockLoadFormat.mockResolvedValue(fakeFormat(load));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await loadModel(plantumlConfig);

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Architecture file not found"),
    );
    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("./architecture.puml"),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("aact.config.ts"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("emits friendly error and exits when source file is missing (structurizr)", async () => {
    const load = vi.fn().mockRejectedValue(enoent());
    mockLoadFormat.mockResolvedValue(fakeFormat(load));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await loadModel(structurizrConfig);

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Architecture file not found"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("emits friendly error on invalid JSON for structurizr", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new SyntaxError("Unexpected token } in JSON"));
    mockLoadFormat.mockResolvedValue(fakeFormat(load));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await loadModel(structurizrConfig);

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot parse Structurizr workspace"),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("valid JSON"),
    );
    exitSpy.mockRestore();
  });

  it("emits friendly error on missing model.softwareSystems for structurizr", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(
        new TypeError(
          "Cannot read properties of undefined (reading 'softwareSystems')",
        ),
      );
    mockLoadFormat.mockResolvedValue(fakeFormat(load));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await loadModel(structurizrConfig);

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Structurizr workspace"),
    );
    exitSpy.mockRestore();
  });

  it("re-throws unexpected errors instead of swallowing them", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new Error("boom — totally unexpected"));
    mockLoadFormat.mockResolvedValue(fakeFormat(load));

    await expect(loadModel(plantumlConfig)).rejects.toThrow(
      "boom — totally unexpected",
    );
    expect(consola.error).not.toHaveBeenCalled();
  });
});
