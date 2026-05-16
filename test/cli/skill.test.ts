import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import consola from "consola";

import {
  createInstallPlans,
  installAgentSkill,
} from "../../src/cli/commands/skill";

vi.mock("consola", () => ({
  default: {
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const defaultRepo = "https://github.com/ChS23/aact-architect-skill.git";
const fixedDate = new Date("2026-05-16T00:00:00.000Z");

interface GitCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRuntime = () => {
  const calls: GitCall[] = [];
  const runtime = {
    now: () => fixedDate,
    git: async (args: readonly string[], options?: { cwd?: string }) => {
      calls.push({ args: [...args], cwd: options?.cwd });
      if (args[0] === "clone") {
        const skillDir = args.at(-1);
        if (!skillDir) throw new Error("missing clone target");
        await fs.mkdir(path.join(skillDir, ".git"), { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "# aact\n");
      }
    },
  };

  return { calls, runtime };
};

describe("skill install planning", () => {
  it("defaults to the shared Agent Skills directory", () => {
    const [plan] = createInstallPlans({});

    expect(plan.kind).toBe("shared");
    expect(plan.rootDir).toBe(path.join(os.homedir(), ".agents", "skills"));
    expect(plan.skillDir).toBe(
      path.join(os.homedir(), ".agents", "skills", "aact-architect"),
    );
  });

  it("maps Claude Code to its own skills directory", () => {
    const [plan] = createInstallPlans({ claude: true });

    expect(plan.kind).toBe("claude");
    expect(plan.skillDir).toBe(
      path.join(os.homedir(), ".claude", "skills", "aact-architect"),
    );
  });

  it("deduplicates Codex, Cursor, and Copilot into the shared target", () => {
    const plans = createInstallPlans({
      codex: true,
      cursor: true,
      copilot: true,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].kind).toBe("shared");
  });

  it("--all installs shared, Claude Code, and Cline targets", () => {
    const plans = createInstallPlans({ all: true });

    expect(plans.map((p) => p.kind)).toEqual(["shared", "claude", "cline"]);
  });

  it("accepts --target as either a skills root or the final skill directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aact-skill-target-"));
    try {
      const [fromRoot] = createInstallPlans({ target: root });
      const [fromSkillDir] = createInstallPlans({
        target: path.join(root, "aact-architect"),
      });

      expect(fromRoot.rootDir).toBe(root);
      expect(fromRoot.skillDir).toBe(path.join(root, "aact-architect"));
      expect(fromSkillDir.rootDir).toBe(root);
      expect(fromSkillDir.skillDir).toBe(path.join(root, "aact-architect"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects --target with multiple client targets", () => {
    expect(() =>
      createInstallPlans({ all: true, target: "aact-skills" }),
    ).toThrow(/single client target/i);
  });
});

describe("skill install command", () => {
  let root: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aact-skill-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("clones the community skill and writes an aact marker", async () => {
    const { calls, runtime } = createRuntime();

    await installAgentSkill({ target: root }, runtime);

    const skillDir = path.join(root, "aact-architect");
    expect(calls.map((c) => c.args[0])).toEqual(["clone"]);
    expect(calls[0].args).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      defaultRepo,
      skillDir,
    ]);

    const marker = JSON.parse(
      await fs.readFile(path.join(skillDir, ".aact-skill.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(marker).toMatchObject({
      managedBy: "aact",
      skill: "aact-architect",
      client: "shared",
      repo: defaultRepo,
      ref: "main",
      installedAt: fixedDate.toISOString(),
    });
    expect(consola.success).toHaveBeenCalledWith(
      expect.stringContaining(skillDir),
    );
  });

  it("updates an existing managed skill checkout", async () => {
    const { calls, runtime } = createRuntime();

    await installAgentSkill({ target: root }, runtime);
    calls.length = 0;

    await installAgentSkill({ target: root }, runtime);

    expect(calls).toEqual([
      {
        args: ["fetch", "--depth", "1", "origin", "main"],
        cwd: path.join(root, "aact-architect"),
      },
      {
        args: ["checkout", "--force", "FETCH_HEAD"],
        cwd: path.join(root, "aact-architect"),
      },
    ]);
  });

  it("refuses to overwrite an unmanaged skill directory", async () => {
    const { calls, runtime } = createRuntime();
    await fs.mkdir(path.join(root, "aact-architect"), { recursive: true });

    await expect(installAgentSkill({ target: root }, runtime)).rejects.toThrow(
      /not managed by aact/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("overwrites an unmanaged skill directory with --force", async () => {
    const { calls, runtime } = createRuntime();
    const skillDir = path.join(root, "aact-architect");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "local.txt"), "user edit");

    await installAgentSkill({ target: root, force: true }, runtime);

    expect(calls.map((c) => c.args[0])).toEqual(["clone"]);
    await expect(fs.access(path.join(skillDir, "local.txt"))).rejects.toThrow();
    await expect(
      fs.access(path.join(skillDir, "SKILL.md")),
    ).resolves.toBeUndefined();
  });

  it("does not run git in dry-run mode", async () => {
    const { calls, runtime } = createRuntime();

    await installAgentSkill({ target: root, "dry-run": true }, runtime);

    expect(calls).toHaveLength(0);
    await expect(
      fs.access(path.join(root, "aact-architect")),
    ).rejects.toThrow();
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("dry run"),
    );
  });
});
