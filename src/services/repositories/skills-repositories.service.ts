import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

export interface SkillsRepository {
  readonly owner: string;
  readonly name: string;
}

export interface SkillsRepositoryStore {
  listDownloadedRepositories(): Promise<readonly SkillsRepository[]>;
}

export interface LocalSkillsRepositoryStoreOptions {
  readonly reposDirectory?: string;
}

export class LocalSkillsRepositoryStore implements SkillsRepositoryStore {
  private readonly reposDirectory: string;

  constructor(options: LocalSkillsRepositoryStoreOptions = {}) {
    this.reposDirectory = options.reposDirectory ?? join(homedir(), ".skilled", "repos");
  }

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    const ownerDirectories = await readDirectories(this.reposDirectory);
    const repositories = await Promise.all(
      ownerDirectories.map(async (owner) => {
        const ownerPath = join(this.reposDirectory, owner);
        const names = await readDirectories(ownerPath);

        return names.map((name) => ({
          owner,
          name,
        }));
      }),
    );

    return repositories.flat().sort(compareRepositories);
  }
}

export class SkillsRepositoriesService {
  private readonly logger: Logger;

  constructor(
    private readonly repositoryStore: SkillsRepositoryStore,
    logger: Logger,
  ) {
    this.logger = logger.child({ service: "skills-repositories" });
  }

  async listDownloadedRepositories(): Promise<readonly SkillsRepository[]> {
    this.logger.debug("listing downloaded skills repositories");

    return this.repositoryStore.listDownloadedRepositories();
  }
}

async function readDirectories(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function compareRepositories(
  left: SkillsRepository,
  right: SkillsRepository,
): number {
  return `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
