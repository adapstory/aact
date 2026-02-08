import fs from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";
import consola from "consola";

const template = `import { defineConfig } from "aact";

export default defineConfig({
  // Source of architecture description
  source: {
    type: "structurizr", // "plantuml" | "structurizr"
    path: "./workspace.json",
  },

  // Validation rules (true = enabled with defaults, false = disabled)
  rules: {
    acl: true, // Anti-Corruption Layer: only tagged containers depend on externals
    // acl: { tag: "acl", externalType: "System_Ext" },

    acyclic: true, // No circular dependencies

    crud: true, // Only repo/relay containers access databases
    // crud: { repoTags: ["repo", "relay"], dbType: "ContainerDb" },

    dbPerService: true, // Each database accessed by single service
    // dbPerService: { dbType: "ContainerDb" },

    cohesion: true, // Boundary cohesion > coupling
    // cohesion: { externalType: "System_Ext", internalType: "Container" },
  },

  // PlantUML generation from Kubernetes configs (aact generate)
  // generate: {
  //   kubernetes: {
  //     path: "resources/kubernetes/microservices",
  //   },
  //   boundaryLabel: "Our system",
  // },
});
`;

const configFileName = "aact.config.ts";

export const init = defineCommand({
  meta: { description: "Create aact.config.ts with default settings" },
  async run() {
    const configPath = path.resolve(process.cwd(), configFileName);

    try {
      await fs.access(configPath);
      consola.warn(`${configFileName} already exists. Skipping.`);
      return;
    } catch {
      // File does not exist — proceed
    }

    await fs.writeFile(configPath, template);
    consola.success(`Created ${configFileName}`);
  },
});
