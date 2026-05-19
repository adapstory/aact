import { loadConfig } from "c12";

import { loadAndValidateConfig } from "../../src/cli/loadConfig";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

const mockLoadConfig = vi.mocked(loadConfig);

describe("loadAndValidateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no config file found", async () => {
    mockLoadConfig.mockResolvedValue({
      config: undefined,
    } as unknown as ReturnType<typeof loadConfig> extends Promise<infer T>
      ? T
      : never);

    await expect(loadAndValidateConfig()).rejects.toThrow(
      "No aact config found",
    );
  });

  it("throws on invalid source.type", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "invalid", path: "test.puml" } },
    });

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws when source.path is missing", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "plantuml" } },
    });

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws on extra fields in strictObject", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        unknownField: true,
      },
    });

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws when acl rule contains removed aclSuffix field", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        rules: { acl: { aclSuffix: "_acl" } },
      },
    });

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("returns valid config", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "plantuml", path: "test.puml" } },
    });

    const result = await loadAndValidateConfig();
    expect(result.source.type).toBe("plantuml");
    expect(result.source.path).toBe("test.puml");
  });

  it("wraps c12 load failure as ToolError config.loadFailed", async () => {
    mockLoadConfig.mockRejectedValue(new Error("c12 said nope"));

    await expect(
      loadAndValidateConfig("./aact.config.ts"),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "config.loadFailed",
      context: { path: "./aact.config.ts" },
      message: expect.stringContaining("c12 said nope"),
    });
  });

  it("wraps non-Error c12 throw via String() coercion", async () => {
    mockLoadConfig.mockRejectedValue("plain string thrown");

    await expect(loadAndValidateConfig()).rejects.toMatchObject({
      kind: "config.loadFailed",
      message: expect.stringContaining("plain string thrown"),
    });
  });

  it("rejects explicit unknown source.type via registry guard (format.unknown)", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "mermaid", path: "x.mmd" } },
    });

    // The schema currently accepts arbitrary strings for source.type; the
    // registry guard at the end of loadAndValidateConfig catches anything
    // not in `knownFormatNames()` and surfaces it as `format.unknown`.
    await expect(loadAndValidateConfig()).rejects.toMatchObject({
      kind: "format.unknown",
    });
  });
});
