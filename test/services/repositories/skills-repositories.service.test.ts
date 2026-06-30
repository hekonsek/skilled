import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import {
  LocalSkillsRepositoryBuildConfigReader,
  LocalSkillsRepositoryDirectoryRemover,
  LocalSkillsRepositoryGitMetadataRemover,
  LocalSkillsRepositoryStore,
  SkillsRepositoriesService,
  type SkillsRepository,
  type SkillsRepositoryCloner,
  type SkillsRepositoryDirectoryRemover,
  type SkillsRepositoryGitMetadataRemover,
  type SkillsRepositoryStore,
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

  it("clones configured repositories into build output directories", async () => {
    const root = await createTemporaryDirectory();
    const operations: string[] = [];
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

    assert.deepEqual(await service.buildRepository({ repositoryDirectory: root }), {
      repositories: [
        { repository: { owner: "myorg", name: "skills" }, directory: "myorg-skills" },
        { repository: { owner: "myuser", name: "myskills" }, directory: "myuser-myskills" },
      ],
    });
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
