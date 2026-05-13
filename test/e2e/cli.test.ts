import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

// End-to-end CLI tests. These spawn the built CLI binary (`dist/cli/index.mjs`)
// as a real subprocess in a clean temp directory, exercising the same code
// path that `npx aact` triggers for end users. Catches package-level
// regressions that unit tests miss: bin shebang, exports field, runtime
// resolution of bundled deps, init-template correctness, exit codes, etc.
//
// The full demo loop (`init` → `check` reports a violation → `check --fix`
// applies it → `check` reports clean) is the user-facing contract for
// the Quick Start in the README and the SKILL.md workflow A.

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli", "index.mjs");

let workDir: string;

beforeAll(async () => {
  // Make sure the CLI is built. Test assumes consumer has run `pnpm build`
  // (CI typically does). If dist/ is stale we skip rather than build
  // implicitly — building inside tests masks build failures.
  try {
    await fs.access(CLI_PATH);
  } catch {
    throw new Error(
      `CLI not built at ${CLI_PATH}. Run \`pnpm build\` before \`pnpm test:e2e\`.`,
    );
  }
});

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "aact-e2e-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

const runCli = (args: string[]) =>
  execa("node", [CLI_PATH, ...args], { cwd: workDir, reject: false });

describe("aact init", () => {
  it("creates aact.config.ts and architecture.puml in cwd", async () => {
    const result = await runCli(["init"]);
    expect(result.exitCode).toBe(0);

    const files = await fs.readdir(workDir);
    expect(files).toContain("aact.config.ts");
    expect(files).toContain("architecture.puml");
  });

  it("config template uses `import type` so npx flow works without local install", async () => {
    await runCli(["init"]);
    const config = await fs.readFile(
      path.join(workDir, "aact.config.ts"),
      "utf8",
    );
    expect(config).toContain('import type { AactConfig } from "aact"');
    // Should NOT contain runtime `import { defineConfig }` — that would
    // require resolving "aact" at runtime and break the npx-only flow.
    expect(config).not.toMatch(/^import\s*\{\s*defineConfig\s*\}/m);
  });

  it("does not overwrite existing files on re-run", async () => {
    await runCli(["init"]);
    await fs.writeFile(
      path.join(workDir, "aact.config.ts"),
      "// user-modified",
    );
    const result = await runCli(["init"]);
    expect(result.exitCode).toBe(0);

    const config = await fs.readFile(
      path.join(workDir, "aact.config.ts"),
      "utf8",
    );
    expect(config).toBe("// user-modified");
  });
});

describe("aact check", () => {
  it("reports the seeded CRUD violation from the starter architecture", async () => {
    await runCli(["init"]);
    const result = await runCli(["check"]);
    // Default starter has one intentional CRUD violation.
    expect(result.exitCode).toBe(1);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).toContain("crud");
    expect(output).toContain("orders");
  });

  it("emits a friendly error and exits 1 when source file is missing", async () => {
    await runCli(["init"]);
    await fs.rm(path.join(workDir, "architecture.puml"));
    const result = await runCli(["check"]);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/architecture file not found/i);
    // Should NOT be a raw Node stack trace.
    expect(output).not.toContain("at Object.<anonymous>");
  });

  it("--help prints the available options", async () => {
    const result = await runCli(["check", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--fix");
    expect(result.stdout).toContain("--dry-run");
  });
});

describe("aact check --fix demo loop", () => {
  it("init → check reports violation → fix applies → re-check is clean", async () => {
    await runCli(["init"]);

    const firstCheck = await runCli(["check"]);
    expect(firstCheck.exitCode).toBe(1);

    const archBefore = await fs.readFile(
      path.join(workDir, "architecture.puml"),
      "utf8",
    );

    const fixResult = await runCli(["check", "--fix"]);
    expect(fixResult.exitCode).toBe(0);

    // The fix surface is the file write — consola's "Applied N fix(es)"
    // message goes through a TTY-aware path that swallows when piped, so
    // we assert observable state instead of stdout text.
    const archAfter = await fs.readFile(
      path.join(workDir, "architecture.puml"),
      "utf8",
    );
    expect(archAfter).not.toBe(archBefore);
    expect(archAfter).toContain("orders_repo"); // new repo container injected

    const secondCheck = await runCli(["check"]);
    expect(secondCheck.exitCode).toBe(0);
  });
});

