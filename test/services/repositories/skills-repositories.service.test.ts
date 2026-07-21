import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import {
  LocalSkillsRepositoryBuildConfigReader,
  LocalSkillsRepositoryDirectoryRemover,
  LocalSkillsRepositoryActivator,
  GitSkillsRepositoryChangesChecker,
  GitSkillsRepositoryCloner,
  GitSkillsRepositorySubmoduleManager,
  GitSkillsRepositoryUpdater,
  LocalSkillsRepositoryStore,
  SkillsRepositoriesService,
  type SkillsRepository,
  type SkillsRepositoryCloner,
  type SkillsRepositoryChangesChecker,
  type SkillsRepositoryDirectoryRemover,
  type SkillsRepositorySubmodule,
  type SkillsRepositorySubmoduleManager,
  type SkillsRepositoryStore,
  type SkillsRepositoryUpdater,
  type SkillsRepositoryActivator,
} from "../../../src/services/repositories/skills-repositories.service.js";

const temporaryDirectories: string[] = [];

describe("LocalSkillsRepositoryStore", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("lists owner and repository directories from the configured repos directory", async () => {
    const root = await createTemporaryDirectory();
    const reposDirectory = join(root, ".skilled", "repos");
    await mkdir(join(reposDirectory, "myorg", "skills"), { recursive: true });
    await mkdir(join(reposDirectory, "myuser", "myskills"), { recursive: true });
    await writeFile(join(reposDirectory, "myorg", "README.md"), "not a repository directory");

    const store = new LocalSkillsRepositoryStore({ reposDirectory });

    assert.deepEqual(await store.listDownloadedRepositories(), [
      { owner: "myorg", name: "skills" },
      { owner: "myuser", name: "myskills" },
    ]);
  });

  it("returns an empty list when the repos directory does not exist", async () => {
    const root = await createTemporaryDirectory();
    const store = new LocalSkillsRepositoryStore({
      reposDirectory: join(root, ".skilled", "repos"),
    });

    assert.deepEqual(await store.listDownloadedRepositories(), []);
  });
});

describe("LocalSkillsRepositoryBuildConfigReader", () => {
  it("reads skill repositories from skilled-repo.yml", async () => {
    const root = await createTemporaryDirectory();
    await writeFile(
      join(root, "skilled-repo.yml"),
      ["skills:", "  - myorg/skills", "  - myuser/myskills"].join("\n"),
    );
    const reader = new LocalSkillsRepositoryBuildConfigReader();

    assert.deepEqual(await reader.readBuildConfig(root), {
      skills: [
        { owner: "myorg", name: "skills" },
        { owner: "myuser", name: "myskills" },
      ],
    });
  });
});

describe("LocalSkillsRepositoryDirectoryRemover", () => {
  it("removes an existing repository output directory", async () => {
    const root = await createTemporaryDirectory();
    const repositoryDirectory = join(root, "myorg-skills");
    await mkdir(repositoryDirectory, { recursive: true });
    await writeFile(join(repositoryDirectory, "README.md"), "old content");
    const remover = new LocalSkillsRepositoryDirectoryRemover();

    await remover.removeRepositoryDirectory(repositoryDirectory);

    assert.deepEqual(await readdir(root), []);
  });
});

describe("LocalSkillsRepositoryActivator", () => {
  it("creates the skills symlink and replaces an existing symlink", async () => {
    const root = await createTemporaryDirectory();
    const firstRepository = join(root, ".skilled", "repos", "myorg", "skills");
    const secondRepository = join(root, ".skilled", "repos", "myuser", "skills");
    const skillsDirectory = join(root, ".agents", "skills");
    await mkdir(firstRepository, { recursive: true });
    await mkdir(secondRepository, { recursive: true });
    const activator = new LocalSkillsRepositoryActivator();

    await activator.activateRepository(firstRepository, skillsDirectory);
    assert.equal(await readlink(skillsDirectory), firstRepository);

    await activator.activateRepository(secondRepository, skillsDirectory);
    assert.equal(await readlink(skillsDirectory), secondRepository);
  });

  it("does not replace an existing real skills directory", async () => {
    const root = await createTemporaryDirectory();
    const repositoryDirectory = join(root, ".skilled", "repos", "myorg", "skills");
    const skillsDirectory = join(root, ".agents", "skills");
    await mkdir(repositoryDirectory, { recursive: true });
    await mkdir(skillsDirectory, { recursive: true });
    await writeFile(join(skillsDirectory, "local-skill.md"), "keep me");
    const activator = new LocalSkillsRepositoryActivator();

    await assert.rejects(
      activator.activateRepository(repositoryDirectory, skillsDirectory),
    );
    assert.deepEqual(await readdir(skillsDirectory), ["local-skill.md"]);
  });
});

