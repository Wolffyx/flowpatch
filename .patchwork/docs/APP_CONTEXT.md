# Patchwork - App Context

Patchwork is a desktop app (Electron + React + TypeScript) for managing software work as a repo-linked Kanban board. It can sync issues and pull/merge requests from GitHub and GitLab, and it includes an optional local automation worker that can take "Ready" cards, generate a plan, implement changes with an external AI CLI, and open PRs/MRs.

This file is intended to be a compact, high-signal reference you can feed to an AI assistant as project context.

## What Patchwork is for

- Keep a unified Kanban view of work items tied to a specific local git repository.
- Sync status between the board and the remote provider (GitHub/GitLab).
- Optionally automate "Ready" work with a local worker that can plan, execute, and open PRs/MRs.

## Core concepts

- **Project:** A local configuration that points at a local git repo path, plus an optional selected remote.
- **Card:** A normalized representation of a remote item:
  - GitHub: issues, pull requests (and optionally Projects v2 items for status derivation)
  - GitLab: issues, merge requests
  - Local: a fallback adapter for projects without a linked remote
- **Status / columns:** The board uses a fixed workflow (draft/ready/in progress/in review/testing/done) and maps status to/from provider-specific representations (labels and/or GitHub Projects v2 fields).
- **Worker job:** A background run associated with a card. The job orchestrates planning, optional approvals, implementation, checks, and PR/MR creation.

## What the app does (features)

### Kanban and project UX

- Open a local repo and bind it to a remote identity (GitHub/GitLab).
- Show a multi-column Kanban board with drag/drop status changes.
- Show card details, linked PRs/MRs, logs/activity, and worker progress.
- "Draft with AI" for generating content for a draft card/description from within the UI.

### Sync and integrations

- **GitHub integration:** uses the `gh` CLI for listing/updating issues and PRs and can use GitHub Projects v2 (GraphQL via `gh`) to derive status from a project field when enabled.
- **GitLab integration:** uses the `glab` CLI for listing/updating issues and MRs.
- **Adapter architecture:** provider behavior is behind an adapter interface; Patchwork chooses an adapter based on the project's remote key/provider hint.

### Automation worker (optional)

Patchwork includes a local worker pipeline that can:

- Pick up eligible "Ready" cards (including pool mode for multiple parallel workers).
- Generate a plan first (and optionally require approval before continuing).
- Create a branch and implement changes using an external AI CLI:
  - Claude Code (`claude`)
  - OpenAI Codex CLI (`codex`)
- Run checks (lint/typecheck/test/build if configured by policy).
- Create a PR/MR and move the card through status transitions.
- Record streaming logs, progress, and usage/cost tracking for AI runs.

### Security / safety model (worker execution)

- Worker process execution goes through a command guard:
  - Commands can be allowlisted by policy.
  - Certain commands/patterns are blocked for safety.
  - Output can be streamed and captured for review.
- AI tool execution is restricted to known tools (`claude`, `codex`).
- The worker can be configured to use git worktrees for isolation.

## Repository layout (high level)

- `src/main/`: Electron main process, database, adapters (GitHub/GitLab/local), IPC, sync services, worker pipeline.
- `src/renderer/`: React UI.
- `src/preload/`: Electron preload bridge (safe IPC surface).
- `src/shared/`: Shared types and utilities used across main/renderer.
- `.patchwork/`: Patchwork workspace used for app configuration and local state (see below).

## Patchwork workspace (`.patchwork/`)

Patchwork maintains a per-repo workspace directory:

- `.patchwork/config.yml`: YAML config used for "Patchwork workspace" settings (budgets/privacy and other app features).
- `.patchwork/state/`: local state (index/cache/logs/locks). Patchwork adds `.patchwork/state/` to `.gitignore` to avoid committing generated state.
- `.patchwork/docs/`: optional docs stubs (architecture/runbook/etc.) for the repo.

The app can build a local index of the repo and use it to create bounded prompt/context bundles for the worker.

## Build and run (developer)

Common scripts:

- `npm run dev`: start Electron + Vite dev workflow.
- `npm run build`: typecheck + build via electron-vite.
- `npm run start`: preview/start built app.
- `npm run lint`, `npm run typecheck`, `npm run format`.
- `npm run build:win`, `npm run build:mac`, `npm run build:linux` for packaging via electron-builder.

## External tools (optional but expected for full functionality)

- Sync:
  - GitHub CLI: `gh`
  - GitLab CLI: `glab`
- Automation:
  - Claude Code: `claude`
  - OpenAI Codex CLI: `codex`

If AI tools are not installed, the worker can still generate a plan and produce a stub plan file for manual implementation.

