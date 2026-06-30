import { Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCli } from "../../../../src/adapters/in/cli/cli.js";
import type {
  SkillsRepositoryBuildConfig,
  SkillsRepositoryBuildConfigReader,
  SkillsRepositoryCloner,
  SkillsRepository,
  SkillsRepositoryStore,
} from "../../../../src/services/repositories/skills-repositories.service.js";

describe("createCli", () => {
  it("prints the current version", async () => {
    const stdout = new MemoryWritable();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr: new MemoryWritable(),
    }).parseAsync(["node", "skilled", "version"]);

    assert.equal(stdout.toString(), "1.2.3\n");
  });

  it("prints downloaded repositories", async () => {
    const stdout = new MemoryWritable();
    const store = new StaticSkillsRepositoryStore([
      { owner: "myorg", name: "skills" },
      { owner: "myuser", name: "myskills" },
    ]);

    await createCli({
      version: "1.2.3",
      stdout,
      stderr: new MemoryWritable(),
      repositoryStore: store,
    }).parseAsync(["node", "skilled", "repo", "list"]);

    assert.equal(stdout.toString(), "📦 myorg/skills\n📦 myuser/myskills\n");
  });

  it("builds a skills repository from the configured directory", async () => {
    const stdout = new MemoryWritable();
    const cloner = new RecordingSkillsRepositoryCloner();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr: new MemoryWritable(),
      repositoryStore: new StaticSkillsRepositoryStore([]),
      buildConfigReader: new StaticSkillsRepositoryBuildConfigReader({
        skills: [
          { owner: "myorg", name: "skills" },
          { owner: "myuser", name: "myskills" },
        ],
      }),
      repositoryCloner: cloner,
    }).parseAsync(["node", "skilled", "repo", "build", "--dir", "/workspace/skills"]);

    assert.equal(
      stdout.toString(),
      "📦 myorg/skills -> myorg-skills\n📦 myuser/myskills -> myuser-myskills\n",
    );
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "myorg", name: "skills" },
        destinationDirectory: "/workspace/skills/myorg-skills",
      },
      {
        repository: { owner: "myuser", name: "myskills" },
        destinationDirectory: "/workspace/skills/myuser-myskills",
      },
    ]);
  });

  it("lists the build directory option in help output", async () => {
    const program = createCli({
      version: "1.2.3",
      stdout: new MemoryWritable(),
      stderr: new MemoryWritable(),
    });
    const repoCommand = program.commands.find((command) => command.name() === "repo");
    const buildCommand = repoCommand?.commands.find(
      (command) => command.name() === "build",
    );

    assert.match(buildCommand?.helpInformation() ?? "", /--dir <directory>/);
  });
});

class StaticSkillsRepositoryStore implements SkillsRepositoryStore {
  constructor(private readonly repositories: readonly SkillsRepository[]) {}

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    return this.repositories;
  }
}

class StaticSkillsRepositoryBuildConfigReader
  implements SkillsRepositoryBuildConfigReader
{
  constructor(private readonly buildConfig: SkillsRepositoryBuildConfig) {}

  async readBuildConfig(): Promise<SkillsRepositoryBuildConfig> {
    return this.buildConfig;
  }
}

class RecordingSkillsRepositoryCloner implements SkillsRepositoryCloner {
  readonly cloneRequests: {
    readonly repository: SkillsRepository;
    readonly destinationDirectory: string;
  }[] = [];

  async cloneRepository(
    repository: SkillsRepository,
    destinationDirectory: string,
  ): Promise<void> {
    this.cloneRequests.push({ repository, destinationDirectory });
  }
}

class MemoryWritable extends Writable {
  private readonly chunks: Buffer[] = [];

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  override toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
