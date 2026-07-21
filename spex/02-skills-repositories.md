# Skills repositories

**Skills repository** is a Git repository containing skills to be used by AI agents. This repository reflects structure of `~/.agents/skills` repository on local device.

## Working with multiple repositories (installing)

With `skilled` You can use multiple skills repositories on a single device.
Repositories, including their Git submodule contents, are downloaded to the
`~/.skilled/repos` directory and symlinked to `~/.agents/skills` as needed. When
a skills repository is downloaded into `~/.skilled/repos`, we say it is
**installed**.

`~/.skilled/repos` directory contains installed repositories `~/.skilled/repos/{USER|ORGANIZATION}/{NAME}` where `USER|ORGANIZATION` represent GitHub organization and `NAME` represent GitHub repository name. For example `~/.skilled/repos/myorg/skills` represents `https://github.com/myorg/skills` GitHub repository.
