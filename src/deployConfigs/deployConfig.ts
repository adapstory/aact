import { Section } from "../entities";

export interface EnvValue {
  prod?: string;
  default?: string;
}

export interface DeployConfig {
  name: string;
  fileName?: string;
  readonly environment?: Record<string, EnvValue>;
  sections: Section[];
}
