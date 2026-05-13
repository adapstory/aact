import fs from "node:fs/promises";

import { defineCommand } from "citty";
import consola from "consola";
import path from "pathe";

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

const writeIfNew = async (
  filePath: string,
  content: string,
  label: string,
): Promise<boolean> => {
  try {
    await fs.access(filePath);
    consola.warn(`${label} already exists. Skipping.`);
    return false;
  } catch {
    await fs.writeFile(filePath, content);
    consola.success(`Created ${label}`);
    return true;
  }
};

export const init = defineCommand({
  meta: {
    description: "Create aact.config.ts and a starter architecture file",
  },
  async run() {
    const cwd = process.cwd();
    const configCreated = await writeIfNew(
      path.resolve(cwd, configFileName),
      configTemplate,
      configFileName,
    );
    const archCreated = await writeIfNew(
      path.resolve(cwd, architectureFileName),
      architectureTemplate,
      architectureFileName,
    );

    if (configCreated || archCreated) {
      consola.info(
        "Next: run `aact check` to see violations, then `aact check --fix` to auto-fix.",
      );
    }
  },
});
