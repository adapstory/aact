import type {AactConfigInput} from "../src/config";
import { defineConfig } from "../src/config";
import { defineRule } from "../src/rules";

describe("defineConfig", () => {
  it("returns the input verbatim — pure identity helper", () => {
    const input: AactConfigInput<readonly never[]> = {
      source: { type: "plantuml", path: "./architecture.puml" },
    };
    expect(defineConfig(input)).toBe(input);
  });

  it("preserves customRules tuple literal types for downstream inference", () => {
    const rule = defineRule({
      name: "myRule",
      description: "test",
      check: () => [],
    });
    const cfg = defineConfig({
      source: "./architecture.puml",
      customRules: [rule],
    });
    expect(cfg.customRules?.[0].name).toBe("myRule");
  });
});
