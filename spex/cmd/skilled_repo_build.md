# skilled repo build

Builds a skills repository in the current directory.

## Behavior 

The command adds missing configured Git submodules and updates existing ones to
the latest commit on each remote's default branch. Updated submodule references
remain as local changes in the parent repository for the user to review and
commit.

## Options

- `--dir <directory>`: Uses the specified skills repository root containing
  `skilled-repo.yml` instead of the current directory.
- `--installed-repo <owner>/<name>`: Builds a locally installed repository, for
  example `hekonsek/skilled-repo`. This option cannot be used with `--dir`.
