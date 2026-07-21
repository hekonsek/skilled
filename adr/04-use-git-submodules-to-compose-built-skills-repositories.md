# Use Git Submodules to Compose Built Skills Repositories

## Context

ADR 02 defines Git repositories as the base unit for skills repositories. A
single skills repository may need to aggregate skills maintained in several
independent upstream repositories while preserving their ownership, history,
and release workflows.

The existing build model clones each configured repository into the aggregate
repository and removes its Git metadata. This produces copied snapshots, but it
does not record the precise relationship between the aggregate repository and
each upstream repository using Git's dependency model. Updating a component
also replaces its directory rather than advancing a reviewable repository
reference.

The existing `skilled-repo.yml` format already provides a concise declarative
list of repositories:

```yml
skills:
  - org1/repo1
  - org1/repo2
  - user/repo
```

Git submodules can retain this configuration format while allowing the parent
repository to record the exact commit selected for each component.

## Decision

We will use Git submodules to compose built skills repositories.

`skilled-repo.yml` will remain the declarative list of component repositories.
For each entry, `skilled repo build` will maintain a submodule in the parent
repository using the existing `{USER|ORGANIZATION}-{REPO}` directory naming
convention. The build command will add missing submodules and advance existing
submodules to the latest commit on their remote default branches.

Submodule updates will be made locally and will not be committed automatically.
The parent repository's maintainers can review the changes and commit the
resulting gitlink updates, making the selected commits part of the parent
repository's versioned state.

`skilled repo install` will clone or update the parent repository and
recursively initialize its submodules. Installation will check out the commits
recorded by the parent repository rather than independently advancing each
submodule to the latest upstream commit.

We will retain submodule Git metadata. A built skills repository is therefore a
Git-aware aggregate checkout and is not required to contain metadata-free
copies of all component repositories.

## Consequences

Positive consequences:

- The parent repository records an exact, reviewable commit for every component
  repository.
- Component repositories retain their independent history, ownership, and
  development workflows.
- Updating a component produces a small gitlink change instead of copying its
  complete contents into the parent repository history again.
- The unchanged `skilled-repo.yml` format remains a simple source list for
  users and automation.
- Installation is reproducible because it follows the submodule commits stored
  by the parent repository.

Negative consequences:

- Cloning an aggregate repository without recursive submodule initialization
  leaves its component directories without checked-out contents.
- Builds must run inside a Git working tree and require submodule-aware Git
  operations.
- Building advances dependencies to their latest upstream commits, so build
  results can differ over time until the updated gitlinks are committed.
- Users need access and credentials for every referenced repository, and a
  failure in one submodule can leave installation incomplete.
- Source archives and ZIP downloads of the parent repository may not include
  submodule contents.
- Local changes inside submodules require explicit protection and error
  handling to avoid accidental data loss.

## Alternatives Considered

Copying repository contents and removing Git metadata was considered because it
produces a self-contained checkout that works after a normal clone or archive
download. It was not selected because it duplicates component contents in the
parent history and loses Git-native provenance for the selected source commit.

Git subtree was considered because it keeps component contents available in a
normal clone. It was not selected because subtree synchronization copies
history or squashed content into the parent repository and provides a less
direct dependency reference than a submodule gitlink.

Keeping submodules pinned during every build was considered because it would
make repeated builds deterministic. It was not selected because the desired
build behavior is to pull the latest upstream component changes locally;
reproducibility is established when maintainers review and commit the resulting
submodule references.
