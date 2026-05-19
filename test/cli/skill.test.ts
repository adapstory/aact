import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {SkillData} from "../../src/cli/commands/skill";
import {
  createInstallPlans,
  executeSkill,
  installAgentSkill,
  renderSkillText
} from "../../src/cli/commands/skill";
import type { CliEnvelope } from "../../src/cli/output";

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

    const result = await executeSkill({ target: root }, runtime);

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

    expect(result.exitCode).toBe(0);
    expect(result.data.plans).toHaveLength(1);
    expect(result.data.plans[0]).toMatchObject({
      kind: "shared",
      action: "installed",
      skillDir,
    });
    expect(result.data.dryRun).toBe(false);
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

  it("does not run git in dry-run mode and reports planned action", async () => {
    const { calls, runtime } = createRuntime();

    const result = await executeSkill(
      { target: root, "dry-run": true },
      runtime,
    );

    expect(calls).toHaveLength(0);
    await expect(
      fs.access(path.join(root, "aact-architect")),
    ).rejects.toThrow();

    expect(result.data.dryRun).toBe(true);
    expect(result.data.plans[0].action).toBe("installed");
    expect(result.data.plans[0].skillDir).toBe(
      path.join(root, "aact-architect"),
    );
  });
});

describe("skill install — error paths", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aact-skill-err-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("throws config.invalidSchema on unknown --client value", async () => {
    const { runtime } = createRuntime();
    await expect(
      executeSkill({ client: "vim-mode", target: root }, runtime),
    ).rejects.toMatchObject({ kind: "config.invalidSchema" });
  });

  it("throws skill.repoMismatch when reinstalling from a different repo", async () => {
    const { runtime } = createRuntime();
    await installAgentSkill({ target: root }, runtime);
    await expect(
      installAgentSkill(
        { target: root, repo: "https://example.com/other.git" },
        runtime,
      ),
    ).rejects.toMatchObject({ kind: "skill.repoMismatch" });
  });

  it("throws skill.unmanagedDir when marker exists but .git is gone", async () => {
    const { runtime } = createRuntime();
    await installAgentSkill({ target: root }, runtime);
    // Simulate a user wiping .git but keeping our marker file
    await fs.rm(path.join(root, "aact-architect", ".git"), {
      recursive: true,
      force: true,
    });
    await expect(
      installAgentSkill({ target: root }, runtime),
    ).rejects.toMatchObject({
      kind: "skill.unmanagedDir",
    });
  });

  it("throws skill.unmanagedDir when cloned repo is missing SKILL.md", async () => {
    const runtime = {
      now: () => fixedDate,
      git: async (args: readonly string[]) => {
        // Clone makes the dir + .git but no SKILL.md — ensureSkillFile path
        if (args[0] === "clone") {
          const skillDir = args.at(-1);
          if (!skillDir) throw new Error("missing target");
          await fs.mkdir(path.join(skillDir, ".git"), { recursive: true });
        }
      },
    };
    await expect(
      installAgentSkill({ target: root }, runtime),
    ).rejects.toMatchObject({
      kind: "skill.unmanagedDir",
    });
  });
});

describe("renderSkillText", () => {
  it("emits a ✔ line per plan in install mode", () => {
    const chunks: string[] = [];
    const sink = {
      write: (c: string) => {
        chunks.push(c);
        return true;
      },
    } as NodeJS.WritableStream;

    renderSkillText(
      {
        data: {
          skill: "aact-architect",
          repo: "https://example.com/repo.git",
          ref: "main",
          dryRun: false,
          plans: [
            {
              kind: "shared",
              label: "shared agents skills dir",
              action: "installed",
              rootDir: "/r",
              skillDir: "/r/aact-architect",
            },
            {
              kind: "claude",
              label: "Claude Code",
              action: "updated",
              rootDir: "/c",
              skillDir: "/c/aact-architect",
            },
          ],
        },
      } as unknown as CliEnvelope<SkillData>,
      sink,
    );

    const out = chunks.join("");
    expect(out).toContain("Installing community aact-architect");
    expect(out).toMatch(/✔ Installed.*\/r\/aact-architect/);
    expect(out).toMatch(/✔ Updated.*\/c\/aact-architect/);
  });

  it("emits [dry run] prefix instead of ✔ in dry-run mode", () => {
    const chunks: string[] = [];
    const sink = {
      write: (c: string) => {
        chunks.push(c);
        return true;
      },
    } as NodeJS.WritableStream;

    renderSkillText(
      {
        data: {
          skill: "aact-architect",
          repo: "r",
          ref: "main",
          dryRun: true,
          plans: [
            {
              kind: "shared",
              label: "shared agents skills dir",
              action: "installed",
              rootDir: "/r",
              skillDir: "/r/aact-architect",
            },
          ],
        },
      } as unknown as CliEnvelope<SkillData>,
      sink,
    );

    const out = chunks.join("");
    expect(out).toContain("[dry run]");
    expect(out).not.toContain("✔");
  });
});
