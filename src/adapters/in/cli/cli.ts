import process from "node:process";
import chalk from "chalk";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";
import pino, { type LevelWithSilent } from "pino";
import {
  type SkillsRepositoryBuildListener,
  type SkillsRepositoryBuildConfigReader,
  type SkillsRepositoryCloner,
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
  readonly buildConfigReader?: SkillsRepositoryBuildConfigReader;
  readonly repositoryCloner?: SkillsRepositoryCloner;
  readonly currentDirectory?: string;
}

interface GlobalOptions {
  readonly logger: LevelWithSilent;
}

interface BuildCommandOptions {
  readonly dir?: string;
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

  repo
    .command("build")
    .description("Build the skills repository in the current directory.")
    .option("--dir <directory>", "root directory of the skills monorepo")
    .action(async (buildOptions: BuildCommandOptions) => {
      const globalOptions = program.opts<GlobalOptions>();
      const logger = pino(
        { level: globalOptions.logger },
        pino.destination({ dest: 2, sync: true }),
      ).child({ adapter: "cli", command: "repo build" });

      const service = new SkillsRepositoriesService(
        options.repositoryStore ?? new LocalSkillsRepositoryStore(),
        logger,
        {
          buildConfigReader: options.buildConfigReader,
          repositoryCloner: options.repositoryCloner,
        },
      );
      const buildProgress = createBuildProgressRenderer(stdout, stderr);
      await service.buildRepository({
        repositoryDirectory:
          buildOptions.dir ?? options.currentDirectory ?? process.cwd(),
        listener: buildProgress.listener,
      });
    });

  return program;
}

interface BuildProgressRenderer {
  readonly listener: SkillsRepositoryBuildListener;
}

function createBuildProgressRenderer(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): BuildProgressRenderer {
  if (shouldUseSpinner(stderr)) {
    return createSpinnerBuildProgressRenderer(stdout, stderr);
  }

  return createLineBuildProgressRenderer(stdout, stderr);
}

function createSpinnerBuildProgressRenderer(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): BuildProgressRenderer {
  let spinner: Ora | undefined;

  return {
    listener: {
      onBuildStarted(event) {
        spinner = ora({
          stream: stderr,
          text: `Building skills repository in ${event.repositoryDirectory}`,
        }).start();
      },
      onRepositoryBuildStarted(event) {
        updateSpinner(spinner, `Preparing ${repositoryReference(event.repository)}`);
      },
      onRepositoryCloned(event) {
        stdout.write(
          `${repositoryMarker(stdout)} ${repositoryReference(event.repository)}\n`,
        );
        updateSpinner(spinner, `Cloned ${repositoryReference(event.repository)}`);
      },
      onRepositoryGitMetadataRemoved(event) {
        updateSpinner(spinner, `Stripped Git metadata from ${event.directory}`);
      },
      onRepositoryBuildCompleted(event) {
        updateSpinner(spinner, `Built ${repositoryReference(event.repository)}`);
      },
      onBuildCompleted(event) {
        spinner?.succeed(`Built ${event.repositories.length} skills repositories.`);
      },
    },
  };
}

function createLineBuildProgressRenderer(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): BuildProgressRenderer {
  return {
    listener: {
      onBuildStarted(event) {
        stderr.write(
          `${progressMarker(stderr)} Building skills repository in ${event.repositoryDirectory}\n`,
        );
      },
      onRepositoryBuildStarted(event) {
        stderr.write(
          `${progressMarker(stderr)} Preparing ${repositoryReference(event.repository)}\n`,
        );
      },
      onRepositoryCloned(event) {
        stdout.write(
          `${repositoryMarker(stdout)} ${repositoryReference(event.repository)}\n`,
        );
        stderr.write(
          `${progressMarker(stderr)} Cloned ${repositoryReference(event.repository)}\n`,
        );
      },
      onRepositoryGitMetadataRemoved(event) {
        stderr.write(
          `${progressMarker(stderr)} Stripped Git metadata from ${event.directory}\n`,
        );
      },
      onRepositoryBuildCompleted(event) {
        stderr.write(
          `${successMarker(stderr)} Built ${repositoryReference(event.repository)}\n`,
        );
      },
      onBuildCompleted(event) {
        stderr.write(
          `${successMarker(stderr)} Built ${event.repositories.length} skills repositories.\n`,
        );
      },
    },
  };
}

function updateSpinner(spinner: Ora | undefined, text: string): void {
  if (spinner !== undefined) {
    spinner.text = text;
  }
}

function repositoryMarker(stdout: NodeJS.WritableStream): string {
  return isInteractiveOutput(stdout) ? chalk.green("📦") : "📦";
}

function progressMarker(stderr: NodeJS.WritableStream): string {
  return isInteractiveOutput(stderr) ? chalk.cyan("•") : "•";
}

function successMarker(stderr: NodeJS.WritableStream): string {
  return isInteractiveOutput(stderr) ? chalk.green("✓") : "✓";
}

function repositoryReference(repository: {
  readonly owner: string;
  readonly name: string;
}): string {
  return `${repository.owner}/${repository.name}`;
}

function isInteractiveOutput(stream: NodeJS.WritableStream): boolean {
  return "isTTY" in stream && stream.isTTY === true;
}

function shouldUseSpinner(stderr: NodeJS.WritableStream): boolean {
  return isInteractiveOutput(stderr) && process.env.CI === undefined;
}