describe("GitSkillsRepositoryChangesChecker", () => {
  it("detects uncommitted files in a Git repository", async () => {
    const root = await createTemporaryDirectory();
    await runGit(root, "init");
    const checker = new GitSkillsRepositoryChangesChecker();

    assert.equal(await checker.hasUncommittedChanges(root), false);

    await writeFile(join(root, "README.md"), "uncommitted content");

    assert.equal(await checker.hasUncommittedChanges(root), true);
  });
});

describe("GitSkillsRepositorySubmoduleManager", () => {
  it("adds, updates, checks, and removes a Git submodule", async () => {
    const root = await createTemporaryDirectory();

    await withAllowedFileProtocol(async () => {
      const upstream = join(root, "upstream");
      const parent = join(root, "parent");
      await mkdir(upstream);
      await mkdir(parent);
      await initializeGitRepository(upstream);
      await writeFile(join(upstream, "README.md"), "first version");
      await runGit(upstream, "add", "README.md");
      await runGit(upstream, "commit", "-m", "first version");
      await initializeGitRepository(parent);
      await writeFile(join(parent, "skilled-repo.yml"), "skills: []\n");
      await runGit(parent, "add", "skilled-repo.yml");
      await runGit(parent, "commit", "-m", "initialize parent");

      const manager = new GitSkillsRepositorySubmoduleManager({
        resolveRepositoryUrl: () => upstream,
      });

      assert.deepEqual(await manager.listSubmodules(parent), []);
      await manager.addSubmodule(
        parent,
        { owner: "myorg", name: "skills" },
        "myorg-skills",
      );
      const [submodule] = await manager.listSubmodules(parent);
      assert.deepEqual(submodule, {
        name: "myorg-skills",
        directory: "myorg-skills",
      });
      assert.equal(
        await manager.hasUncommittedChanges(parent, submodule!),
        false,
      );

      await writeFile(join(upstream, "README.md"), "second version");
      await runGit(upstream, "add", "README.md");
      await runGit(upstream, "commit", "-m", "second version");
      await manager.updateSubmodule(
        parent,
        { owner: "myorg", name: "skills" },
        submodule!,
      );
      assert.equal(
        await readFile(join(parent, "myorg-skills", "README.md"), "utf8"),
        "second version",
      );

      await writeFile(join(parent, "myorg-skills", "README.md"), "local change");
      assert.equal(
        await manager.hasUncommittedChanges(parent, submodule!),
        true,
      );
      await runGit(parent, "-C", "myorg-skills", "checkout", "--", "README.md");

      await manager.removeSubmodule(parent, submodule!);
      assert.deepEqual(await manager.listSubmodules(parent), []);
      assert.equal((await readdir(parent)).includes("myorg-skills"), false);
    });
  });

  it("rejects a build directory that is not a Git working tree", async () => {
    const root = await createTemporaryDirectory();
    const manager = new GitSkillsRepositorySubmoduleManager();

    await assert.rejects(
      manager.listSubmodules(root),
      /Not a Git working tree:/,
    );
  });
});

