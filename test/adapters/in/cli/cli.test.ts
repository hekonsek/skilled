import { Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCli } from "../../../../src/adapters/in/cli/cli.js";
import type {
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
});

class StaticSkillsRepositoryStore implements SkillsRepositoryStore {
  constructor(private readonly repositories: readonly SkillsRepository[]) {}

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    return this.repositories;
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
