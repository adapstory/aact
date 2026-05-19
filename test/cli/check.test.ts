import { readFile, writeFile } from "node:fs/promises";

import { executeCheck, renderCheckText } from "../../src/cli/commands/check";
import { loadModel } from "../../src/cli/loadModel";
import { buildEnvelope } from "../../src/cli/output";
import type { AactConfig } from "../../src/config";
import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { loadFormat } from "../../src/formats/registry";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import type { Format } from "../../src/formats/types";
import type { Model } from "../../src/model";
import type { ElementSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/cli/loadModel")
  >("../../src/cli/loadModel");
  return {
    ...actual,
    loadModel: vi.fn(),
  };
});

vi.mock("../../src/formats/registry", () => ({
  loadFormat: vi.fn(),
  knownFormatNames: () => ["plantuml", "structurizr", "kubernetes"],
}));

const mockLoadModel = vi.mocked(loadModel);
const mockLoadFormat = vi.mocked(loadFormat);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const fakeFormat = (
  name: string,
  fixSyntax = plantumlSyntax,
  load = vi.fn(),
): Format => ({ name, load, fix: { syntax: fixSyntax } });

const plantumlConfig: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

const cleanModel = (): Model =>
  makeModel({
    elements: [
      { name: "svc_a", relations: [{ to: "svc_b", technology: "http" }] },
      { name: "svc_b" },
    ],
    boundaries: [{ name: "project", elementNames: ["svc_a", "svc_b"] }],
  });

const violatingContainers: ElementSpec[] = [
  { name: "my_service", relations: [{ to: "ext_system" }] },
  { name: "ext_system", kind: "System", external: true },
];

const violatingModel = (): Model =>
  makeModel({
    elements: violatingContainers,
    boundaries: [
      {
        name: "project",
        elementNames: ["my_service", "ext_system"],
      },
    ],
  });

const cyclicModel = (): Model =>
  makeModel({
    elements: [
      { name: "svc_a", relations: [{ to: "svc_b" }] },
      { name: "svc_b", relations: [{ to: "svc_a" }] },
    ],
    boundaries: [{ name: "project", elementNames: ["svc_a", "svc_b"] }],
  });

