import { defineCommand, runMain } from "citty";

import { version } from "../../package.json";
import { analyze } from "./commands/analyze";
import { check } from "./commands/check";
import { generate } from "./commands/generate";
import { init } from "./commands/init";
import { rule } from "./commands/rule";
import { skill } from "./commands/skill";

const main = defineCommand({
  meta: {
    name: "aact",
    version,
    description: "Architecture analysis and compliance tool",
  },
  subCommands: { init, check, analyze, generate, rule, skill },
});

void runMain(main);
