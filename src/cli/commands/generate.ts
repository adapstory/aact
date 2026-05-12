import fs from "node:fs/promises";

import { defineCommand } from "citty";
import consola from "consola";
import path from "pathe";

import { loadFormat } from "../../formats/registry";
import { canGenerate } from "../../formats/types";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

/**
 * Generate command — Model → format artefact. Использует format registry,
 * формат self-describes capability через `canGenerate`. Output dispatch
 * через unified `FormatOutput.files` — single-file (PlantUML/Mermaid) или
 * multi-file (k8s manifests). Stdout если output не задан И один файл.
 */
export const generate = defineCommand({
  meta: { description: "Generate architecture artifacts" },
  args: {
    config: {
      type: "string",
      description: "Path to aact config file",
    },
    output: {
      type: "string",
      description: "Output path (file for single output, directory for multi)",
    },
    format: {
      type: "string",
      description: "Target format name (plantuml, kubernetes, ...)",
    },
  },
  async run({ args }) {
    const config = await loadAndValidateConfig(args.config);
    const { model } = await loadModel(config);

    const formatName = args.format ?? "plantuml";
    const format = await loadFormat(formatName);

    if (!canGenerate(format)) {
      throw new Error(`Format "${format.name}" doesn't support generate`);
    }

    const output = format.generate(model);

    if (output.files.length === 0) {
      consola.warn("Generator produced no files");
      return;
    }

    // Single-file output: write to args.output (file) или stdout.
    if (output.files.length === 1) {
      const file = output.files[0];
      if (args.output) {
        await fs.writeFile(args.output, file.content);
        consola.success(`Written to ${args.output}`);
      } else {
        console.log(file.content);
      }
      return;
    }

    // Multi-file output: write each file под `args.output` directory.
    const targetDir =
      args.output ??
      config.generate?.kubernetes?.path ??
      "fixtures/kubernetes/microservices";

    await fs.mkdir(targetDir, { recursive: true });
    await Promise.all(
      output.files.map((f) =>
        fs.writeFile(path.join(targetDir, f.path), f.content),
      ),
    );

    consola.success(`Generated ${output.files.length} file(s) in ${targetDir}`);
  },
});
