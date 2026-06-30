import process from "node:process";
import chalk from "chalk";
import { Command, Option } from "commander";
import pino, { type LevelWithSilent } from "pino";
import {
  LocalSkillsRepositoryStore,
  SkillsRepositoriesService,
  type SkillsRepositoryStore,
} from "../../../services/repositories/skills-repositories.service.js";

const loggerLevels = [
  "silent",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const satisfies readonly LevelWithSilent[];

export interface CreateCliOptions {
  readonly version: string;
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
  readonly repositoryStore?: SkillsRepositoryStore;
}

interface GlobalOptions {
  readonly logger: LevelWithSilent;
}

export function createCli(options: CreateCliOptions): Command {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const program = new Command()
    .name("skilled")
    .description("Work with agentic AI skills.")
    .addOption(
      new Option("--logger <level>", "set diagnostic logging level")
        .choices([...loggerLevels])
        .default("silent"),
    );

  program
    .command("version")
    .description("Print the current skilled version.")
    .action(() => {
      stdout.write(`${options.version}\n`);
    });

  const repo = program.command("repo").description("Manage skills repositories.");

  repo
    .command("list")
    .description("List skills repositories downloaded on this device.")
    .action(async () => {
      const globalOptions = program.opts<GlobalOptions>();
      const logger = pino(
        { level: globalOptions.logger },
        pino.destination({ dest: 2, sync: true }),
      ).child({ adapter: "cli", command: "repo list" });

      const service = new SkillsRepositoriesService(
        options.repositoryStore ?? new LocalSkillsRepositoryStore(),
        logger,
      );
      const repositories = await service.listDownloadedRepositories();

      for (const repository of repositories) {
        stdout.write(`${repositoryMarker(stdout)} ${repository.owner}/${repository.name}\n`);
      }

      if (repositories.length === 0) {
        stderr.write("No skills repositories downloaded.\n");
      }
    });

  return program;
}

function repositoryMarker(stdout: NodeJS.WritableStream): string {
  return isInteractiveOutput(stdout) ? chalk.green("📦") : "📦";
}

function isInteractiveOutput(stdout: NodeJS.WritableStream): boolean {
  return "isTTY" in stdout && stdout.isTTY === true;
}
