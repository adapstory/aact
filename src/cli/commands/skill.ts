import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";

import type { ArgsDef } from "citty";
import { defineCommand } from "citty";
import consola from "consola";
import path from "pathe";

import { version } from "../../../package.json";

const skillName = "aact-architect";
const markerFileName = ".aact-skill.json";
const defaultRepo = "https://github.com/ChS23/aact-architect-skill.git";
const defaultRef = "main";

const clientValues = [
  "shared",
  "codex",
  "cursor",
  "copilot",
  "claude",
  "cline",
  "all",
] as const;

type ClientValue = (typeof clientValues)[number];
type TargetKind = "shared" | "claude" | "cline";

interface SkillMarker {
  readonly managedBy: "aact";
  readonly skill: typeof skillName;
  readonly client: TargetKind;
  readonly repo: string;
  readonly ref: string;
  readonly aactVersion: string;
  readonly installedAt: string;
}

export interface SkillInstallArgs {
  readonly client?: string;
  readonly codex?: boolean;
  readonly cursor?: boolean;
  readonly copilot?: boolean;
  readonly claude?: boolean;
  readonly cline?: boolean;
  readonly all?: boolean;
  readonly target?: string;
  readonly repo?: string;
  readonly ref?: string;
  readonly force?: boolean;
  readonly "dry-run"?: boolean;
}

export interface InstallPlan {
  readonly kind: TargetKind;
  readonly label: string;
  readonly rootDir: string;
  readonly skillDir: string;
}

interface GitOptions {
  readonly cwd?: string;
}

type GitRunner = (
  args: readonly string[],
  options?: GitOptions,
) => Promise<void>;

interface InstallRuntime {
  readonly git: GitRunner;
  readonly now: () => Date;
}

const targetLabels: Record<TargetKind, string> = {
  shared: "Agent Skills",
  claude: "Claude Code",
  cline: "Cline",
};

const defaultRoots: Record<TargetKind, string> = {
  shared: "~/.agents/skills",
  claude: "~/.claude/skills",
  cline: "~/.cline/skills",
};

const sharedClientValues = new Set<ClientValue>([
  "shared",
  "codex",
  "cursor",
  "copilot",
]);

const defaultRuntime: InstallRuntime = {
  git: (args, options) =>
    new Promise((resolve, reject) => {
      execFile(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- This CLI intentionally invokes the user's git binary to clone/update the skill repository.
        "git",
        [...args],
        { cwd: options?.cwd },
        (error, _stdout, stderr) => {
          if (error) {
            const reason = stderr.trim() || error.message;
            reject(new Error(`git ${args.join(" ")} failed: ${reason}`));
            return;
          }
          resolve();
        },
      );
    }),
  now: () => new Date(),
};

const isClientValue = (value: string): value is ClientValue =>
  clientValues.includes(value as ClientValue);

const expandHome = (input: string): string => {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
};

const resolveRootDir = (rootOrSkillDir: string): string => {
  const resolved = path.resolve(expandHome(rootOrSkillDir));
  return path.basename(resolved) === skillName
    ? path.dirname(resolved)
    : resolved;
};

const toSkillDir = (rootDir: string): string => path.join(rootDir, skillName);

const normalizeKind = (client: ClientValue): TargetKind[] => {
  if (client === "all") return ["shared", "claude", "cline"];
  if (sharedClientValues.has(client)) return ["shared"];
  if (client === "claude" || client === "cline") return [client];
  return ["shared"];
};

const selectedKinds = (args: SkillInstallArgs): TargetKind[] => {
  const out = new Set<TargetKind>();

  if (args.all) {
    for (const kind of normalizeKind("all")) out.add(kind);
  }

  if (args.client) {
    if (!isClientValue(args.client)) {
      throw new Error(
        `Unknown skill client "${args.client}". Expected one of: ${clientValues.join(", ")}.`,
      );
    }
    for (const kind of normalizeKind(args.client)) out.add(kind);
  }

  if (args.codex) out.add("shared");
  if (args.cursor) out.add("shared");
  if (args.copilot) out.add("shared");
  if (args.claude) out.add("claude");
  if (args.cline) out.add("cline");

  if (out.size === 0) out.add("shared");
  return [...out];
};

export const createInstallPlans = (args: SkillInstallArgs): InstallPlan[] => {
  const kinds = selectedKinds(args);
  if (args.target && kinds.length > 1) {
    throw new Error(
      "--target can be used with a single client target only. Remove --all or install clients one by one.",
    );
  }

  return kinds.map((kind) => {
    const rootDir = resolveRootDir(args.target ?? defaultRoots[kind]);
    return {
      kind,
      label: targetLabels[kind],
      rootDir,
      skillDir: toSkillDir(rootDir),
    };
  });
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const readMarker = async (skillDir: string): Promise<SkillMarker | null> => {
  try {
    const content = await fs.readFile(
      path.join(skillDir, markerFileName),
      "utf8",
    );
    const parsed = JSON.parse(content) as Partial<SkillMarker>;
    if (parsed.managedBy === "aact" && parsed.skill === skillName) {
      return parsed as SkillMarker;
    }
  } catch {
    // Missing or malformed marker means the directory is unmanaged.
  }
  return null;
};

const writeMarker = async (
  plan: InstallPlan,
  repo: string,
  ref: string,
  runtime: InstallRuntime,
): Promise<void> => {
  const marker: SkillMarker = {
    managedBy: "aact",
    skill: skillName,
    client: plan.kind,
    repo,
    ref,
    aactVersion: version,
    installedAt: runtime.now().toISOString(),
  };
  await fs.writeFile(
    path.join(plan.skillDir, markerFileName),
    JSON.stringify(marker, undefined, 2) + "\n",
  );
};

const ensureSkillFile = async (skillDir: string): Promise<void> => {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!(await pathExists(skillFile))) {
    throw new Error(
      `Installed repository does not contain ${skillName}/SKILL.md at ${skillFile}.`,
    );
  }
};

