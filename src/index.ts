#!/usr/bin/env node

import { createRequire } from "node:module";
import { createCli } from "./adapters/in/cli/cli.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

await createCli({
  version: packageJson.version,
}).parseAsync(process.argv);
