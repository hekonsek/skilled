# Skills repositories

**Skills repository** is a Git repository containing skills to be used by AI agents. This repository reflects structure of `~/.agents/skills` repository on local device.

## Multiple repositories

With `skilled` You can use multiple skills repositories on a single device. Repositories are downloaded to `~/.skilled/repos` directory and symlinked to `~/.agents/skills` as needed.

`~/.skilled/repos` directory contains downloaded repositories `~/.skilled/repos/{USER|ORGANIZATION}/{NAME}` where `USER|ORGANIZATION` represent GitHub organization and `NAME` represent GitHub repository name. For example `~/.skilled/repos/myorg/skills` represents `https://github.com/myorg/skills` GitHub repository.