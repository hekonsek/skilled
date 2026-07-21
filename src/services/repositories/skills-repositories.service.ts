import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";
import { parse } from "yaml";

const execFile = promisify(execFileCallback);

export interface SkillsRepository {
  readonly owner: string;
  readonly name: string;
}

export interface SkillsRepositoryStore {
  listDownloadedRepositories(): Promise<readonly SkillsRepository[]>;
}

export interface SkillsRepositoryBuildConfig {
  readonly skills: readonly SkillsRepository[];
}

export interface SkillsRepositoryBuildConfigReader {
  readBuildConfig(repositoryDirectory: string): Promise<SkillsRepositoryBuildConfig>;
}

export interface SkillsRepositoryCloner {
  cloneRepository(repository: SkillsRepository, destinationDirectory: string): Promise<void>;
}

export interface SkillsRepositoryUpdater {
  updateRepository(repositoryDirectory: string): Promise<void>;
}

export interface InstallSkillsRepositoryOptions {
  readonly repositoryReference: string;
  readonly listener?: SkillsRepositoryInstallListener;
}

export interface SkillsRepositoryInstallListener {
  onInstallStarted?(event: SkillsRepositoryInstallEvent): void;
  onInstallCompleted?(event: SkillsRepositoryInstallEvent): void;
}

export interface SkillsRepositoryInstallEvent {
  readonly repository: SkillsRepository;
  readonly destinationDirectory: string;
  readonly operation: "install" | "update";
}

export interface InstallSkillsRepositoryResult {
  readonly repository: SkillsRepository;
  readonly destinationDirectory: string;
  readonly operation: "install" | "update";
}

export interface SkillsRepositoryGitMetadataRemover {
  removeGitMetadata(repositoryDirectory: string): Promise<void>;
}

export interface SkillsRepositoryDirectoryRemover {
  removeRepositoryDirectory(repositoryDirectory: string): Promise<void>;
}

export interface BuildSkillsRepositoryOptions {
  readonly repositoryDirectory: string;
  readonly listener?: SkillsRepositoryBuildListener;
}

export interface SkillsRepositoryBuildListener {
  onBuildStarted?(event: SkillsRepositoryBuildStartedEvent): void;
  onRepositoryBuildStarted?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositoryDirectoryRemoved?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositoryCloned?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositoryGitMetadataRemoved?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositoryBuildCompleted?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onBuildCompleted?(event: SkillsRepositoryBuildCompletedEvent): void;
}

export interface SkillsRepositoryBuildStartedEvent {
  readonly repositoryDirectory: string;
}

export interface SkillsRepositoryBuildRepositoryEvent {
  readonly repository: SkillsRepository;
  readonly directory: string;
  readonly destinationDirectory: string;
}

export interface SkillsRepositoryBuildCompletedEvent {
  readonly repositoryDirectory: string;
  readonly repositories: readonly BuiltSkillsRepository[];
}

export interface BuiltSkillsRepository {
  readonly repository: SkillsRepository;
  readonly directory: string;
}

export interface BuildSkillsRepositoryResult {
  readonly repositories: readonly BuiltSkillsRepository[];
}

export interface LocalSkillsRepositoryStoreOptions {
  readonly reposDirectory?: string;
}

export class LocalSkillsRepositoryStore implements SkillsRepositoryStore {
  private readonly reposDirectory: string;

  constructor(options: LocalSkillsRepositoryStoreOptions = {}) {
    this.reposDirectory = options.reposDirectory ?? defaultReposDirectory();
  }

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    const ownerDirectories = await readDirectories(this.reposDirectory);
    const repositories = await Promise.all(
      ownerDirectories.map(async (owner) => {
        const ownerPath = join(this.reposDirectory, owner);
        const names = await readDirectories(ownerPath);

        return names.map((name) => ({
          owner,
          name,
        }));
      }),
    );

    return repositories.flat().sort(compareRepositories);
  }
}

export class LocalSkillsRepositoryBuildConfigReader
  implements SkillsRepositoryBuildConfigReader
{
  async readBuildConfig(repositoryDirectory: string): Promise<SkillsRepositoryBuildConfig> {
    const configPath = join(repositoryDirectory, "skilled-repo.yml");
    const config = parse(await readFile(configPath, "utf8")) as unknown;

    return {
      skills: parseSkills(config),
    };
  }
}

export class GitSkillsRepositoryCloner implements SkillsRepositoryCloner {
  async cloneRepository(
    repository: SkillsRepository,
    destinationDirectory: string,
  ): Promise<void> {
    await mkdir(dirname(destinationDirectory), { recursive: true });
    await execFile("git", ["clone", repositoryUrl(repository), destinationDirectory]);
  }
}

export class GitSkillsRepositoryUpdater implements SkillsRepositoryUpdater {
  async updateRepository(repositoryDirectory: string): Promise<void> {
    await execFile("git", ["-C", repositoryDirectory, "pull", "--ff-only"]);
  }
}

export class LocalSkillsRepositoryGitMetadataRemover
  implements SkillsRepositoryGitMetadataRemover
{
  async removeGitMetadata(repositoryDirectory: string): Promise<void> {
    await rm(join(repositoryDirectory, ".git"), { recursive: true, force: true });
  }
}

export class LocalSkillsRepositoryDirectoryRemover
  implements SkillsRepositoryDirectoryRemover
{
  async removeRepositoryDirectory(repositoryDirectory: string): Promise<void> {
    await rm(repositoryDirectory, { recursive: true, force: true });
  }
}

export interface SkillsRepositoriesServiceOptions {
  readonly reposDirectory?: string;
  readonly buildConfigReader?: SkillsRepositoryBuildConfigReader;
  readonly repositoryCloner?: SkillsRepositoryCloner;
  readonly repositoryUpdater?: SkillsRepositoryUpdater;
  readonly gitMetadataRemover?: SkillsRepositoryGitMetadataRemover;
  readonly repositoryDirectoryRemover?: SkillsRepositoryDirectoryRemover;
}

