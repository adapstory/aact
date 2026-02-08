import { loadConfig } from "c12";
import * as v from "valibot";

import { AactConfigSchema, type AactConfig } from "../config";

export const loadAndValidateConfig = async (): Promise<AactConfig> => {
  const { config } = await loadConfig({ name: "aact" });
  if (!config) {
    throw new Error("No source configured. Create an aact.config.ts file.");
  }
  return v.parse(AactConfigSchema, config);
};
