import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
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

export interface SkillsRepositoryChangesChecker {
  hasUncommittedChanges(repositoryDirectory: string): Promise<boolean>;
}

export interface SkillsRepositorySubmodule {
  readonly name: string;
  readonly directory: string;
}

export interface SkillsRepositorySubmoduleManager {
  listSubmodules(
    repositoryDirectory: string,
  ): Promise<readonly SkillsRepositorySubmodule[]>;
  hasUncommittedChanges(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<boolean>;
  addSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submoduleDirectory: string,
  ): Promise<void>;
  updateSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void>;
  removeSubmodule(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void>;
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

export interface SkillsRepositoryDirectoryRemover {
  removeRepositoryDirectory(repositoryDirectory: string): Promise<void>;
}

export interface SkillsRepositoryActivator {
  activateRepository(
    repositoryDirectory: string,
    skillsDirectory: string,
  ): Promise<void>;
}

export interface UseSkillsRepositoryOptions {
  readonly repositoryReference: string;
}

export interface UseSkillsRepositoryResult {
  readonly repository: SkillsRepository;
  readonly repositoryDirectory: string;
  readonly skillsDirectory: string;
}

export interface BuildSkillsRepositoryOptions {
  readonly repositoryDirectory: string;
  readonly listener?: SkillsRepositoryBuildListener;
}

export interface BuildInstalledSkillsRepositoryOptions {
  readonly repositoryReference: string;
  readonly listener?: SkillsRepositoryBuildListener;
}

export interface SkillsRepositoryBuildListener {
  onBuildStarted?(event: SkillsRepositoryBuildStartedEvent): void;
  onRepositoryBuildStarted?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositorySubmoduleAdded?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositorySubmoduleUpdated?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onRepositoryBuildCompleted?(event: SkillsRepositoryBuildRepositoryEvent): void;
  onSubmoduleRemovalStarted?(event: SkillsRepositoryBuildSubmoduleRemovalEvent): void;
  onSubmoduleRemoved?(event: SkillsRepositoryBuildSubmoduleRemovalEvent): void;
  onBuildCompleted?(event: SkillsRepositoryBuildCompletedEvent): void;
}

export interface SkillsRepositoryBuildStartedEvent {
  readonly repositoryDirectory: string;
}

export interface SkillsRepositoryBuildRepositoryEvent {
  readonly repository: SkillsRepository;
  readonly directory: string;
  readonly destinationDirectory: string;
  readonly operation: "add" | "update";
}

export interface SkillsRepositoryBuildSubmoduleRemovalEvent {
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
  private readonly resolveRepositoryUrl: (repository: SkillsRepository) => string;

  constructor(
    options: {
      readonly resolveRepositoryUrl?: (repository: SkillsRepository) => string;
    } = {},
  ) {
    this.resolveRepositoryUrl = options.resolveRepositoryUrl ?? repositoryUrl;
  }

  async cloneRepository(
    repository: SkillsRepository,
    destinationDirectory: string,
  ): Promise<void> {
    await mkdir(dirname(destinationDirectory), { recursive: true });
    await execFile("git", [
      "clone",
      "--recurse-submodules",
      this.resolveRepositoryUrl(repository),
      destinationDirectory,
    ]);
  }
}

export class GitSkillsRepositoryUpdater implements SkillsRepositoryUpdater {
  async updateRepository(repositoryDirectory: string): Promise<void> {
    await execFile("git", ["-C", repositoryDirectory, "pull", "--ff-only"]);
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "sync",
      "--recursive",
    ]);
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "update",
      "--init",
      "--recursive",
    ]);
  }
}

export class GitSkillsRepositoryChangesChecker
  implements SkillsRepositoryChangesChecker
{
  async hasUncommittedChanges(repositoryDirectory: string): Promise<boolean> {
    const { stdout } = await execFile("git", [
      "-C",
      repositoryDirectory,
      "status",
      "--porcelain",
    ]);

    return stdout.length > 0;
  }
}