export class SkillsRepositoriesService {
  private readonly logger: Logger;
  private readonly reposDirectory: string;
  private readonly buildConfigReader: SkillsRepositoryBuildConfigReader;
  private readonly repositoryCloner: SkillsRepositoryCloner;
  private readonly repositoryUpdater: SkillsRepositoryUpdater;
  private readonly gitMetadataRemover: SkillsRepositoryGitMetadataRemover;
  private readonly repositoryDirectoryRemover: SkillsRepositoryDirectoryRemover;

  constructor(
    private readonly repositoryStore: SkillsRepositoryStore,
    logger: Logger,
    options: SkillsRepositoriesServiceOptions = {},
  ) {
    this.logger = logger.child({ service: "skills-repositories" });
    this.reposDirectory = options.reposDirectory ?? defaultReposDirectory();
    this.buildConfigReader =
      options.buildConfigReader ?? new LocalSkillsRepositoryBuildConfigReader();
    this.repositoryCloner = options.repositoryCloner ?? new GitSkillsRepositoryCloner();
    this.repositoryUpdater = options.repositoryUpdater ?? new GitSkillsRepositoryUpdater();
    this.gitMetadataRemover =
      options.gitMetadataRemover ?? new LocalSkillsRepositoryGitMetadataRemover();
    this.repositoryDirectoryRemover =
      options.repositoryDirectoryRemover ?? new LocalSkillsRepositoryDirectoryRemover();
  }

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    this.logger.debug("listing downloaded skills repositories");

    return this.repositoryStore.listDownloadedRepositories();
  }

  async installRepository(
    options: InstallSkillsRepositoryOptions,
  ): Promise<InstallSkillsRepositoryResult> {
    const repository = parseRepositoryReference(options.repositoryReference);
    const destinationDirectory = join(
      this.reposDirectory,
      repository.owner,
      repository.name,
    );
    const downloadedRepositories = await this.repositoryStore.listDownloadedRepositories();
    const operation = downloadedRepositories.some(
      (downloadedRepository) =>
        downloadedRepository.owner === repository.owner &&
        downloadedRepository.name === repository.name,
    )
      ? "update"
      : "install";
    const event = { repository, destinationDirectory, operation } as const;

    this.logger.debug(
      { repository, destinationDirectory },
      "installing skills repository",
    );
    options.listener?.onInstallStarted?.(event);
    if (operation === "update") {
      await this.repositoryUpdater.updateRepository(destinationDirectory);
    } else {
      await this.repositoryCloner.cloneRepository(repository, destinationDirectory);
    }
    options.listener?.onInstallCompleted?.(event);

    return event;
  }

  async buildRepository(
    options: BuildSkillsRepositoryOptions,
  ): Promise<BuildSkillsRepositoryResult> {
    this.logger.debug(
      { repositoryDirectory: options.repositoryDirectory },
      "building skills repository",
    );

    options.listener?.onBuildStarted?.({
      repositoryDirectory: options.repositoryDirectory,
    });

    const config = await this.buildConfigReader.readBuildConfig(options.repositoryDirectory);
    const repositories = config.skills.map((repository) => ({
      repository,
      directory: destinationDirectoryName(repository),
    }));

    for (const builtRepository of repositories) {
      const destinationDirectory = join(
        options.repositoryDirectory,
        builtRepository.directory,
      );
      const event = {
        ...builtRepository,
        destinationDirectory,
      };

      options.listener?.onRepositoryBuildStarted?.(event);
      await this.repositoryDirectoryRemover.removeRepositoryDirectory(
        destinationDirectory,
      );
      options.listener?.onRepositoryDirectoryRemoved?.(event);
      await this.repositoryCloner.cloneRepository(
        builtRepository.repository,
        destinationDirectory,
      );
      options.listener?.onRepositoryCloned?.(event);
      await this.gitMetadataRemover.removeGitMetadata(destinationDirectory);
      options.listener?.onRepositoryGitMetadataRemoved?.(event);
      options.listener?.onRepositoryBuildCompleted?.(event);
    }

    options.listener?.onBuildCompleted?.({
      repositoryDirectory: options.repositoryDirectory,
      repositories,
    });

    return { repositories };
  }
}

async function readDirectories(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function compareRepositories(
  left: SkillsRepository,
  right: SkillsRepository,
): number {
  return `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`);
}

function parseSkills(config: unknown): readonly SkillsRepository[] {
  if (!isRecord(config)) {
    throw new Error("Expected skilled-repo.yml to contain an object.");
  }

  const skills = config.skills;
  if (!Array.isArray(skills)) {
    throw new Error("Expected skilled-repo.yml to contain a skills list.");
  }

  return skills.map(parseRepositoryReference);
}

function parseRepositoryReference(reference: unknown): SkillsRepository {
  if (typeof reference !== "string") {
    throw new Error("Expected each skill repository reference to be a string.");
  }

  const [owner, name, extra] = reference.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    extra !== undefined ||
    !isValidOwner(owner) ||
    !isValidRepositoryName(name)
  ) {
    throw new Error(`Invalid skill repository reference: ${reference}`);
  }

  return { owner, name };
}

function destinationDirectoryName(repository: SkillsRepository): string {
  return `${repository.owner}-${repository.name}`;
}

function repositoryUrl(repository: SkillsRepository): string {
  return `https://github.com/${repository.owner}/${repository.name}`;
}

function defaultReposDirectory(): string {
  return join(homedir(), ".skilled", "repos");
}

function isValidOwner(owner: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(owner);
}

function isValidRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