describe("aact check — customRules", () => {
  // Inline custom rule в config — без "aact" runtime import'а (тестовый
  // tempdir без `npm install`). Реальные user'ы импортят defineRule из
  // "aact" — see examples/custom-rules/.
  const inlineRuleConfig = `
const noDeprecatedTag = {
  name: "noDeprecatedTag",
  description: "Containers must not carry deprecated tag",
  check(model) {
    return Object.values(model.containers)
      .filter((c) => c.tags.includes("deprecated"))
      .map((c) => ({ container: c.name, message: 'has "deprecated" tag' }));
  },
};

export default {
  source: "./architecture.puml",
  customRules: [noDeprecatedTag],
  rules: { crud: false, acl: false, acyclic: false, dbPerService: false },
};
`;

  const archWithDeprecated = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

Container(svc_a, "Service A", "Node.js")
Container(legacy_svc, "Legacy", "Java 6", $tags="deprecated")

Rel(svc_a, legacy_svc, "HTTP")
@enduml
`;

  it("runs inline custom rule and reports its violations", async () => {
    await fs.writeFile(path.join(workDir, "aact.config.ts"), inlineRuleConfig);
    await fs.writeFile(
      path.join(workDir, "architecture.puml"),
      archWithDeprecated,
    );

    const result = await runCli(["check"]);
    expect(result.exitCode).toBe(1);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).toContain("nodeprecatedtag");
    expect(output).toContain("legacy_svc");
  });

  it("passes when custom rule disabled via rules.<name>: false", async () => {
    const disabledConfig = inlineRuleConfig.replace(
      "rules: { crud: false",
      "rules: { noDeprecatedTag: false, crud: false",
    );
    await fs.writeFile(path.join(workDir, "aact.config.ts"), disabledConfig);
    await fs.writeFile(
      path.join(workDir, "architecture.puml"),
      archWithDeprecated,
    );

    const result = await runCli(["check"]);
    expect(result.exitCode).toBe(0);
  });

  it("errors when custom rule name collides with built-in", async () => {
    const conflictConfig = `
const collide = {
  name: "acl",
  description: "collides with built-in",
  check: () => [],
};
export default {
  source: "./architecture.puml",
  customRules: [collide],
};
`;
    await fs.writeFile(path.join(workDir, "aact.config.ts"), conflictConfig);
    await fs.writeFile(
      path.join(workDir, "architecture.puml"),
      archWithDeprecated,
    );

    const result = await runCli(["check"]);
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/conflicts with existing built-in/i);
  });

  it("warns on unknown rule name in config.rules", async () => {
    const configWithTypo = `
export default {
  source: "./architecture.puml",
  rules: { typoRule: true, crud: false },
};
`;
    await fs.writeFile(path.join(workDir, "aact.config.ts"), configWithTypo);
    await fs.writeFile(
      path.join(workDir, "architecture.puml"),
      archWithDeprecated,
    );

    const result = await runCli(["check"]);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/Unknown rule "typoRule"/i);
  });
});

describe("aact rule list", () => {
  it("lists built-in rules without config", async () => {
    const result = await runCli(["rule", "list"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Built-in");
    expect(output).toContain("acl");
    expect(output).toContain("acyclic");
  });

  it("includes custom rules from loaded config", async () => {
    const inlineRuleConfig = `
const noLegacy = {
  name: "noLegacy",
  description: "no legacy",
  check: () => [],
};
export default {
  source: "./architecture.puml",
  customRules: [noLegacy],
};
`;
    await fs.writeFile(path.join(workDir, "aact.config.ts"), inlineRuleConfig);
    await fs.writeFile(
      path.join(workDir, "architecture.puml"),
      "@startuml\n@enduml\n",
    );

    const result = await runCli(["rule", "list"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Custom");
    expect(output).toContain("noLegacy");
  });

  it("emits JSON when --json flag set", async () => {
    const result = await runCli(["rule", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("name");
    expect(parsed[0]).toHaveProperty("source");
    expect(parsed[0]).toHaveProperty("enabled");
  });
});

describe("aact --help / --version", () => {
  it("--help lists all four subcommands", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("analyze");
    expect(result.stdout).toContain("generate");
  });

  it("--help reports a version that matches package.json", async () => {
    const result = await runCli(["--help"]);
    const pkg = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    expect(result.stdout).toContain(pkg.version);
  });
});
