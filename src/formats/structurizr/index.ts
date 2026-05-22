import type { Format } from "../types";
import { generate } from "./generate";
import { load } from "./load";
import { structurizrDslSyntax } from "./syntax";

/**
 * Structurizr формат. Loader принимает `workspace.json` и `*.dsl`.
 * Generator эмитит `workspace.dsl` (DSL — основной authoring surface;
 * JSON генерируется upstream через `structurizr-cli export`).
 *
 * Fix mechanism:
 *  - JSON-source → `writePath` ОБЯЗАТЕЛЕН (loader читает JSON, но
 *    range-edit semantics выровнены только с DSL — пишем в .dsl).
 *  - DSL-source → `writePath` optional, по умолчанию `source.path`
 *    (правки идут обратно в тот же DSL файл).
 *
 * Auto-detect priority: `workspace.json` exact > `*.dsl` extension.
 * Любой DSL-файл (`workspace.dsl`, `architecture.dsl`, `c4.dsl`)
 * подхватывается без явного `type: "structurizr"`.
 */
export const structurizrFormat: Format = {
  name: "structurizr",
  defaultPattern: ["workspace.json", "*.dsl"],
  load,
  generate,
  fix: { syntax: structurizrDslSyntax },
};