describe("executeCheck — exit code matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat("plantuml"));
  });

  it("exitCode 0 on clean model", async () => {
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    const result = await executeCheck(plantumlConfig, {});
    expect(result.exitCode).toBe(0);
    expect(result.data.violations).toHaveLength(0);
    expect(result.data.mode).toBe("check");
  });

  it("exitCode 1 on violations without --fix", async () => {
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const result = await executeCheck(plantumlConfig, {});
    expect(result.exitCode).toBe(1);
    expect(result.data.violations.length).toBeGreaterThan(0);
    expect(result.data.violations[0].severity).toBe("error");
    expect(result.data.violations[0].rule).toBe("acl");
  });

  it("exitCode 1 on --dry-run with violations (Codex P1 — was 0)", async () => {
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const result = await executeCheck(plantumlConfig, { "dry-run": true });
    expect(result.exitCode).toBe(1);
    expect(result.data.mode).toBe("dry-run");
    expect(result.data.suggestedFixes.length).toBeGreaterThan(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("exitCode 0 after --fix that clears all violations", async () => {
    mockLoadModel
      .mockResolvedValueOnce({ model: violatingModel(), issues: [] })
      .mockResolvedValueOnce({ model: cleanModel(), issues: [] });
    mockReadFile.mockResolvedValue(
      [
        'Container(my_service, "My Service")',
        'System_Ext(ext_system, "External System")',
        'Rel(my_service, ext_system, "")',
      ].join("\n"),
    );
    mockWriteFile.mockResolvedValue();

    const result = await executeCheck(plantumlConfig, { fix: true });

    expect(result.exitCode).toBe(0);
    expect(result.data.fixesApplied?.remaining).toBe(0);
    expect(result.data.fixesApplied?.count).toBeGreaterThan(0);
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it("surfaces fix.editConflict diagnostics when two rules want overlapping byte ranges", async () => {
    // Both crud and dbPerService want to rewrite `Rel(orders, orders_db)`.
    // The applier picks one (deterministic first-wins) and reports
    // the other as a conflict — must NOT silently drop.
    const conflictingModel = () =>
      makeModel({
        elements: [
          { name: "orders", relations: [{ to: "orders_db" }] },
          {
            name: "orders_repo",
            tags: ["repo"],
            relations: [{ to: "orders_db" }],
          },
          { name: "extra", relations: [{ to: "orders_db" }] },
          { name: "orders_db", kind: "ContainerDb" },
        ],
      });
    mockLoadModel
      .mockResolvedValueOnce({ model: conflictingModel(), issues: [] })
      .mockResolvedValueOnce({ model: conflictingModel(), issues: [] });
    mockReadFile.mockResolvedValue(
      [
        "Container(orders)",
        'Container(orders_repo, "", $tags="repo")',
        "Container(extra)",
        "ContainerDb(orders_db)",
        "Rel(orders, orders_db, lots-of-overlap)",
        "Rel(orders_repo, orders_db, x)",
        "Rel(extra, orders_db, y)",
      ].join("\n"),
    );
    mockWriteFile.mockResolvedValue();

    const result = await executeCheck(plantumlConfig, { fix: true });
    const conflictDiags = result.diagnostics?.filter(
      (d) => d.kind === "fix.editConflict",
    );
    expect(conflictDiags?.length ?? 0).toBeGreaterThan(0);
  });

  it("exitCode 1 after --fix when violations remain (Codex P1 — was 0)", async () => {
    mockLoadModel
      .mockResolvedValueOnce({ model: violatingModel(), issues: [] })
      .mockResolvedValueOnce({ model: violatingModel(), issues: [] });
    mockReadFile.mockResolvedValue(
      [
        'Container(my_service, "My Service")',
        'System_Ext(ext_system, "External System")',
        'Rel(my_service, ext_system, "")',
      ].join("\n"),
    );
    mockWriteFile.mockResolvedValue();

    const result = await executeCheck(plantumlConfig, { fix: true });

    expect(result.exitCode).toBe(1);
    expect(result.data.fixesApplied?.remaining).toBeGreaterThan(0);
  });

  it("exitCode 1 when violations exist but no auto-fix is available", async () => {
    mockLoadModel.mockResolvedValue({ model: cyclicModel(), issues: [] });
    const result = await executeCheck(
      { ...plantumlConfig, rules: { acl: false } },
      {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.data.violations.length).toBeGreaterThan(0);
  });
});

describe("executeCheck — diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat("plantuml"));
  });

  it("emits config.unknownRule for unknown rule names in config", async () => {
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });
    const result = await executeCheck(
      { ...plantumlConfig, rules: { totallyMadeUpRule: true } },
      {},
    );
    expect(
      result.diagnostics?.some((d) => d.kind === "config.unknownRule"),
    ).toBe(true);
  });

  it("emits model.* diagnostics from loader issues", async () => {
    mockLoadModel.mockResolvedValue({
      model: cleanModel(),
      issues: [{ kind: "self-relation", element: "svc_a" }],
    });
    const result = await executeCheck(plantumlConfig, {});
    expect(
      result.diagnostics?.some((d) => d.kind === "model.selfRelation"),
    ).toBe(true);
  });

  it("emits format.missingWritePath for structurizr without writePath when violations exist", async () => {
    mockLoadFormat.mockResolvedValue(
      fakeFormat("structurizr", structurizrDslSyntax),
    );
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const config: AactConfig = {
      source: { type: "structurizr", path: "workspace.json" },
    };
    const result = await executeCheck(config, {});
    expect(
      result.diagnostics?.some((d) => d.kind === "format.missingWritePath"),
    ).toBe(true);
    expect(result.data.suggestedFixes).toHaveLength(0);
  });
});

describe("executeCheck — disabled rules respected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat("plantuml"));
  });

  it("rule disabled via rules.<name>: false does not produce violations", async () => {
    mockLoadModel.mockResolvedValue({ model: violatingModel(), issues: [] });
    const result = await executeCheck(
      { ...plantumlConfig, rules: { acl: false } },
      {},
    );
    expect(result.data.violations.every((v) => v.rule !== "acl")).toBe(true);
  });
});

