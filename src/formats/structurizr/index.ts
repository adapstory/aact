import type { Format } from "../types";
import { load } from "./load";
import { structurizrDslSyntax } from "./syntax";

/**
 * Structurizr формат. Load из workspace.json, generate пока не реализован
 * (Structurizr DSL renderer — нетривиальная задача, обычно пользователи
 * редактируют DSL руками и пускают `structurizr-cli` для рендера в json).
 * Fix-функции пишут в workspace.dsl (через AactConfig.source.writePath).
 */
export const structurizrFormat: Format = {
  name: "structurizr",
  defaultPattern: "workspace.json",
  load,
  fix: { syntax: structurizrDslSyntax },
};
