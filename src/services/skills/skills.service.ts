import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";
import { parse } from "yaml";

const execFile = promisify(execFileCallback);

export interface Skill {
  readonly name: string;
  readonly updated?: Date;
}

export interface SkillsStore {
  listSkills(options?: ListSkillsOptions): Promise<readonly Skill[]>;
}

export interface ListSkillsOptions {
  readonly includeMetadata?: boolean;
}

export interface SkillMetadataReader {
  readUpdated(skillDirectory: string): Promise<Date | undefined>;
}

export interface LocalSkillsStoreOptions {
  readonly skillsDirectory?: string;
  readonly metadataReader?: SkillMetadataReader;
}

export class GitSkillMetadataReader implements SkillMetadataReader {
  async readUpdated(skillDirectory: string): Promise<Date | undefined> {
    if (!(await isFile(join(skillDirectory, ".git")))) {
      return undefined;
    }

    const { stdout: superprojectDirectory } = await execFile("git", [
      "-C",
      skillDirectory,
      "rev-parse",
      "--show-superproject-working-tree",
    ]);
    if (superprojectDirectory.trim() === "") {
      return undefined;
    }

    const { stdout } = await execFile("git", [
      "-C",
      skillDirectory,
      "log",
      "-1",
      "--format=%ct",
    ]);
    const timestamp = stdout.trim();
    if (timestamp === "") {
      return undefined;
    }

    return new Date(Number(timestamp) * 1_000);
  }
}

export class LocalSkillsStore implements SkillsStore {
  private readonly skillsDirectory: string;
  private readonly metadataReader: SkillMetadataReader;

  constructor(options: LocalSkillsStoreOptions = {}) {
    this.skillsDirectory = options.skillsDirectory ?? defaultSkillsDirectory();
    this.metadataReader = options.metadataReader ?? new GitSkillMetadataReader();
  }

  async listSkills(options: ListSkillsOptions = {}): Promise<readonly Skill[]> {
    const entries = await readDirectoryEntries(this.skillsDirectory);
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map(async (entry) => {
          const skillDirectory = join(this.skillsDirectory, entry.name);
          const skill = await readSkill(skillDirectory);
          if (skill === undefined || options.includeMetadata !== true) {
            return skill;
          }

          const updated = await this.metadataReader.readUpdated(skillDirectory);

          return updated === undefined ? skill : { ...skill, updated };
        }),
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

  async listSkills(options: ListSkillsOptions = {}): Promise<readonly Skill[]> {
    this.logger.debug("listing skills in currently used skills repository");

    return this.skillsStore.listSkills(options);
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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