describe("renderCheckText", () => {
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

  it("renders box summary when clean", () => {
    const { sink, output } = captureSink();
    renderCheckText(
      buildEnvelope({
        command: "check",
        exitCode: 0,
        data: {
          mode: "check",
          violations: [],
          suggestedFixes: [],
          summary: { failed: 0, passed: 8, total: 0 },
        },
        meta: { durationMs: 1, configPath: null, source: "test.puml" },
      }),
      sink,
    );
    expect(output()).toContain("No violations found");
  });

  it("renders violations table when failing", () => {
    const { sink, output } = captureSink();
    renderCheckText(
      buildEnvelope({
        command: "check",
        exitCode: 1,
        data: {
          mode: "check",
          violations: [
            {
              rule: "acl",
              target: "my_service",
              targetKind: "element" as const,
              message: "calls external system",
              severity: "error",
            },
          ],
          suggestedFixes: [],
          summary: { failed: 1, passed: 7, total: 1 },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    const text = output();
    expect(text).toContain("acl");
    expect(text).toContain("my_service");
    expect(text).toContain("1 violation");
  });

  it("renders suggested fixes preview only in dry-run mode", () => {
    const inDryRun = (() => {
      const { sink, output } = captureSink();
      renderCheckText(
        buildEnvelope({
          command: "check",
          exitCode: 1,
          data: {
            mode: "dry-run",
            violations: [
              {
                rule: "acl",
                target: "my_service",
                targetKind: "element" as const,
                message: "msg",
                severity: "error",
              },
            ],
            suggestedFixes: [
              {
                rule: "acl",
                description: "add anti-corruption layer",
                edits: [
                  {
                    kind: "insert-after",
                    anchor: {
                      file: "x.puml",
                      start: { line: 1, col: 1, offset: 0 },
                      end: { line: 1, col: 10, offset: 10 },
                    },
                    content: "fake",
                  },
                ],
              },
            ],
            summary: { failed: 1, passed: 0, total: 1 },
          },
          meta: { durationMs: 1, configPath: null, source: null },
        }),
        sink,
      );
      return output();
    })();

    const inCheck = (() => {
      const { sink, output } = captureSink();
      renderCheckText(
        buildEnvelope({
          command: "check",
          exitCode: 1,
          data: {
            mode: "check",
            violations: [
              {
                rule: "acl",
                target: "my_service",
                targetKind: "element" as const,
                message: "msg",
                severity: "error",
              },
            ],
            suggestedFixes: [
              {
                rule: "acl",
                description: "add anti-corruption layer",
                edits: [
                  {
                    kind: "insert-after",
                    anchor: {
                      file: "x.puml",
                      start: { line: 1, col: 1, offset: 0 },
                      end: { line: 1, col: 10, offset: 10 },
                    },
                    content: "fake",
                  },
                ],
              },
            ],
            summary: { failed: 1, passed: 0, total: 1 },
          },
          meta: { durationMs: 1, configPath: null, source: null },
        }),
        sink,
      );
      return output();
    })();

    expect(inDryRun).toContain("Suggested fixes");
    expect(inCheck).not.toContain("Suggested fixes");
  });

  it("renders github annotations when GITHUB_ACTIONS env is set", () => {
    const prev = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    try {
      const { sink, output } = captureSink();
      renderCheckText(
        buildEnvelope({
          command: "check",
          exitCode: 1,
          data: {
            mode: "check",
            violations: [
              {
                rule: "acl",
                target: "my_service",
                targetKind: "element" as const,
                message: "calls external",
                severity: "error",
              },
            ],
            suggestedFixes: [],
            summary: { failed: 1, passed: 0, total: 1 },
          },
          meta: { durationMs: 1, configPath: null, source: null },
        }),
        sink,
      );
      expect(output()).toMatch(/^::error title=acl::my_service:/m);
    } finally {
      if (prev === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = prev;
    }
  });

  it("annotates github errors with file/line/col when sourceLocation is present", () => {
    const prev = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    try {
      const { sink, output } = captureSink();
      renderCheckText(
        buildEnvelope({
          command: "check",
          exitCode: 1,
          data: {
            mode: "check",
            violations: [
              {
                rule: "acl",
                target: "my_service",
                targetKind: "element" as const,
                message: "calls external",
                severity: "error",
                sourceLocation: {
                  file: "/abs/arch.dsl",
                  start: { line: 42, col: 5, offset: 800 },
                  end: { line: 42, col: 25, offset: 820 },
                },
              },
            ],
            suggestedFixes: [],
            summary: { failed: 1, passed: 0, total: 1 },
          },
          meta: { durationMs: 1, configPath: null, source: null },
        }),
        sink,
      );
      expect(output()).toMatch(
        /^::error file=\/abs\/arch\.dsl,line=42,col=5,title=acl::my_service: calls external/m,
      );
    } finally {
      if (prev === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = prev;
    }
  });

  it("renders fixesApplied summary when present", () => {
    const { sink, output } = captureSink();
    renderCheckText(
      buildEnvelope({
        command: "check",
        exitCode: 0,
        data: {
          mode: "fix",
          violations: [],
          suggestedFixes: [],
          summary: { failed: 1, passed: 7, total: 1 },
          fixesApplied: {
            count: 3,
            remaining: 0,
            writePath: "/abs/test.puml",
          },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    expect(output()).toContain("Applied 3 fix(es)");
    expect(output()).toContain("/abs/test.puml");
  });
});
