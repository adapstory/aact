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

    const { config } = await loadAndValidateConfig();
    expect(config.source.type).toBe("plantuml");
    expect(config.source.path).toBe("test.puml");
  });

  it("accepts empty-object form for option-less rules (symmetry with option-bearing)", async () => {
    // After the AcyclicOptions/CohesionOptions/etc. additions, the
    // four rules that have no options today still accept `rules:
    // { acyclic: {} }` so the user can be explicit without
    // resorting to `true`. The strict-empty shape rejects any
    // unknown key — test that part separately.
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        rules: {
          acyclic: {},
          cohesion: {},
          commonReuse: {},
          stableDependencies: {},
        },
      },
    });
    const { config } = await loadAndValidateConfig();
    expect(config.rules?.acyclic).toEqual({});
    expect(config.rules?.cohesion).toEqual({});
  });

  it("rejects unknown keys inside an option-less rule object", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        rules: {
          // `bogus` is not a valid key on AcyclicOptions —
          // strictObject({}) refuses any property.
          acyclic: { bogus: 42 },
        },
      },
    });
    await expect(loadAndValidateConfig()).rejects.toMatchObject({
      kind: "config.invalidSchema",
    });
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
