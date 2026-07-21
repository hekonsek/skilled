import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import {
  LocalSkillsRepositoryBuildConfigReader,
  LocalSkillsRepositoryDirectoryRemover,
  GitSkillsRepositoryChangesChecker,
  LocalSkillsRepositoryGitMetadataRemover,
  LocalSkillsRepositoryStore,
  SkillsRepositoriesService,
  type SkillsRepository,
  type SkillsRepositoryCloner,
  type SkillsRepositoryChangesChecker,
  type SkillsRepositoryDirectoryRemover,
  type SkillsRepositoryGitMetadataRemover,
  type SkillsRepositoryStore,
  type SkillsRepositoryUpdater,
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

describe("LocalSkillsRepositoryGitMetadataRemover", () => {
  it("removes the cloned repository git metadata directory", async () => {
    const root = await createTemporaryDirectory();
    const repositoryDirectory = join(root, "myorg-skills");
    await mkdir(join(repositoryDirectory, ".git", "objects"), { recursive: true });
    await writeFile(join(repositoryDirectory, ".git", "HEAD"), "ref: refs/heads/main");
    const remover = new LocalSkillsRepositoryGitMetadataRemover();

    await remover.removeGitMetadata(repositoryDirectory);

    assert.deepEqual(await readdir(repositoryDirectory), []);
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

  it("clones configured repositories into build output directories", async () => {
    const root = await createTemporaryDirectory();
    const operations: string[] = [];
    const events: string[] = [];
    const repositoryDirectoryRemover = new RecordingSkillsRepositoryDirectoryRemover(
      operations,
    );
    const cloner = new RecordingSkillsRepositoryCloner(operations);
    const gitMetadataRemover = new RecordingSkillsRepositoryGitMetadataRemover(
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
        repositoryDirectoryRemover,
        repositoryCloner: cloner,
        gitMetadataRemover,
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
            events.push(`repo-started ${event.repository.owner}/${event.repository.name}`);
          },
          onRepositoryDirectoryRemoved(event) {
            events.push(`repo-removed ${event.directory}`);
          },
          onRepositoryCloned(event) {
            events.push(`repo-cloned ${event.directory}`);
          },
          onRepositoryGitMetadataRemoved(event) {
            events.push(`repo-stripped ${event.directory}`);
          },
          onRepositoryBuildCompleted(event) {
            events.push(`repo-completed ${event.repository.owner}/${event.repository.name}`);
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
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "myorg", name: "skills" },
        destinationDirectory: join(root, "myorg-skills"),
      },
      {
        repository: { owner: "myuser", name: "myskills" },
        destinationDirectory: join(root, "myuser-myskills"),
      },
    ]);
    assert.deepEqual(repositoryDirectoryRemover.repositoryDirectories, [
      join(root, "myorg-skills"),
      join(root, "myuser-myskills"),
    ]);
    assert.deepEqual(gitMetadataRemover.repositoryDirectories, [
      join(root, "myorg-skills"),
      join(root, "myuser-myskills"),
    ]);
    assert.deepEqual(operations, [
      `remove ${join(root, "myorg-skills")}`,
      `clone myorg/skills ${join(root, "myorg-skills")}`,
      `strip-git ${join(root, "myorg-skills")}`,
      `remove ${join(root, "myuser-myskills")}`,
      `clone myuser/myskills ${join(root, "myuser-myskills")}`,
      `strip-git ${join(root, "myuser-myskills")}`,
    ]);
    assert.deepEqual(events, [
      `build-started ${root}`,
      "repo-started myorg/skills",
      "repo-removed myorg-skills",
      "repo-cloned myorg-skills",
      "repo-stripped myorg-skills",
      "repo-completed myorg/skills",
      "repo-started myuser/myskills",
      "repo-removed myuser-myskills",
      "repo-cloned myuser-myskills",
      "repo-stripped myuser-myskills",
      "repo-completed myuser/myskills",
      "build-completed 2",
    ]);
  });

  it("builds an installed repository from its local repository directory", async () => {
    const configDirectories: string[] = [];
    const cloner = new RecordingSkillsRepositoryCloner();
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
        repositoryCloner: cloner,
      },
    );

    await service.buildInstalledRepository({
      repositoryReference: "hekonsek/skilled-repo",
    });

    assert.deepEqual(configDirectories, [
      "/home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "myorg", name: "skills" },
        destinationDirectory:
          "/home/test/.skilled/repos/hekonsek/skilled-repo/myorg-skills",
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

class RecordingSkillsRepositoryGitMetadataRemover
  implements SkillsRepositoryGitMetadataRemover
{
  readonly repositoryDirectories: string[] = [];

  constructor(private readonly operations: string[] = []) {}

  async removeGitMetadata(repositoryDirectory: string): Promise<void> {
    this.repositoryDirectories.push(repositoryDirectory);
    this.operations.push(`strip-git ${repositoryDirectory}`);
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