describe("Git skills repository install adapters", () => {
  it("recursively clones and updates submodule contents", async () => {
    const root = await createTemporaryDirectory();

    await withAllowedFileProtocol(async () => {
      const upstream = join(root, "upstream");
      const parent = join(root, "parent");
      const installed = join(root, "installed");
      await mkdir(upstream);
      await mkdir(parent);
      await initializeGitRepository(upstream);
      await writeFile(join(upstream, "README.md"), "first version");
      await runGit(upstream, "add", "README.md");
      await runGit(upstream, "commit", "-m", "first version");
      await initializeGitRepository(parent);
      await writeFile(join(parent, "skilled-repo.yml"), "skills: []\n");
      await runGit(parent, "add", "skilled-repo.yml");
      await runGit(parent, "commit", "-m", "initialize parent");

      const manager = new GitSkillsRepositorySubmoduleManager({
        resolveRepositoryUrl: () => upstream,
      });
      await manager.addSubmodule(
        parent,
        { owner: "myorg", name: "skills" },
        "myorg-skills",
      );
      await runGit(parent, "commit", "-m", "add skills submodule");

      const cloner = new GitSkillsRepositoryCloner({
        resolveRepositoryUrl: () => parent,
      });
      await cloner.cloneRepository(
        { owner: "myorg", name: "aggregate-skills" },
        installed,
      );
      assert.equal(
        await readFile(join(installed, "myorg-skills", "README.md"), "utf8"),
        "first version",
      );
      const changesChecker = new GitSkillsRepositoryChangesChecker();
      assert.equal(await changesChecker.hasUncommittedChanges(installed), false);
      await writeFile(
        join(installed, "myorg-skills", "README.md"),
        "installed local change",
      );
      assert.equal(await changesChecker.hasUncommittedChanges(installed), true);
      await runGit(installed, "-C", "myorg-skills", "checkout", "--", "README.md");

      await writeFile(join(upstream, "README.md"), "second version");
      await runGit(upstream, "add", "README.md");
      await runGit(upstream, "commit", "-m", "second version");
      const [submodule] = await manager.listSubmodules(parent);
      await manager.updateSubmodule(
        parent,
        { owner: "myorg", name: "skills" },
        submodule!,
      );
      await runGit(parent, "add", "myorg-skills");
      await runGit(parent, "commit", "-m", "update skills submodule");

      const updater = new GitSkillsRepositoryUpdater();
      await updater.updateRepository(installed);
      assert.equal(
        await readFile(join(installed, "myorg-skills", "README.md"), "utf8"),
        "second version",
      );
    });
  });
});

