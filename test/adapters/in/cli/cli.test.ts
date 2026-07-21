import { Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCli } from "../../../../src/adapters/in/cli/cli.js";
import type {
  SkillsRepositoryBuildConfig,
  SkillsRepositoryBuildConfigReader,
  SkillsRepositoryChangesChecker,
  SkillsRepositoryCloner,
  SkillsRepositoryDirectoryRemover,
  SkillsRepositorySubmodule,
  SkillsRepositorySubmoduleManager,
  SkillsRepositoryUpdater,
  SkillsRepository,
  SkillsRepositoryStore,
  SkillsRepositoryActivator,
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

  it("installs a GitHub repository into the local repositories directory", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const cloner = new RecordingSkillsRepositoryCloner();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([]),
      repositoryCloner: cloner,
      reposDirectory: "/home/test/.skilled/repos",
    }).parseAsync(["node", "skilled", "repo", "install", "hekonsek/skilled-repo"]);

    assert.equal(stdout.toString(), "📦 hekonsek/skilled-repo\n");
    assert.equal(
      stderr.toString(),
      "• Downloading hekonsek/skilled-repo\n✓ Downloaded hekonsek/skilled-repo.\n",
    );
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
      },
    ]);
  });

  it("updates an installed GitHub repository in place", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const cloner = new RecordingSkillsRepositoryCloner();
    const updater = new RecordingSkillsRepositoryUpdater();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      repositoryCloner: cloner,
      repositoryUpdater: updater,
      repositoryChangesChecker: new StaticSkillsRepositoryChangesChecker(false),
      reposDirectory: "/home/test/.skilled/repos",
    }).parseAsync(["node", "skilled", "repo", "install", "hekonsek/skilled-repo"]);

    assert.equal(stdout.toString(), "📦 hekonsek/skilled-repo\n");
    assert.equal(
      stderr.toString(),
      "• Updating hekonsek/skilled-repo\n✓ Updated hekonsek/skilled-repo.\n",
    );
    assert.deepEqual(cloner.cloneRequests, []);
    assert.deepEqual(updater.repositoryDirectories, [
      "/home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
  });

  it("replaces an installed GitHub repository with uncommitted changes", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const cloner = new RecordingSkillsRepositoryCloner();
    const updater = new RecordingSkillsRepositoryUpdater();
    const remover = new RecordingSkillsRepositoryDirectoryRemover();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      repositoryCloner: cloner,
      repositoryUpdater: updater,
      repositoryChangesChecker: new StaticSkillsRepositoryChangesChecker(true),
      repositoryDirectoryRemover: remover,
      reposDirectory: "/home/test/.skilled/repos",
    }).parseAsync(["node", "skilled", "repo", "install", "hekonsek/skilled-repo"]);

    assert.equal(stdout.toString(), "📦 hekonsek/skilled-repo\n");
    assert.equal(
      stderr.toString(),
      "• Updating hekonsek/skilled-repo\n✓ Updated hekonsek/skilled-repo.\n",
    );
    assert.deepEqual(updater.repositoryDirectories, []);
    assert.deepEqual(remover.repositoryDirectories, [
      "/home/test/.skilled/repos/hekonsek/skilled-repo",
    ]);
    assert.deepEqual(cloner.cloneRequests, [
      {
        repository: { owner: "hekonsek", name: "skilled-repo" },
        destinationDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
      },
    ]);
  });

  it("uses an installed skills repository", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const activator = new RecordingSkillsRepositoryActivator();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([
        { owner: "hekonsek", name: "skilled-repo" },
      ]),
      repositoryActivator: activator,
      reposDirectory: "/home/test/.skilled/repos",
      skillsDirectory: "/home/test/.agents/skills",
    }).parseAsync(["node", "skilled", "repo", "use", "hekonsek/skilled-repo"]);

    assert.equal(stdout.toString(), "📦 hekonsek/skilled-repo\n");
    assert.equal(
      stderr.toString(),
      "✓ Using hekonsek/skilled-repo at /home/test/.agents/skills.\n",
    );
    assert.deepEqual(activator.activationRequests, [
      {
        repositoryDirectory: "/home/test/.skilled/repos/hekonsek/skilled-repo",
        skillsDirectory: "/home/test/.agents/skills",
      },
    ]);
  });

  it("builds a skills repository from the configured directory", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const submoduleManager = new RecordingSkillsRepositorySubmoduleManager(
      [
        { name: "myorg-skills", directory: "myorg-skills" },
        { name: "obsolete-skills", directory: "obsolete-skills" },
      ],
      () => stdout.toString(),
    );

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([]),
      buildConfigReader: new StaticSkillsRepositoryBuildConfigReader({
        skills: [
          { owner: "myorg", name: "skills" },
          { owner: "myuser", name: "myskills" },
        ],
      }),
      submoduleManager,
    }).parseAsync(["node", "skilled", "repo", "build", "--dir", "/workspace/skills"]);

    assert.equal(
      stdout.toString(),
      "📦 myorg/skills\n📦 myuser/myskills\n",
    );
    assert.equal(
      stderr.toString(),
      [
        "• Building skills repository in /workspace/skills",
        "• Updating myorg/skills",
        "✓ Updated myorg/skills",
        "• Adding myuser/myskills",
        "✓ Added myuser/myskills",
        "• Removing obsolete-skills",
        "✓ Removed obsolete-skills",
        "✓ Built 2 skills repositories.",
        "",
      ].join("\n"),
    );
    assert.deepEqual(submoduleManager.stdoutSnapshots, [
      "",
      "📦 myorg/skills\n",
      "📦 myorg/skills\n📦 myuser/myskills\n",
    ]);
  });

  it("builds a locally installed skills repository", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const submoduleManager = new RecordingSkillsRepositorySubmoduleManager();

    await createCli({
      version: "1.2.3",
      stdout,
      stderr,
      repositoryStore: new StaticSkillsRepositoryStore([]),
      buildConfigReader: new StaticSkillsRepositoryBuildConfigReader({
        skills: [{ owner: "myorg", name: "skills" }],
      }),
      submoduleManager,
      reposDirectory: "/home/test/.skilled/repos",
    }).parseAsync([
      "node",
      "skilled",
      "repo",
      "build",
      "--installed-repo",
      "hekonsek/skilled-repo",
    ]);

    assert.match(
      stderr.toString(),
      /Building skills repository in \/home\/test\/\.skilled\/repos\/hekonsek\/skilled-repo/,
    );
    assert.deepEqual(submoduleManager.addRequests, [
      {
        repositoryDirectory:
          "/home/test/.skilled/repos/hekonsek/skilled-repo",
        repository: { owner: "myorg", name: "skills" },
        submoduleDirectory: "myorg-skills",
      },
    ]);
  });

  it("rejects using build directory and installed repository together", async () => {
    const program = createCli({
      version: "1.2.3",
      stdout: new MemoryWritable(),
      stderr: new MemoryWritable(),
    });
    const repoCommand = program.commands.find((command) => command.name() === "repo");
    const buildCommand = repoCommand?.commands.find(
      (command) => command.name() === "build",
    );
    buildCommand?.exitOverride();
    buildCommand?.configureOutput({ writeErr() {} });

    await assert.rejects(
      program.parseAsync([
        "node",
        "skilled",
        "repo",
        "build",
        "--dir",
        "/workspace/skills",
        "--installed-repo",
        "hekonsek/skilled-repo",
      ]),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "commander.conflictingOption",
    );
  });

  it("lists the build options in help output", async () => {
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
    assert.match(
      buildCommand?.helpInformation() ?? "",
      /--installed-repo <repository>/,
    );
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
  readonly stdoutSnapshots: string[] = [];

  constructor(private readonly readStdout: () => string = () => "") {}

  async cloneRepository(
    repository: SkillsRepository,
    destinationDirectory: string,
  ): Promise<void> {
    this.stdoutSnapshots.push(this.readStdout());
    this.cloneRequests.push({ repository, destinationDirectory });
  }
}

class RecordingSkillsRepositoryDirectoryRemover
  implements SkillsRepositoryDirectoryRemover
{
  readonly repositoryDirectories: string[] = [];

  async removeRepositoryDirectory(repositoryDirectory: string): Promise<void> {
    this.repositoryDirectories.push(repositoryDirectory);
  }
}

class RecordingSkillsRepositoryUpdater implements SkillsRepositoryUpdater {
  readonly repositoryDirectories: string[] = [];

  async updateRepository(repositoryDirectory: string): Promise<void> {
    this.repositoryDirectories.push(repositoryDirectory);
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

class RecordingSkillsRepositorySubmoduleManager
  implements SkillsRepositorySubmoduleManager
{
  readonly addRequests: {
    readonly repositoryDirectory: string;
    readonly repository: SkillsRepository;
    readonly submoduleDirectory: string;
  }[] = [];
  readonly stdoutSnapshots: string[] = [];

  constructor(
    private readonly submodules: readonly SkillsRepositorySubmodule[] = [],
    private readonly readStdout: () => string = () => "",
  ) {}

  async listSubmodules(): Promise<readonly SkillsRepositorySubmodule[]> {
    return this.submodules;
  }

  async hasUncommittedChanges(): Promise<boolean> {
    return false;
  }

  async addSubmodule(
    repositoryDirectory: string,
    repository: SkillsRepository,
    submoduleDirectory: string,
  ): Promise<void> {
    this.stdoutSnapshots.push(this.readStdout());
    this.addRequests.push({
      repositoryDirectory,
      repository,
      submoduleDirectory,
    });
  }

  async updateSubmodule(): Promise<void> {
    this.stdoutSnapshots.push(this.readStdout());
  }

  async removeSubmodule(): Promise<void> {
    this.stdoutSnapshots.push(this.readStdout());
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
