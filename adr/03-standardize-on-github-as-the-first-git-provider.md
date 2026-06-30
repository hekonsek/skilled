# Standardize on GitHub as the First Git Provider

## Context

ADR 02 defines Git repositories as the base unit for skills repositories. The
CLI can work with local Git checkouts in a provider-neutral way, but commands
that discover, download, authenticate, inspect, or link to remote repositories
will need provider-specific behavior.

GitHub is the most common Git hosting platform for many open source and
commercial developer workflows, and it is likely to be available in many of the
organizations and communities that use agentic AI tooling. Starting with one
provider gives the project a smaller implementation surface while still covering
a large portion of expected users.

GitLab, Bitbucket, self-hosted Git servers, and other providers may be important
for some organizations, but supporting all of them from the beginning would
increase complexity around authentication, URL parsing, repository metadata,
permissions, API clients, rate limits, and test coverage.

## Decision

We will standardize on GitHub as the first supported Git hosting provider for
skills repositories.

The initial provider-aware commands and repository identifiers will assume
GitHub semantics where a remote repository can be addressed as `owner/name`.
Provider-specific integration should be implemented in a way that does not make
GitHub-specific API concerns leak into the core repository model more than
necessary.

We will consider GitLab, Bitbucket, self-hosted Git providers, and generic Git
remote support in the future when there is concrete user demand or when the CLI
needs to support organizations that do not use GitHub.

## Consequences

Positive consequences:

- The project can ship useful provider-aware repository workflows sooner by
  focusing on one widely adopted platform.
- Documentation, examples, and command behavior can be simpler because the first
  remote repository identity format is `owner/name`.
- The implementation can focus on GitHub authentication, API behavior, URL
  formats, and error handling before generalizing provider abstractions.
- GitHub support fits the current repository and development workflow for many
  open source and commercial teams.
- Future provider support can be informed by real GitHub implementation
  experience instead of speculative abstraction.

Negative consequences:

- Organizations that primarily use GitLab, Bitbucket, Azure DevOps, or
  self-hosted Git servers may not be supported by provider-aware workflows at
  first.
- Some users may interpret GitHub-first support as a long-term provider lock-in
  unless the documentation clearly distinguishes the initial provider from the
  Git repository model.
- GitHub API behavior, authentication methods, and rate limits become initial
  constraints on the CLI's provider-aware features.
- Provider-neutral abstractions may need refactoring later when a second Git
  provider is added and real differences become visible.

## Alternatives Considered

Supporting multiple Git providers from the beginning was considered because it
would avoid privileging one hosted platform. It was not selected because it
would require more API integrations, authentication flows, test fixtures, and
documentation before the core skills repository workflow is stable.

Starting with generic Git URLs only was considered because it would avoid
provider-specific assumptions. It was not selected because generic URLs provide
less ergonomic commands and do not cover provider-aware features such as
repository discovery, metadata, web links, or API-backed validation.

Starting with GitLab was considered because some organizations prefer GitLab for
self-hosting and integrated DevOps workflows. It was not selected because GitHub
is expected to cover a larger share of the project's initial audience and is the
more pragmatic first provider.