describe("SkillsRepositoriesService", () => {
  it("returns repositories from the configured store", async () => {
    const store: SkillsRepositoryStore = {
      async listDownloadedRepositories() {
        return [{ owner: "myorg", name: "skills" }];
      },
    };
    const service = new SkillsRepositoriesService(store, pino({ level: "silent" }));

    assert.deepEqual(await service.listDownloadedRepositories(), [
      { owner: "myorg", name: "skills" },
    ]);
  });

  it("installs a repository from an owner/name reference", async () => {
    const cloner = new RecordingSkillsRepositoryCloner();
    const events: string[] = [];
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      {
        reposDirectory: "/home/test/.skilled/repos",
        repositoryCloner: cloner,
      },
    );

    assert.deepEqual(
      await service.installRepository({
        repositoryReference: "hekonsek/skilled-repo",
        listener: {
          onInstallStarted(event) {
            events.push(`started ${event.repository.owner}/${event.repository.name}`);
          },
          onInstallCompleted(event) {
            events.push(`completed ${event.destinationDirectory}`);
          },
        },
      }),
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        operation: "install",
      },
    );
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
      },
    ]);
    assert.deepEqual(events, [
      "started hekonsek/skilled-repo",
      "completed /home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
  });

  it("updates an installed repository in place", async () => {
    const cloner = new RecordingSkillsRepositoryCloner();
    const updater = new RecordingSkillsRepositoryUpdater();
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      pino({ level: "silent" }),
      {
        reposDirectory: "/home/test/.skilled/repos",
        repositoryCloner: cloner,
        repositoryUpdater: updater,
        repositoryChangesChecker: new StaticSkillsRepositoryChangesChecker(false),
      },
    );

    assert.deepEqual(
      await service.installRepository({
        repositoryReference: "hekonsek/skilled-repo",
      }),
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        operation: "update",
      },
    );
    assert.deepEqual(cloner.cloneRequests, []);
    assert.deepEqual(updater.repositoryDirectories, [
      "/home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
  });

  it("replaces an installed repository when it has uncommitted changes", async () => {
    const operations: string[] = [];
    const cloner = new RecordingSkillsRepositoryCloner(operations);
    const updater = new RecordingSkillsRepositoryUpdater();
    const remover = new RecordingSkillsRepositoryDirectoryRemover(operations);
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      pino({ level: "silent" }),
      {
        reposDirectory: "/home/test/.skilled/repos",
        repositoryCloner: cloner,
        repositoryUpdater: updater,
        repositoryChangesChecker: new StaticSkillsRepositoryChangesChecker(true),
        repositoryDirectoryRemover: remover,
      },
    );

    assert.deepEqual(
      await service.installRepository({
        repositoryReference: "hekonsek/skilled-repo",
      }),
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        operation: "update",
      },
    );
    assert.deepEqual(updater.repositoryDirectories, []);
    assert.deepEqual(operations, [
      "remove /home/test/.skilled/repos/hekonsek/skilled-repo",
      "clone hekonsek/skilled-repo /home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
  });

  it("rejects an invalid repository reference before cloning", async () => {
    const cloner = new RecordingSkillsRepositoryCloner();
    const updater = new RecordingSkillsRepositoryUpdater();
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      { repositoryCloner: cloner, repositoryUpdater: updater },
    );

    await assert.rejects(
      service.installRepository({ repositoryReference: "invalid" }),
      /Invalid skill repository reference: invalid/,
    );
    assert.deepEqual(cloner.cloneRequests, []);
    assert.deepEqual(updater.repositoryDirectories, []);
  });

  it("uses an installed repository as the agents skills directory", async () => {
    const activator = new RecordingSkillsRepositoryActivator();
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      pino({ level: "silent" }),
      {
        reposDirectory: "/home/test/.skilled/repos",
        skillsDirectory: "/home/test/.agents/skills",
        repositoryActivator: activator,
      },
    );

    assert.deepEqual(
      await service.useRepository({ repositoryReference: "hekonsek/skilled-repo" }),
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        repositoryDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        skillsDirectory: "/home/test/.agents/skills",
      },
    );
    assert.deepEqual(activator.activationRequests, [
      {
        repositoryDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        skillsDirectory: "/home/test/.agents/skills",
      },
    ]);
  });

  it("rejects using a repository that is not installed", async () => {
    const activator = new RecordingSkillsRepositoryActivator();
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      { repositoryActivator: activator },
    );

    await assert.rejects(
      service.useRepository({ repositoryReference: "hekonsek/skilled-repo" }),
      /Skills repository is not installed: hekonsek\/skilled-repo/,
    );
    assert.deepEqual(activator.activationRequests, []);
  });

  it("adds, updates, and removes submodules to match the build config", async () => {
    const root = await createTemporaryDirectory();
    const operations: string[] = [];
    const events: string[] = [];
    const submoduleManager = new RecordingSkillsRepositorySubmoduleManager(
      [
        { name: "myorg-skills", directory: "myorg-skills" },
        { name: "obsolete-skills", directory: "obsolete-skills" },
      ],
      new Set(),
      operations,
    );
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      {
        buildConfigReader: {
          async readBuildConfig() {
            return {
              skills: [
                { owner: "myorg", name: "skills" },
                { owner: "myuser", name: "myskills" },
              ],
            };
          },
        },
        submoduleManager,
      },
    );

    assert.deepEqual(
      await service.buildRepository({
        repositoryDirectory: root,
        listener: {
          onBuildStarted(event) {
            events.push(`build-started ${event.repositoryDirectory}`);
          },
          onRepositoryBuildStarted(event) {
            events.push(
              `repo-started ${event.operation} ${event.repository.owner}/${event.repository.name}`,
            );
          },
          onRepositorySubmoduleAdded(event) {
            events.push(`repo-added ${event.directory}`);
          },
          onRepositorySubmoduleUpdated(event) {
            events.push(`repo-updated ${event.directory}`);
          },
          onRepositoryBuildCompleted(event) {
            events.push(`repo-completed ${event.repository.owner}/${event.repository.name}`);
          },
          onSubmoduleRemovalStarted(event) {
            events.push(`removal-started ${event.directory}`);
          },
          onSubmoduleRemoved(event) {
            events.push(`removed ${event.directory}`);
          },
          onBuildCompleted(event) {
            events.push(`build-completed ${event.repositories.length}`);
          },
        },
      }),
      {
        repositories: [
          {
            repository: { owner: "myorg", name: "skills" },
            directory: "myorg-skills",
          },
          {
            repository: { owner: "myuser", name: "myskills" },
            directory: "myuser-myskills",
          },
        ],
      },
    );
    assert.deepEqual(operations, [
      `list ${root}`,
      `changes ${root} myorg-skills`,
      `update ${root} myorg/skills myorg-skills`,
      `add ${root} myuser/myskills myuser-myskills`,
      `changes ${root} obsolete-skills`,
      `remove ${root} obsolete-skills`,
    ]);
    assert.deepEqual(events, [
      `build-started ${root}`,
      "repo-started update myorg/skills",
      "repo-updated myorg-skills",
      "repo-completed myorg/skills",
      "repo-started add myuser/myskills",
      "repo-added myuser-myskills",
      "repo-completed myuser/myskills",
      "removal-started obsolete-skills",
      "removed obsolete-skills",
      "build-completed 2",
    ]);
  });

  it("rejects updating a submodule with uncommitted changes", async () => {
    const root = await createTemporaryDirectory();
    const operations: string[] = [];
    const submoduleManager = new RecordingSkillsRepositorySubmoduleManager(
      [{ name: "myorg-skills", directory: "myorg-skills" }],
      new Set(["myorg-skills"]),
      operations,
    );
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      {
        buildConfigReader: {
          async readBuildConfig() {
            return { skills: [{ owner: "myorg", name: "skills" }] };
          },
        },
        submoduleManager,
      },
    );

    await assert.rejects(
      service.buildRepository({ repositoryDirectory: root }),
      /Git submodule has uncommitted changes: myorg-skills/,
    );
    assert.deepEqual(operations, [
      `list ${root}`,
      `changes ${root} myorg-skills`,
    ]);
  });

  it("builds an installed repository from its local repository directory", async () => {
    const configDirectories: string[] = [];
    const submoduleManager = new RecordingSkillsRepositorySubmoduleManager();
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      {
        reposDirectory: "/home/test/.skilled/repos",
        buildConfigReader: {
          async readBuildConfig(repositoryDirectory) {
            configDirectories.push(repositoryDirectory);

            return { skills: [{ owner: "myorg", name: "skills" }] };
          },
        },
        submoduleManager,
      },
    );

    await service.buildInstalledRepository({
      repositoryReference: "hekonsek/skilled-repo",
    });

    assert.deepEqual(configDirectories, [
      "/home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
    assert.deepEqual(submoduleManager.addRequests, [
      {
        repositoryDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        repository: { owner: "myorg", name: "skills" },
        submoduleDirectory: "myorg-skills",
      },
    ]);
  });

  it("rejects an invalid installed repository reference before building", async () => {
    const service = new SkillsRepositoriesService(
      new StaticSkillsRepositoryStore([]),
      pino({ level: "silent" }),
      { reposDirectory: "/home/test/.skilled/repos" },
    );

    await assert.rejects(
      service.buildInstalledRepository({ repositoryReference: "invalid" }),
      /Invalid skill repository reference: invalid/,
    );
  });
});

