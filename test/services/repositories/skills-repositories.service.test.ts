import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import {
  LocalSkillsRepositoryStore,
  SkillsRepositoriesService,
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
});

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "skilled-test-"));
  temporaryDirectories.push(path);

  return path;
}
