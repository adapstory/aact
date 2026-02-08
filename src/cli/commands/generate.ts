import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "c12";
import { defineCommand } from "citty";
import consola from "consola";

import type { AactConfig } from "../../config";
import { generateKubernetes } from "../../generators/kubernetes";
import { generatePlantuml } from "../../generators/plantuml";
import { loadMicroserviceDeployConfigs } from "../../loaders/kubernetes/loadMicroserviceDeployConfigs";
import { mapFromConfigs } from "../../loaders/kubernetes/mapContainersFromDeployConfigs";
import { loadModel } from "../loadModel";

const runPlantuml = async (
  config: AactConfig | undefined,
  outputPath?: string,
): Promise<void> => {
  const kubernetesPath = config?.generate?.kubernetes?.path;
  const configs = mapFromConfigs(
    await loadMicroserviceDeployConfigs(kubernetesPath),
  );
  const puml = generatePlantuml(configs, {
    boundaryLabel: config?.generate?.boundaryLabel,
  });

  if (outputPath) {
    await fs.writeFile(outputPath, puml);
    consola.success(`Written to ${outputPath}`);
  } else {
    console.log(puml);
  }
};

const runKubernetes = async (
  config: AactConfig,
  outputDir?: string,
): Promise<void> => {
  const model = await loadModel(config);
  const outputs = generateKubernetes(model);

  const targetDir =
    outputDir ??
    config.generate?.kubernetes?.path ??
    "resources/kubernetes/microservices";

  await fs.mkdir(targetDir, { recursive: true });

  for (const output of outputs) {
    const filePath = path.join(targetDir, output.fileName);
    await fs.writeFile(filePath, output.content);
  }

  consola.success(
    `Generated ${outputs.length} file(s) in ${targetDir}`,
  );
};

export const generate = defineCommand({
  meta: { description: "Generate architecture artifacts" },
  args: {
    output: {
      type: "string",
      description: "Output path (file for plantuml, directory for kubernetes)",
    },
    format: {
      type: "string",
      description: "Output format: plantuml, kubernetes",
    },
  },
  async run({ args }) {
    const { config } = await loadConfig<AactConfig>({ name: "aact" });
    const format = args.format ?? "plantuml";

    switch (format) {
      case "plantuml": {
        await runPlantuml(config, args.output);
        break;
      }
      case "kubernetes": {
        if (!config?.source) {
          throw new Error(
            "No source configured. Create an aact.config.ts file.",
          );
        }
        await runKubernetes(config, args.output);
        break;
      }
      default: {
        throw new Error(`Unknown format: ${format}`);
      }
    }
  },
});