class StaticSkillsRepositoryStore implements SkillsRepositoryStore {
  constructor(private readonly repositories: readonly SkillsRepository[]) {}

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    return this.repositories;
  }
}

class RecordingSkillsRepositoryCloner implements SkillsRepositoryCloner {
  readonly cloneRequests: {
    readonly repository: SkillsRepository;
    readonly destinationDirectory: string;
  }[] = [];

  constructor(private readonly operations: string[] = []) {}

  async cloneRepository(
    repository: SkillsRepository,
    destinationDirectory: string,
  ): Promise<void> {
    this.cloneRequests.push({ repository, destinationDirectory });
    this.operations.push(
      `clone ${repository.owner}/${repository.name} ${destinationDirectory}`,
    );
  }
}

class RecordingSkillsRepositoryDirectoryRemover
  implements SkillsRepositoryDirectoryRemover
{
  readonly repositoryDirectories: string[] = [];

  constructor(private readonly operations: string[] = []) {}

  async removeRepositoryDirectory(repositoryDirectory: string): Promise<void> {
    this.repositoryDirectories.push(repositoryDirectory);
    this.operations.push(`remove ${repositoryDirectory}`);
  }
}

class StaticSkillsRepositoryChangesChecker
  implements SkillsRepositoryChangesChecker
{
  constructor(private readonly hasChanges: boolean) {}

  async hasUncommittedChanges(): Promise<boolean> {
    return this.hasChanges;
  }
}

