import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { parse } from "yaml";

export interface Skill {
  readonly name: string;
}

export interface SkillsStore {
  listSkills(): Promise<readonly Skill[]>;
}

export interface LocalSkillsStoreOptions {
  readonly skillsDirectory?: string;
}

export class LocalSkillsStore implements SkillsStore {
  private readonly skillsDirectory: string;

  constructor(options: LocalSkillsStoreOptions = {}) {
    this.skillsDirectory = options.skillsDirectory ?? defaultSkillsDirectory();
  }

  async listSkills(): Promise<readonly Skill[]> {
    const entries = await readDirectoryEntries(this.skillsDirectory);
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => readSkill(join(this.skillsDirectory, entry.name))),
    );

    return skills
      .filter((skill): skill is Skill => skill !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

export class SkillsService {
  private readonly logger: Logger;

  constructor(
    private readonly skillsStore: SkillsStore,
    logger: Logger,
  ) {
    this.logger = logger.child({ service: "skills" });
  }

  async listSkills(): Promise<readonly Skill[]> {
    this.logger.debug("listing skills in currently used skills repository");

    return this.skillsStore.listSkills();
  }
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readSkill(skillDirectory: string): Promise<Skill | undefined> {
  let contents: string;
  try {
    contents = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }

    throw error;
  }

  const frontmatter = parseFrontmatter(contents, skillDirectory);
  const metadata = parse(frontmatter) as unknown;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    typeof (metadata as Record<string, unknown>).name !== "string" ||
    (metadata as Record<string, unknown>).name === ""
  ) {
    throw new Error(`Expected ${join(skillDirectory, "SKILL.md")} to declare a name.`);
  }

  return { name: (metadata as Record<string, string>).name };
}

function parseFrontmatter(contents: string, skillDirectory: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (match?.[1] === undefined) {
    throw new Error(
      `Expected ${join(skillDirectory, "SKILL.md")} to contain YAML frontmatter.`,
    );
  }

  return match[1];
}

function defaultSkillsDirectory(): string {
  return join(homedir(), ".agents", "skills");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