export class GitSkillsRepositorySubmoduleManager
  implements SkillsRepositorySubmoduleManager
{
  private readonly resolveRepositoryUrl: (repository: SkillsRepository) => string;

  constructor(
    options: {
      readonly resolveRepositoryUrl?: (repository: SkillsRepository) => string;
    } = {},
  ) {
    this.resolveRepositoryUrl = options.resolveRepositoryUrl ?? repositoryUrl;
  }

  async listSubmodules(
    repositoryDirectory: string,
  ): Promise<readonly SkillsRepositorySubmodule[]> {
    let isWorkingTree: string;
    try {
      ({ stdout: isWorkingTree } = await execFile("git", [
        "-C",
        repositoryDirectory,
        "rev-parse",
        "--is-inside-work-tree",
      ]));
    } catch (error) {
      throw new Error(`Not a Git working tree: ${repositoryDirectory}`, {
        cause: error,
      });
    }
    if (isWorkingTree.trim() !== "true") {
      throw new Error(`Not a Git working tree: ${repositoryDirectory}`);
    }

    try {
      const { stdout } = await execFile("git", [
        "-C",
        repositoryDirectory,
        "config",
        "--file",
        ".gitmodules",
        "--get-regexp",
        "^submodule\\..*\\.path$",
      ]);

      const submodules = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map(parseSubmoduleConfigLine);
      for (const submodule of submodules) {
        resolvePathWithin(
          repositoryDirectory,
          submodule.directory,
          "Git submodule directory",
        );
      }

      return submodules;
    } catch (error) {
      if (isProcessExitError(error, 1)) {
        return [];
      }

      throw error;
    }
  }

  async hasUncommittedChanges(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<boolean> {
    const { stdout } = await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "status",
      "--",
      submodule.directory,
    ]);
    if (stdout.startsWith("-")) {
      return false;
    }

    const { stdout: status } = await execFile("git", [
      "-C",
      resolvePathWithin(
        repositoryDirectory,
        submodule.directory,
        "Git submodule directory",
      ),
      "status",
      "--porcelain",
    ]);

    return status.length > 0;
  }

  async addSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submoduleDirectory: string,
  ): Promise<void> {
    resolvePathWithin(
      repositoryDirectory,
      submoduleDirectory,
      "Git submodule directory",
    );
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "add",
      this.resolveRepositoryUrl(repository),
      submoduleDirectory,
    ]);
  }

  async updateSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void> {
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "config",
      "--file",
      ".gitmodules",
      `submodule.${submodule.name}.url`,
      this.resolveRepositoryUrl(repository),
    ]);
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "sync",
      "--",
      submodule.directory,
    ]);
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "update",
      "--init",
      "--",
      submodule.directory,
    ]);

    const submoduleWorkingTree = resolvePathWithin(
      repositoryDirectory,
      submodule.directory,
      "Git submodule directory",
    );
    await execFile("git", ["-C", submoduleWorkingTree, "fetch", "origin"]);
    await execFile("git", [
      "-C",
      submoduleWorkingTree,
      "remote",
      "set-head",
      "origin",
      "--auto",
    ]);
    const { stdout: remoteHead } = await execFile("git", [
      "-C",
      submoduleWorkingTree,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    await execFile("git", [
      "-C",
      submoduleWorkingTree,
      "checkout",
      "--detach",
      remoteHead.trim(),
    ]);
  }

  async removeSubmodule(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void> {
    resolvePathWithin(
      repositoryDirectory,
      submodule.directory,
      "Git submodule directory",
    );
    const { stdout: gitDirectoryOutput } = await execFile("git", [
      "-C",
      repositoryDirectory,
      "rev-parse",
      "--absolute-git-dir",
    ]);
    const modulesDirectory = resolve(gitDirectoryOutput.trim(), "modules");
    const submoduleGitDirectory = resolvePathWithin(
      modulesDirectory,
      submodule.name,
      "Git submodule name",
    );

    await execFile("git", [
      "-C",
      repositoryDirectory,
      "submodule",
      "deinit",
      "--force",
      "--",
      submodule.directory,
    ]);
    await execFile("git", [
      "-C",
      repositoryDirectory,
      "rm",
      "--force",
      "--",
      submodule.directory,
    ]);

    await rm(submoduleGitDirectory, { recursive: true, force: true });
  }
}

export class LocalSkillsRepositoryDirectoryRemover
  implements SkillsRepositoryDirectoryRemover
{
  async removeRepositoryDirectory(repositoryDirectory: string): Promise<void> {
    await rm(repositoryDirectory, { recursive: true, force: true });
  }
}

export class LocalSkillsRepositoryActivator
  implements SkillsRepositoryActivator
{
  async activateRepository(
    repositoryDirectory: string,
    skillsDirectory: string,
  ): Promise<void> {
    await mkdir(dirname(skillsDirectory), { recursive: true });
    await rm(skillsDirectory, { force: true });
    await symlink(repositoryDirectory, skillsDirectory, "dir");
  }
}

export interface SkillsRepositoriesServiceOptions {
  readonly reposDirectory?: string;
  readonly skillsDirectory?: string;
  readonly buildConfigReader?: SkillsRepositoryBuildConfigReader;
  readonly repositoryCloner?: SkillsRepositoryCloner;
  readonly repositoryUpdater?: SkillsRepositoryUpdater;
  readonly repositoryChangesChecker?: SkillsRepositoryChangesChecker;
  readonly submoduleManager?: SkillsRepositorySubmoduleManager;
  readonly repositoryDirectoryRemover?: SkillsRepositoryDirectoryRemover;
  readonly repositoryActivator?: SkillsRepositoryActivator;
}

export class SkillsRepositoriesService {
  private readonly logger: Logger;
  private readonly reposDirectory: string;
  private readonly skillsDirectory: string;
  private readonly buildConfigReader: SkillsRepositoryBuildConfigReader;
  private readonly repositoryCloner: SkillsRepositoryCloner;
  private readonly repositoryUpdater: SkillsRepositoryUpdater;
  private readonly repositoryChangesChecker: SkillsRepositoryChangesChecker;
  private readonly submoduleManager: SkillsRepositorySubmoduleManager;
  private readonly repositoryDirectoryRemover: SkillsRepositoryDirectoryRemover;
  private readonly repositoryActivator: SkillsRepositoryActivator;

  constructor(
    private readonly repositoryStore: SkillsRepositoryStore,
    logger: Logger,
    options: SkillsRepositoriesServiceOptions = {},
  ) {
    this.logger = logger.child({ service: "skills-repositories" });
    this.reposDirectory = options.reposDirectory ?? defaultReposDirectory();
    this.skillsDirectory = options.skillsDirectory ?? defaultSkillsDirectory();
    this.buildConfigReader =
      options.buildConfigReader ?? new LocalSkillsRepositoryBuildConfigReader();
    this.repositoryCloner = options.repositoryCloner ?? new GitSkillsRepositoryCloner();
    this.repositoryUpdater = options.repositoryUpdater ?? new GitSkillsRepositoryUpdater();
    this.repositoryChangesChecker =
      options.repositoryChangesChecker ?? new GitSkillsRepositoryChangesChecker();
    this.submoduleManager =
      options.submoduleManager ?? new GitSkillsRepositorySubmoduleManager();
    this.repositoryDirectoryRemover =
      options.repositoryDirectoryRemover ?? new LocalSkillsRepositoryDirectoryRemover();
    this.repositoryActivator =
      options.repositoryActivator ?? new LocalSkillsRepositoryActivator();
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
      if (
        await this.repositoryChangesChecker.hasUncommittedChanges(
          destinationDirectory,
        )
      ) {
        await this.repositoryDirectoryRemover.removeRepositoryDirectory(
          destinationDirectory,
        );
        await this.repositoryCloner.cloneRepository(repository, destinationDirectory);
      } else {
        await this.repositoryUpdater.updateRepository(destinationDirectory);
      }
    } else {
      await this.repositoryCloner.cloneRepository(repository, destinationDirectory);
    }
    options.listener?.onInstallCompleted?.(event);

    return event;
  }

  async useRepository(
    options: UseSkillsRepositoryOptions,
  ): Promise<UseSkillsRepositoryResult> {
    const repository = parseRepositoryReference(options.repositoryReference);
    const downloadedRepositories = await this.repositoryStore.listDownloadedRepositories();
    const installed = downloadedRepositories.some(
      (downloadedRepository) =>
        downloadedRepository.owner === repository.owner &&
        downloadedRepository.name === repository.name,
    );
    if (!installed) {
      throw new Error(`Skills repository is not installed: ${options.repositoryReference}`);
    }

    const repositoryDirectory = join(
      this.reposDirectory,
      repository.owner,
      repository.name,
    );
    this.logger.debug(
      { repository, repositoryDirectory, skillsDirectory: this.skillsDirectory },
      "using skills repository",
    );
    await this.repositoryActivator.activateRepository(
      repositoryDirectory,
      this.skillsDirectory,
    );

    return {
      repository,
      repositoryDirectory,
      skillsDirectory: this.skillsDirectory,
    };
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
    const existingSubmodules = await this.submoduleManager.listSubmodules(
      options.repositoryDirectory,
    );
    const submodulesByDirectory = new Map(
      existingSubmodules.map((submodule) => [submodule.directory, submodule]),
    );

    for (const builtRepository of repositories) {
      const destinationDirectory = join(
        options.repositoryDirectory,
        builtRepository.directory,
      );
      const existingSubmodule = submodulesByDirectory.get(builtRepository.directory);
      const event: SkillsRepositoryBuildRepositoryEvent = {
        ...builtRepository,
        destinationDirectory,
        operation: existingSubmodule === undefined ? "add" : "update",
      };

      options.listener?.onRepositoryBuildStarted?.(event);
      if (existingSubmodule === undefined) {
        await this.submoduleManager.addSubmodule(
          options.repositoryDirectory,
          builtRepository.repository,
          builtRepository.directory,
        );
        submodulesByDirectory.set(builtRepository.directory, {
          name: builtRepository.directory,
          directory: builtRepository.directory,
        });
        options.listener?.onRepositorySubmoduleAdded?.(event);
      } else {
        await this.assertSubmoduleHasNoChanges(
          options.repositoryDirectory,
          existingSubmodule,
        );
        await this.submoduleManager.updateSubmodule(
          options.repositoryDirectory,
          builtRepository.repository,
          existingSubmodule,
        );
        options.listener?.onRepositorySubmoduleUpdated?.(event);
      }
      options.listener?.onRepositoryBuildCompleted?.(event);
    }

    const configuredDirectories = new Set(
      repositories.map((repository) => repository.directory),
    );
    for (const submodule of existingSubmodules) {
      if (configuredDirectories.has(submodule.directory)) {
        continue;
      }

      const event = {
        directory: submodule.directory,
        destinationDirectory: join(
          options.repositoryDirectory,
          submodule.directory,
        ),
      };
      options.listener?.onSubmoduleRemovalStarted?.(event);
      await this.assertSubmoduleHasNoChanges(
        options.repositoryDirectory,
        submodule,
      );
      await this.submoduleManager.removeSubmodule(
        options.repositoryDirectory,
        submodule,
      );
      options.listener?.onSubmoduleRemoved?.(event);
    }

    options.listener?.onBuildCompleted?.({
      repositoryDirectory: options.repositoryDirectory,
      repositories,
    });

    return { repositories };
  }

  private async assertSubmoduleHasNoChanges(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void> {
    if (
      await this.submoduleManager.hasUncommittedChanges(
        repositoryDirectory,
        submodule,
      )
    ) {
      throw new Error(
        `Git submodule has uncommitted changes: ${submodule.directory}`,
      );
    }
  }

  async buildInstalledRepository(
    options: BuildInstalledSkillsRepositoryOptions,
  ): Promise<BuildSkillsRepositoryResult> {
    const repository = parseRepositoryReference(options.repositoryReference);

    return this.buildRepository({
      repositoryDirectory: join(
        this.reposDirectory,
        repository.owner,
        repository.name,
      ),
      listener: options.listener,
    });
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

function parseSubmoduleConfigLine(line: string): SkillsRepositorySubmodule {
  const match = /^(submodule\.(.+)\.path)\s+(.+)$/.exec(line);
  if (match === null || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid Git submodule configuration: ${line}`);
  }

  return {
    name: match[2],
    directory: match[3],
  };
}

function resolvePathWithin(
  parentDirectory: string,
  childPath: string,
  description: string,
): string {
  const resolvedParent = resolve(parentDirectory);
  const resolvedChild = resolve(resolvedParent, childPath);
  const relativeChild = relative(resolvedParent, resolvedChild);
  if (
    relativeChild === "" ||
    relativeChild === ".." ||
    relativeChild.startsWith(`..${sep}`)
  ) {
    throw new Error(`Invalid ${description}: ${childPath}`);
  }

  return resolvedChild;
}

function defaultReposDirectory(): string {
  return join(homedir(), ".skilled", "repos");
}

function defaultSkillsDirectory(): string {
  return join(homedir(), ".agents", "skills");
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

function isProcessExitError(error: unknown, code: number): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
