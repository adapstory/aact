import { resolveOutputMode } from "../../../src/cli/output/resolveMode";
import type { AactConfig } from "../../../src/config";

const baseConfig: AactConfig = {
  source: { type: "plantuml", path: "x.puml" },
};

describe("resolveOutputMode", () => {
  it("defaults to text when no input provided", () => {
    expect(resolveOutputMode({})).toBe("text");
  });

  it("returns json when CLI flag is true", () => {
    expect(resolveOutputMode({ cliJson: true })).toBe("json");
  });

  it("returns json when config.output.mode is json and CLI flag unset", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "json" },
    };
    expect(resolveOutputMode({ config })).toBe("json");
  });

  it("CLI flag wins over config", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "text" },
    };
    expect(resolveOutputMode({ cliJson: true, config })).toBe("json");
  });

  it("returns text when neither CLI nor config requests json", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "text" },
    };
    expect(resolveOutputMode({ cliJson: false, config })).toBe("text");
  });

  it("returns text when config has no output section", () => {
    expect(resolveOutputMode({ config: baseConfig })).toBe("text");
  });

  it("returns text when config is null", () => {
    expect(resolveOutputMode({ config: null })).toBe("text");
  });
});
