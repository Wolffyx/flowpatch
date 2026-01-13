# FlowPatch

FlowPatch is a repo-linked Kanban app (Electron + React) that syncs issues/PRs/MRs from GitHub or GitLab and can run a local worker to turn "Ready" cards into branches + PRs/MRs using Claude Code or the OpenAI Codex CLI.

## What it does

- Open a local git repo, bind it to a remote, and view work items as cards on a unified Kanban board.
- Two-way sync via `gh` (GitHub Issues/PRs + Projects v2) and `glab` (GitLab Issues/MRs).
- Optional local automation worker that takes `Ready` cards through a plan-first pipeline and can create branches + PRs/MRs using Claude Code or Codex.
- Creates a per-repo `.flowpatch/` workspace for config + local state (and adds `.flowpatch/state/` to `.gitignore`).

## Key features

- **Kanban UX:** fixed workflow columns, drag/drop, card details, and quick actions (incl. `Draft with AI`).
- **Multi-provider:** local projects, GitHub, and GitLab via an adapter layer.
- **Projects v2 aware (GitHub):** can derive status from a Projects v2 status field when enabled.
- **Automation worker:** plan approvals, guarded command execution/allowlists, streaming logs, optional parallel workers, and optional git worktrees for isolation.
- **AI support:** detects `claude`/`codex`, supports tool preference + fallback, and tracks usage/cost limits.
- **Local workspace:** per-repo config (`.flowpatch/config.yml`) plus local indexing/state used to build safe prompt/context bundles for the worker.

## Prerequisites

- Node.js + npm
- Git
- Optional (sync): GitHub CLI `gh` and/or GitLab CLI `glab`
- Optional (automation): `claude` and/or `codex` on your `PATH`

## Development

```bash
npm install
npm run dev
```

## Useful scripts

```bash
npm run lint
npm run typecheck
npm run format
npm run build
npm run start
```

## Packaging

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

## AI drafting (UI)

When adding a card in the Draft column, use `Draft with AI` to generate text for the card/issue description.
