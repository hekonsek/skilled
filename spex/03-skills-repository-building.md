# Skills repository building

`skilled` can be used to build skills repository from configuration file. The file is named `skilled-repo.yml` and has the following structure:

```yml
skills:
    - org1/repo1
    - org1/repo2
    - user/repo
```

Repository configuration file is located in root of built skills repository monorepo. Configuration file is ignored by agents, but can be used to build final skills repository monorepo. 

## Building behavior

When `skilled repo build` command is executed in root of monorepo, `skilled` clones repositories and puts them into an appriopriate directories. 

Repositories are saved in root of skills monorepo using `{USER|ORGANIZATION}-{REPO}` convention. For example for `myorg/skills` skill in build config, `https://github.com/myorg/skills` repository will be downloaded and saved into `myorg-skills` directory in monorepo.

Downloaded skills should be stripped from `.git` directory. Skills monorepo should contain flat view of compiled skills without Git history of original repository.

If directory for downloaded repository already exists, remove existing one and download the latest version.