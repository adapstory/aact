import fs from "node:fs/promises";

import path from "pathe";

import type { Renderer } from "../output";
import type { ExecuteResult } from "../run";
import { cliCommand } from "../run";
import { jsonArg } from "../sharedArgs";

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact init`)
// -----------------------------------------------------------------------------

export type InitFileKind = "config" | "architecture";

export interface InitCreated {
  readonly path: string;
  readonly kind: InitFileKind;
}

export interface InitSkipped {
  readonly path: string;
  readonly kind: InitFileKind;
  readonly reason: "exists";
}

export interface InitData {
  readonly created: readonly InitCreated[];
  readonly skipped: readonly InitSkipped[];
}

// -----------------------------------------------------------------------------
// Templates (unchanged — preserved verbatim from prior behaviour)
// -----------------------------------------------------------------------------

// Type-only import keeps the template runnable via `npx aact check` without
// a local `npm install aact` — jiti/c12 erase `import type` at parse time.
const configTemplate = `import type { AactConfig } from "aact";

const config: AactConfig = {
  // Source of architecture description
  source: {
    type: "plantuml", // "plantuml" | "structurizr"
    path: "./architecture.puml",
  },

  // Validation rules (true = enabled with defaults, false = disabled)
  rules: {
    acl: true, // Anti-Corruption Layer: only tagged containers depend on externals
    acyclic: true, // No circular dependencies
    apiGateway: true, // External calls go through an API gateway
    crud: true, // Only repo/relay containers access databases
    dbPerService: true, // Each database accessed by a single service
    cohesion: true, // Boundary cohesion > coupling
    stableDependencies: true, // Depend on more stable components
    commonReuse: true, // Reuse all of a context's public API or none
  },

  // -----------------------------------------------------------------------
  // Project-specific (custom) rules
  //
  // After \`npm install aact\` locally, switch from this type-only import to
  // \`defineConfig\` to register your own checks alongside the built-ins:
  //
  //   import { defineConfig } from "aact";
  //   import { bcIsolationRule } from "./rules/bcIsolation";
  //
  //   export default defineConfig({
  //     source: { type: "plantuml", path: "./architecture.puml" },
  //
  //     customRules: [bcIsolationRule],
  //
  //     rules: {
  //       acl: true,
  //       // Configure custom rules with the same syntax as built-ins.
  //       // TypeScript autocompletes options based on the rule definition.
  //       bcIsolation: { apiSuffix: "_api" },
  //     },
  //   });
  //
  // Worked example with two rules and tests:
  //   https://github.com/Byndyusoft/aact/tree/main/examples/custom-rules
  // -----------------------------------------------------------------------

  // PlantUML generation from Kubernetes configs (aact generate)
  // generate: {
  //   kubernetes: { path: "./fixtures/kubernetes" },
  //   boundaryLabel: "Our system",
  // },

  // Default output mode. CLI \`--json\` always overrides per-invocation.
  // Set to "json" for CI / agent pipelines that always want the envelope.
  // output: {
  //   mode: "json",
  // },
};

export default config;
`;

const architectureTemplate = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

' Starter architecture. Replace with your own.
' One intentional CRUD violation: \`orders\` accesses \`orders_db\` directly.
' Run \`aact check\` to see it, then \`aact check --fix\` to auto-add a repo.

System_Boundary(checkout, "Checkout") {
  Container(orders, "Orders Service")
  ContainerDb(orders_db, "Orders DB")
}

Rel(orders, orders_db, "PostgreSQL")
@enduml
`;

const configFileName = "aact.config.ts";
const architectureFileName = "architecture.puml";

// -----------------------------------------------------------------------------
// Pure executor
// -----------------------------------------------------------------------------

interface FileSpec {
  readonly kind: InitFileKind;
  readonly fileName: string;
  readonly content: string;
}

const fileSpecs: readonly FileSpec[] = [
  { kind: "config", fileName: configFileName, content: configTemplate },
  {
    kind: "architecture",
    fileName: architectureFileName,
    content: architectureTemplate,
  },
];

const fileExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export const executeInit = async (): Promise<ExecuteResult<InitData>> => {
  const cwd = process.cwd();
  const created: InitCreated[] = [];
  const skipped: InitSkipped[] = [];

  for (const spec of fileSpecs) {
    const target = path.resolve(cwd, spec.fileName);
    if (await fileExists(target)) {
      skipped.push({ path: target, kind: spec.kind, reason: "exists" });
      continue;
    }
    await fs.writeFile(target, spec.content);
    created.push({ path: target, kind: spec.kind });
  }

  return {
    data: { created, skipped },
    exitCode: 0,
  };
};

// -----------------------------------------------------------------------------
// Text rendering — mirrors current consola.success / warn / info messages
// -----------------------------------------------------------------------------

export const renderInitText: Renderer<InitData> = (envelope, sink) => {
  const { data } = envelope;

  for (const skip of data.skipped) {
    sink.write(`⚠ ${path.basename(skip.path)} already exists. Skipping.\n`);
  }
  for (const create of data.created) {
    sink.write(`✔ Created ${path.basename(create.path)}\n`);
  }

  if (data.created.length > 0) {
    sink.write(
      "Next: run `aact check` to see violations, then `aact check --fix` to auto-fix.\n",
    );
  }
};

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

export const init = cliCommand({
  name: "init",
  meta: {
    name: "init",
    description: "Create aact.config.ts and a starter architecture file",
  },
  args: { ...jsonArg },
  renderText: renderInitText,
  execute: () => executeInit(),
});
