import type { Format } from "../types";
import { generate } from "./generate";
import { load } from "./load";
import { structurizrDslSyntax } from "./syntax";

/**
 * Structurizr формат. Loader принимает `workspace.json` и `workspace.dsl`.
 * Generator эмитит `workspace.dsl` (DSL — основной authoring surface; JSON
 * генерируется upstream через `structurizr-cli export`). Fix-функции пишут
 * в `workspace.dsl` (через `AactConfig.source.writePath`).
 */
export const structurizrFormat: Format = {
  name: "structurizr",
  defaultPattern: "workspace.json",
  load,
  generate,
  fix: { syntax: structurizrDslSyntax },
};
