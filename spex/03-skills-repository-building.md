# Skills Repository Building

`skilled` can build a skills repository from a configuration file named
`skilled-repo.yml`. The file has the following structure:

```yml
skills:
  - org1/repo1
  - org1/repo2
  - user/repo
```

The configuration file is located in the root of the skills repository
monorepo. Agents ignore the configuration file, while `skilled` uses it to
compose the monorepo from Git submodules.

## Building Behavior

The directory passed to `skilled repo build`, or the current directory when no
directory is passed, must be a Git working tree.

For each repository in `skilled-repo.yml`, `skilled` maintains a Git submodule
in the root of the monorepo. Submodule directories use the
`{USER|ORGANIZATION}-{REPO}` convention. For example, `myorg/skills` is placed
in `myorg-skills` and uses `https://github.com/myorg/skills` as its remote.

If a configured submodule does not exist, the command adds it and downloads its
contents. If it already exists, the command synchronizes its configured remote,
fetches the remote, and updates the local submodule working tree to the latest
commit on the remote's default branch.

Updating an existing submodule changes the submodule commit recorded by the
parent repository locally. The command does not commit this change. Users can
review and commit the updated submodule references in the parent repository.

The command must not overwrite uncommitted changes inside a submodule. If a
configured submodule contains uncommitted changes, the build fails and reports
the affected submodule.

Git metadata in submodules is retained. The built monorepo therefore consists
of Git submodules rather than copied repository contents, and its `.gitmodules`
file and submodule commit references are part of the repository state.

Repositories removed from `skilled-repo.yml` are removed automatically.