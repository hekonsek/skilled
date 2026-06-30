# Use Git Repositories as Skills Repositories

## Context

`skilled` helps developers work with agentic AI skills across projects,
organizations, and local environments. Organizations often need a shared,
auditable, and easy-to-distribute place for skills that represent their
engineering practices, platform conventions, operational procedures, and team
knowledge.

Git repositories are already the standard collaboration and distribution unit
for source-controlled developer assets. They support cloning, branching,
reviewing, tagging, versioning, and synchronization across developer machines
without requiring a new packaging format or central registry from this project.

Using repositories as the base unit allows organizations to keep all related
skills in one clonable monorepo. Developers can download that repository once,
switch between branches, tags, or remotes when moving between contexts and
environments, and reuse the same local Git workflows they already understand.

Many agentic AI tools discover skills from a local skills directory, such as
`~/.agents/skills`. A skills repository should therefore be usable as that
directory directly, or be mountable into that directory through a symbolic link,
bind mount, or equivalent local filesystem mechanism.

## Decision

We will use Git repositories as the base unit for skills repositories.

A skills repository is a Git repository that acts as a monorepo for skills. The
repository root should be structured so it can be used as an agent skills
directory directly, or mounted as one, for example at `~/.agents/skills`. The CLI
will manage downloaded skills repositories as local checkouts and will model
repository identity with an owner and repository name, such as `myorg/skills`.

## Consequences

Positive consequences:

- Organizations can distribute skills through a familiar `git clone`-style
  workflow.
- Teams can keep their skills together in one repository and manage them with
  existing branch, pull request, release, and review practices.
- Skills repositories can be mounted as agent skills directories, which keeps
  the repository checkout and the agent runtime view aligned.
- Developers can switch between environments, clients, products, or versions by
  checking out different branches, tags, forks, or remotes.
- Skills can be reviewed, audited, diffed, and rolled back with standard Git
  tooling.
- The project can avoid inventing a custom repository, registry, or package
  format before there is a clear need for one.

Negative consequences:

- Users need Git available on their machines or the CLI needs to provide a Git
  implementation strategy.
- Large monorepos may be slow to clone, update, or scan if organizations place
  too many unrelated assets in the same repository.
- Repository layout conventions for discovering skills must be documented and
  validated to avoid ambiguity.
- The repository root layout is constrained by the need to be usable as an
  agent skills directory, which may limit where non-skill support files belong.
- Git access, authentication, and credential handling become part of the CLI's
  operational surface.
- Git repositories are a distribution unit, not a complete dependency or
  compatibility model, so skill version constraints may still need additional
  design later.

## Alternatives Considered

A central `skilled` registry was considered because it could provide a
purpose-built discovery and installation experience. It was not selected because
it would require registry hosting, publishing workflows, authentication,
moderation, and package metadata before the project has proven that a custom
registry is necessary.

Language package managers such as npm were considered because the CLI is built
with Node.js and npm distribution is familiar to the target audience. They were
not selected as the base unit because skills are not necessarily JavaScript
packages and organizations may want to manage private skills independently from
runtime package dependencies.

Local filesystem directories without Git metadata were considered for a simpler
first implementation. They were not selected as the architectural base because
they do not provide a standard synchronization, versioning, review, or rollback
model across developer machines.
