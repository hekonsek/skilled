# skilled repo install

Downloads a skills repository and its Git submodule contents onto the local
device.

## Example Command

```bash
# Clone https://github.com/hekonsek/skilled-repo into ~/.skilled/repos/hekonsek/skilled-repo
skilled repo install hekonsek/skilled-repo
```

## Behavior

If the repository is not installed, the command clones the remote repository
into `~/.skilled/repos/<owner>/<name>` and recursively initializes and downloads
all of its submodules.

If the repository is already installed and has no uncommitted changes, the
command runs a fast-forward-only pull in the parent checkout, synchronizes the
submodule configuration, and recursively initializes and updates every
submodule to the commit recorded by the updated parent repository.

Installation follows the submodule commits recorded by the parent repository;
it does not advance submodules independently to newer upstream commits. Use
`skilled repo build` when the installed repository's configured submodules
should be advanced to their latest upstream commits.

If the parent repository or any submodule contains uncommitted changes, the
command removes the installed checkout and creates a fresh recursive clone.
