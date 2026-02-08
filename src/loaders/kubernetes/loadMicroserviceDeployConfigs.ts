import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { DeployConfig } from "./deployConfig";

const defaultDeploysPath = path.join(
  "resources/kubernetes",
  "microservices",
);

const getMicroserviceFilepaths = async (
  deploysPath?: string,
): Promise<string[]> => {
  const partialNamesToExclude = ["migrator", "platform", "citest", "tests"];
  const namesToExclude = new Set(["ignore.yml"]);

  const resolvedPath = path.resolve(
    process.cwd(),
    deploysPath ?? defaultDeploysPath,
  );

  const filenames = (await fs.readdir(resolvedPath, "utf8"))
    .filter((filename) =>
      new Set([".yml", ".yaml"]).has(path.extname(filename)),
    )
    .filter((filename) => !namesToExclude.has(filename))
    .filter((filename) =>
      partialNamesToExclude.every((toExclude) => !filename.includes(toExclude)),
    );

  return filenames.map((filename) => path.join(resolvedPath, filename));
};

interface RawDeployYaml {
  microservice?: RawDeployYaml;
  name?: string;
  fileName?: string;
  environment?: { [key: string]: object };
  sections?: { name: string; prod_value: string }[];
}

export const loadMicroserviceDeployConfigs = async (
  deploysPath?: string,
): Promise<DeployConfig[]> => {
  const filepaths = await getMicroserviceFilepaths(deploysPath);
  return Promise.all(
    filepaths.map(async (filePath): Promise<DeployConfig> => {
      const content = await fs.readFile(filePath, "utf8");
      let parsed = YAML.parse(
        content.replaceAll("env:", "environment:"),
      ) as RawDeployYaml;
      if (parsed.microservice) parsed = parsed.microservice;
      parsed.fileName = path.parse(filePath).name;
      return parsed as DeployConfig;
    }),
  );
};
