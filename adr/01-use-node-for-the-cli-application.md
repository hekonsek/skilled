# Use Node for the CLI Application

## Context

`skilled` is a CLI tool for working with agentic AI skills. The tool needs to
run on developer machines, integrate well with existing command-line workflows,
and evolve quickly as skill formats, project conventions, and AI tooling change.

The application will likely need to parse local files, call external processes,
read and write structured documents, and provide a smooth installation path for
developers who already use modern JavaScript and TypeScript tooling.

## Decision

We will use Node.js as the runtime for the `skilled` CLI application.

Node gives the project a mature CLI ecosystem, first-class npm distribution, and
strong TypeScript support. It also fits the expected audience for this tool:
developers who commonly install local and global command-line tools through npm,
pnpm, yarn, or npx-compatible workflows.

## Consequences

Positive consequences:

- The CLI can be distributed through npm and executed through familiar workflows
  such as `npx`, `npm exec`, or package-manager-specific equivalents.
- The project can use TypeScript for typed application code while still shipping
  JavaScript that runs directly on Node.
- The ecosystem provides mature libraries for command parsing, filesystem
  access, Markdown processing, JSON/YAML handling, terminal output, and testing.
- Node's asynchronous I/O model is a good fit for CLIs that coordinate file
  operations, subprocesses, and network calls.
- Contributors familiar with web and automation tooling can work on the project
  without learning a systems language first.

Negative consequences:

- Users need a compatible Node.js runtime unless the project later adds packaged
  standalone binaries.
- Startup time and memory usage may be higher than a small native binary written
  in Go or Rust.
- npm dependency management introduces supply-chain and lockfile maintenance
  responsibilities.
- Native executable distribution, if needed later, will require additional
  packaging and release tooling.

## Alternatives Considered

Go was considered because it produces small standalone binaries, starts quickly,
and has strong cross-platform support. It was not selected because npm-based
distribution and TypeScript ecosystem integration are more important for this
tool at this stage.

Rust was considered because it can produce fast, reliable native CLIs with strong
compile-time guarantees. It was not selected because the development and
contributor onboarding cost is higher than Node for the expected project scope.

Python was considered because it is productive for scripting and local
automation. It was not selected because packaging Python CLIs consistently across
developer machines is more complex than npm-based distribution for the expected
audience.

Shell scripting was considered for a minimal implementation. It was not selected
because the CLI is expected to grow beyond simple command orchestration and will
benefit from structured code, typed interfaces, tests, and reusable libraries.
