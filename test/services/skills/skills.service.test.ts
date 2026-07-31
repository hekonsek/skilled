import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import pino from "pino";
import {
  LocalSkillsStore,
  SkillsService,
  type Skill,
  type SkillMetadataReader,
  type SkillsStore,
} from "../../../src/services/skills/skills.service.js";

const temporaryDirectories: string[] = [];

describe("LocalSkillsStore", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    );
  });

  it("lists declared skill names from the configured skills directory", async () => {
    const root = await createTemporaryDirectory();
    const skillsDirectory = join(root, ".agents", "skills");
    await writeSkill(skillsDirectory, "myorg-skill-zeta", "zeta");
    await writeSkill(skillsDirectory, "myorg-skill-alpha", "alpha");
    await mkdir(join(skillsDirectory, ".github"), { recursive: true });
    await writeFile(join(skillsDirectory, "README.md"), "not a skill");

    const store = new LocalSkillsStore({ skillsDirectory });

    assert.deepEqual(await store.listSkills(), [
      { name: "alpha" },
      { name: "zeta" },
    ]);
  });

  it("discovers a skill through a symbolic link", async () => {
    const root = await createTemporaryDirectory();
    const skillsDirectory = join(root, ".agents", "skills");
    const skillDirectory = join(root, "source-skill");
    await writeSkill(root, "source-skill", "linked-skill");
    await mkdir(skillsDirectory, { recursive: true });
    await symlink(skillDirectory, join(skillsDirectory, "linked"), "dir");

    const store = new LocalSkillsStore({ skillsDirectory });

    assert.deepEqual(await store.listSkills(), [{ name: "linked-skill" }]);
  });

  it("returns an empty list when the skills directory does not exist", async () => {
    const root = await createTemporaryDirectory();
    const store = new LocalSkillsStore({
      skillsDirectory: join(root, ".agents", "skills"),
    });

    assert.deepEqual(await store.listSkills(), []);
  });

  it("includes repository update metadata when requested", async () => {
    const root = await createTemporaryDirectory();
    const skillsDirectory = join(root, ".agents", "skills");
    await writeSkill(skillsDirectory, "myorg-skill-node", "skill-node");
    const updated = new Date("2026-07-30T10:00:00.000Z");
    const metadataReader = new StaticSkillMetadataReader(updated);
    const store = new LocalSkillsStore({ skillsDirectory, metadataReader });

    assert.deepEqual(await store.listSkills({ includeMetadata: true }), [
      { name: "skill-node", updated },
    ]);
    assert.deepEqual(metadataReader.skillDirectories, [
      join(skillsDirectory, "myorg-skill-node"),
    ]);
  });

  it("does not read repository metadata unless requested", async () => {
    const root = await createTemporaryDirectory();
    const skillsDirectory = join(root, ".agents", "skills");
    await writeSkill(skillsDirectory, "myorg-skill-node", "skill-node");
    const metadataReader = new StaticSkillMetadataReader(
      new Date("2026-07-30T10:00:00.000Z"),
    );
    const store = new LocalSkillsStore({ skillsDirectory, metadataReader });

    assert.deepEqual(await store.listSkills(), [{ name: "skill-node" }]);
    assert.deepEqual(metadataReader.skillDirectories, []);
  });
});

describe("SkillsService", () => {
  it("returns skills from the configured store", async () => {
    const store = new StaticSkillsStore([{ name: "skill-node" }]);
    const service = new SkillsService(store, pino({ level: "silent" }));

    assert.deepEqual(await service.listSkills(), [{ name: "skill-node" }]);
  });
});

class StaticSkillsStore implements SkillsStore {
  constructor(private readonly skills: readonly Skill[]) {}

  async listSkills(): Promise<readonly Skill[]> {
    return this.skills;
  }
}

class StaticSkillMetadataReader implements SkillMetadataReader {
  readonly skillDirectories: string[] = [];

  constructor(private readonly updated: Date | undefined) {}

  async readUpdated(skillDirectory: string): Promise<Date | undefined> {
    this.skillDirectories.push(skillDirectory);

    return this.updated;
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "skilled-test-"));
  temporaryDirectories.push(directory);

  return directory;
}

async function writeSkill(
  parentDirectory: string,
  directoryName: string,
  skillName: string,
): Promise<void> {
  const directory = join(parentDirectory, directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    ["---", `name: ${skillName}`, "description: Test skill", "---", "", "# Test"].join(
      "\n",
    ),
  );
}
