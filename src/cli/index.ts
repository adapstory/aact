import { defineCommand, runMain } from "citty";

import { analyze } from "./commands/analyze";
import { check } from "./commands/check";
import { generate } from "./commands/generate";
import { init } from "./commands/init";

const main = defineCommand({
  meta: {
    name: "aact",
    version: "2.0.2",
    description: "Architecture analysis and compliance tool",
  },
  subCommands: { init, check, analyze, generate },
});

void runMain(main);
