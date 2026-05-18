import { loadConfig } from "c12";

import {
  executeRuleList,
  renderRuleListText,
} from "../../src/cli/commands/rule";
import { buildEnvelope } from "../../src/cli/output";
import { defineRule } from "../../src/rules/types";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

const mockLoadConfig = vi.mocked(loadConfig);

const mockNoConfig = (): void => {
  mockLoadConfig.mockResolvedValue({} as never);
};

const mockConfig = (config: Record<string, unknown>): void => {
  mockLoadConfig.mockResolvedValue({ config });
};

describe("executeRuleList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all built-ins as enabled when no config", async () => {
    mockNoConfig();
    const result = await executeRuleList({});

    expect(result.exitCode).toBe(0);
    expect(result.data.rules.length).toBeGreaterThan(0);
    expect(result.data.rules.every((r) => r.source === "built-in")).toBe(true);
    expect(result.data.rules.every((r) => r.enabled)).toBe(true);
    expect(result.data.summary.enabled).toBe(result.data.summary.total);
  });

  it("includes custom rules from config alongside built-ins", async () => {
    const myRule = defineRule({
      name: "noLegacy",
      description: "no legacy tag allowed",
      check: () => [],
    });
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      customRules: [myRule],
    });

    const result = await executeRuleList({});

    const noLegacy = result.data.rules.find((r) => r.name === "noLegacy");
    expect(noLegacy).toBeDefined();
    expect(noLegacy?.source).toBe("custom");
    expect(noLegacy?.enabled).toBe(true);
    expect(noLegacy?.hasFix).toBe(false);
  });

  it("marks rule as disabled via rules.<name>: false", async () => {
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      rules: { acl: false },
    });

    const result = await executeRuleList({});

    const acl = result.data.rules.find((r) => r.name === "acl");
    expect(acl?.enabled).toBe(false);
  });

  it("marks rule with fix capability as hasFix: true", async () => {
    mockNoConfig();
    const result = await executeRuleList({});
    const acl = result.data.rules.find((r) => r.name === "acl");
    expect(acl?.hasFix).toBe(true);
  });

  it("propagates ToolError for broken config (no silent fallback)", async () => {
    mockConfig({
      source: { type: "not-a-known-format", path: "x.puml" },
    });
    await expect(executeRuleList({})).rejects.toMatchObject({
      name: "ToolError",
    });
  });

  it("falls back to built-ins on missing config (empty c12 result)", async () => {
    mockLoadConfig.mockResolvedValue({ config: {} });
    const result = await executeRuleList({});
    expect(result.exitCode).toBe(0);
    expect(result.data.rules.every((r) => r.source === "built-in")).toBe(true);
  });
});

describe("renderRuleListText", () => {
  const captureSink = (): {
    sink: NodeJS.WritableStream;
    output: () => string;
  } => {
    const chunks: Buffer[] = [];
    const sink: Partial<NodeJS.WritableStream> = {
      write: (chunk: string | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
        return true;
      },
    };
    return {
      sink: sink as NodeJS.WritableStream,
      output: () => Buffer.concat(chunks).toString("utf8"),
    };
  };

  it("renders both Built-in and Custom groups", () => {
    const { sink, output } = captureSink();
    renderRuleListText(
      buildEnvelope({
        command: "rule list",
        exitCode: 0,
        data: {
          rules: [
            {
              name: "acl",
              description: "ACL",
              source: "built-in",
              enabled: true,
              hasFix: true,
            },
            {
              name: "noLegacy",
              description: "no legacy",
              source: "custom",
              enabled: true,
              hasFix: false,
            },
          ],
          summary: { enabled: 2, total: 2 },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("Built-in");
    expect(text).toContain("acl");
    expect(text).toContain("Custom");
    expect(text).toContain("noLegacy");
    expect(text).toContain("2/2 rules enabled");
  });

  it("skips Custom group when no custom rules present", () => {
    const { sink, output } = captureSink();
    renderRuleListText(
      buildEnvelope({
        command: "rule list",
        exitCode: 0,
        data: {
          rules: [
            {
              name: "acl",
              description: "ACL",
              source: "built-in",
              enabled: true,
              hasFix: true,
            },
          ],
          summary: { enabled: 1, total: 1 },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("Built-in");
    expect(text).not.toContain("Custom");
  });
});