const cloneSkill = async (
  plan: InstallPlan,
  repo: string,
  ref: string,
  runtime: InstallRuntime,
): Promise<void> => {
  await fs.mkdir(plan.rootDir, { recursive: true });
  await runtime.git([
    "clone",
    "--depth",
    "1",
    "--branch",
    ref,
    repo,
    plan.skillDir,
  ]);
  await ensureSkillFile(plan.skillDir);
};

const updateSkill = async (
  plan: InstallPlan,
  repo: string,
  ref: string,
  runtime: InstallRuntime,
): Promise<void> => {
  const marker = await readMarker(plan.skillDir);
  if (!marker) {
    throw new Error(
      `${plan.skillDir} already exists and is not managed by aact. Use --force to overwrite it.`,
    );
  }
  if (marker.repo !== repo) {
    throw new Error(
      `${plan.skillDir} is managed by aact but was installed from ${marker.repo}. Use --force to reinstall from ${repo}.`,
    );
  }
  if (!(await pathExists(path.join(plan.skillDir, ".git")))) {
    throw new Error(
      `${plan.skillDir} is managed by aact but is not a git checkout. Use --force to reinstall it.`,
    );
  }

  await runtime.git(["fetch", "--depth", "1", "origin", ref], {
    cwd: plan.skillDir,
  });
  await runtime.git(["checkout", "--force", "FETCH_HEAD"], {
    cwd: plan.skillDir,
  });
  await ensureSkillFile(plan.skillDir);
};

const installOne = async (
  plan: InstallPlan,
  args: SkillInstallArgs,
  runtime: InstallRuntime,
): Promise<void> => {
  const repo = args.repo ?? defaultRepo;
  const ref = args.ref ?? defaultRef;
  const dryRun = args["dry-run"] ?? false;
  const force = args.force ?? false;
  const exists = await pathExists(plan.skillDir);
  const action = exists ? "update" : "install";

  if (dryRun) {
    consola.info(
      `[dry run] ${force && exists ? "reinstall" : action} ${skillName} for ${plan.label}: ${plan.skillDir}`,
    );
    return;
  }

  if (exists && force) {
    await fs.rm(plan.skillDir, { recursive: true, force: true });
  }

  if (exists && !force) {
    await updateSkill(plan, repo, ref, runtime);
    await writeMarker(plan, repo, ref, runtime);
    consola.success(`Updated ${skillName} for ${plan.label}: ${plan.skillDir}`);
    return;
  }

  await cloneSkill(plan, repo, ref, runtime);
  await writeMarker(plan, repo, ref, runtime);
  consola.success(`Installed ${skillName} for ${plan.label}: ${plan.skillDir}`);
};

export const installAgentSkill = async (
  args: SkillInstallArgs,
  runtime: InstallRuntime = defaultRuntime,
): Promise<void> => {
  const repo = args.repo ?? defaultRepo;
  const ref = args.ref ?? defaultRef;
  const plans = createInstallPlans(args);

  consola.info(`Installing community ${skillName} skill from ${repo} (${ref})`);
  for (const plan of plans) {
    await installOne(plan, args, runtime);
  }
};

const installArgs = {
  client: {
    type: "enum",
    description:
      "Client target: shared, codex, cursor, copilot, claude, cline, all",
    options: [...clientValues],
  },
  codex: {
    type: "boolean",
    description: "Install into the shared ~/.agents/skills path used by Codex",
  },
  cursor: {
    type: "boolean",
    description: "Install into the shared ~/.agents/skills path used by Cursor",
  },
  copilot: {
    type: "boolean",
    description:
      "Install into the shared ~/.agents/skills path used by GitHub Copilot",
  },
  claude: {
    type: "boolean",
    description: "Install into ~/.claude/skills for Claude Code",
  },
  cline: {
    type: "boolean",
    description: "Install into ~/.cline/skills for Cline",
  },
  all: {
    type: "boolean",
    description: "Install shared, Claude Code, and Cline targets",
  },
  target: {
    type: "string",
    description: "Custom skills root or full skill directory",
  },
  repo: {
    type: "string",
    description: "Skill repository URL",
    default: defaultRepo,
  },
  ref: {
    type: "string",
    description: "Git branch or tag to install",
    default: defaultRef,
  },
  force: {
    type: "boolean",
    description: "Overwrite an existing unmanaged skill directory",
  },
  "dry-run": {
    type: "boolean",
    description: "Show target directories without writing files",
  },
} satisfies ArgsDef;

const install = defineCommand({
  meta: {
    description: "Install the community aact-architect skill for AI agents",
  },
  args: installArgs,
  async run({ args }) {
    await installAgentSkill(args);
  },
});

export const skill = defineCommand({
  meta: {
    description: "Install agent skills for aact workflows",
  },
  args: installArgs,
  default: "install",
  subCommands: { install },
});