class RecordingSkillsRepositoryUpdater implements SkillsRepositoryUpdater {
  readonly repositoryDirectories: string[] = [];

  async updateRepository(repositoryDirectory: string): Promise<void> {
    this.repositoryDirectories.push(repositoryDirectory);
  }
}

class RecordingSkillsRepositorySubmoduleManager
  implements SkillsRepositorySubmoduleManager
{
  readonly addRequests: {
    readonly repositoryDirectory: string;
    readonly repository: SkillsRepository;
    readonly submoduleDirectory: string;
  }[] = [];

  constructor(
    private readonly submodules: readonly SkillsRepositorySubmodule[] = [],
    private readonly dirtySubmodules: ReadonlySet<string> = new Set(),
    private readonly operations: string[] = [],
  ) {}

  async listSubmodules(
    repositoryDirectory: string,
  ): Promise<readonly SkillsRepositorySubmodule[]> {
    this.operations.push(`list ${repositoryDirectory}`);
    return this.submodules;
  }

  async hasUncommittedChanges(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<boolean> {
    this.operations.push(`changes ${repositoryDirectory} ${submodule.directory}`);
    return this.dirtySubmodules.has(submodule.directory);
  }

  async addSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submoduleDirectory: string,
  ): Promise<void> {
    this.addRequests.push({
      repositoryDirectory,
      repository,
      submoduleDirectory,
    });
    this.operations.push(
      `add ${repositoryDirectory} ${repository.owner}/${repository.name} ${submoduleDirectory}`,
    );
  }

  async updateSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void> {
    this.operations.push(
      `update ${repositoryDirectory} ${repository.owner}/${repository.name} ${submodule.directory}`,
    );
  }

  async removeSubmodule(
    repositoryDirectory: string,
    submodule: SkillsRepositorySubmodule,
  ): Promise<void> {
    this.operations.push(`remove ${repositoryDirectory} ${submodule.directory}`);
  }
}

class RecordingSkillsRepositoryActivator implements SkillsRepositoryActivator {
  readonly activationRequests: {
    readonly repositoryDirectory: string;
    readonly skillsDirectory: string;
  }[] = [];

  async activateRepository(
    repositoryDirectory: string,
    skillsDirectory: string,
  ): Promise<void> {
    this.activationRequests.push({ repositoryDirectory, skillsDirectory });
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "skilled-test-"));
  temporaryDirectories.push(path);

  return path;
}

async function runGit(directory: string, ...args: readonly string[]): Promise<void> {
  const { execFile } = await import("node:child_process");

  await new Promise<void>((resolve, reject) => {
    execFile("git", ["-C", directory, ...args], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function initializeGitRepository(directory: string): Promise<void> {
  await runGit(directory, "init", "--initial-branch", "main");
  await runGit(directory, "config", "user.name", "Skilled Tests");
  await runGit(directory, "config", "user.email", "tests@skilled.local");
}

async function withAllowedFileProtocol(action: () => Promise<void>): Promise<void> {
  const originalAllowedProtocols = process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_ALLOW_PROTOCOL = "file";

  try {
    await action();
  } finally {
    if (originalAllowedProtocols === undefined) {
      delete process.env.GIT_ALLOW_PROTOCOL;
    } else {
      process.env.GIT_ALLOW_PROTOCOL = originalAllowedProtocols;
    }
  }
}
