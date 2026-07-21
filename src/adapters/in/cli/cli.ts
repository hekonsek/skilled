import process from "node:process";
import chalk from "chalk";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";
import pino, { type LevelWithSilent } from "pino";
import {
  type SkillsRepositoryBuildListener,
  type SkillsRepositoryBuildConfigReader,
  type SkillsRepositoryCloner,
  type SkillsRepositoryDirectoryRemover,
  type SkillsRepositoryChangesChecker,
  type SkillsRepositoryInstallListener,
  type SkillsRepository,
  type SkillsRepositoryUpdater,
  type SkillsRepositoryActivator,
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
  readonly repositoryDirectoryRemover?: SkillsRepositoryDirectoryRemover;
  readonly repositoryChangesChecker?: SkillsRepositoryChangesChecker;
  readonly repositoryUpdater?: SkillsRepositoryUpdater;
  readonly repositoryActivator?: SkillsRepositoryActivator;
  readonly reposDirectory?: string;
  readonly skillsDirectory?: string;
  readonly currentDirectory?: string;
}

interface GlobalOptions {
  readonly logger: LevelWithSilent;
}

interface BuildCommandOptions {
  readonly dir?: string;
  readonly installedRepo?: string;
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
    .command("install")
    .description("Download a skills repository onto this device.")
    .argument("<repository>", "GitHub repository in owner/name format")
    .action(async (repositoryReference: string) => {
      const globalOptions = program.opts<GlobalOptions>();
      const logger = pino(
        { level: globalOptions.logger },
        pino.destination({ dest: 2, sync: true }),
      ).child({ adapter: "cli", command: "repo install" });
      const repositoryStore =
        options.repositoryStore ??
        new LocalSkillsRepositoryStore({ reposDirectory: options.reposDirectory });
      const service = new SkillsRepositoriesService(repositoryStore, logger, {
        reposDirectory: options.reposDirectory,
        repositoryCloner: options.repositoryCloner,
        repositoryUpdater: options.repositoryUpdater,
        repositoryChangesChecker: options.repositoryChangesChecker,
        repositoryDirectoryRemover: options.repositoryDirectoryRemover,
      });

      await service.installRepository({
        repositoryReference,
        listener: createInstallProgressRenderer(stdout, stderr),
      });
    });

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
    .command("use")
    .description("Use an installed skills repository.")
    .argument("<repository>", "installed repository in owner/name format")
    .action(async (repositoryReference: string) => {
      const globalOptions = program.opts<GlobalOptions>();
      const logger = pino(
        { level: globalOptions.logger },
        pino.destination({ dest: 2, sync: true }),
      ).child({ adapter: "cli", command: "repo use" });
      const service = new SkillsRepositoriesService(
        options.repositoryStore ??
          new LocalSkillsRepositoryStore({ reposDirectory: options.reposDirectory }),
        logger,
        {
          reposDirectory: options.reposDirectory,
          skillsDirectory: options.skillsDirectory,
          repositoryActivator: options.repositoryActivator,
        },
      );

      const result = await service.useRepository({ repositoryReference });
      stdout.write(`${repositoryMarker(stdout)} ${repositoryReference}\n`);
      stderr.write(
        `${successMarker(stderr)} Using ${repositoryReference} at ${result.skillsDirectory}.\n`,
      );
    });

  repo
    .command("build")
    .description("Build the skills repository in the current directory.")
    .addOption(
      new Option("--dir <directory>", "root directory of the skills monorepo").conflicts(
        "installedRepo",
      ),
    )
    .addOption(
      new Option(
        "--installed-repo <repository>",
        "locally installed repository in owner/name format",
      ).conflicts("dir"),
    )
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
          reposDirectory: options.reposDirectory,
          buildConfigReader: options.buildConfigReader,
          repositoryCloner: options.repositoryCloner,
          repositoryDirectoryRemover: options.repositoryDirectoryRemover,
        },
      );
      const buildProgress = createBuildProgressRenderer(stdout, stderr);
      if (buildOptions.installedRepo !== undefined) {
        await service.buildInstalledRepository({
          repositoryReference: buildOptions.installedRepo,
          listener: buildProgress.listener,
        });
      } else {
        await service.buildRepository({
          repositoryDirectory:
            buildOptions.dir ?? options.currentDirectory ?? process.cwd(),
          listener: buildProgress.listener,
        });
      }
    });

  return program;
}

interface BuildProgressRenderer {
  readonly listener: SkillsRepositoryBuildListener;
}

function createInstallProgressRenderer(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): SkillsRepositoryInstallListener {
  let spinner: Ora | undefined;

  if (shouldUseSpinner(stderr)) {
    return {
      onInstallStarted(event) {
        spinner = ora({
          stream: stderr,
          text: installProgressMessage(event),
        }).start();
      },
      onInstallCompleted(event) {
        stdout.write(
          `${repositoryMarker(stdout)} ${repositoryReference(event.repository)}\n`,
        );
        spinner?.succeed(installCompletedMessage(event));
      },
    };
  }

  return {
    onInstallStarted(event) {
      stderr.write(
        `${progressMarker(stderr)} ${installProgressMessage(event)}\n`,
      );
    },
    onInstallCompleted(event) {
      stdout.write(
        `${repositoryMarker(stdout)} ${repositoryReference(event.repository)}\n`,
      );
      stderr.write(
        `${successMarker(stderr)} ${installCompletedMessage(event)}\n`,
      );
    },
  };
}

function installProgressMessage(event: {
  readonly repository: SkillsRepository;
  readonly operation: "install" | "update";
}): string {
  const action = event.operation === "update" ? "Updating" : "Downloading";

  return `${action} ${repositoryReference(event.repository)}`;
}

function installCompletedMessage(event: {
  readonly repository: SkillsRepository;
  readonly operation: "install" | "update";
}): string {
  const action = event.operation === "update" ? "Updated" : "Downloaded";

  return `${action} ${repositoryReference(event.repository)}.`;
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
