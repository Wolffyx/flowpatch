# Kanban Automation App (Electron + React + TypeScript + ShadCn UI) — Full Plan

> **Primary goal:** A repo-linked Kanban app that **syncs with GitHub Issues/PRs/Projects (v2 drafts)** and **GitLab Issues/MRs**, and runs a **local worker** that automatically takes **Ready** items, generates a plan, implements changes using **Claude Code** or **OpenAI Codex** (if installed), opens a PR/MR, and moves the item through the workflow across all systems.

---

## Table of contents

- [0. Goals and non-goals](#0-goals-and-non-goals)
- [1. Core concepts and terminology](#1-core-concepts-and-terminology)
- [2. Kanban workflow and mapping rules](#2-kanban-workflow-and-mapping-rules)
- [3. User flows](#3-user-flows)
- [4. Repo binding via git remotes](#4-repo-binding-via-git-remotes)
- [5. Policy file](#5-policy-file)
- [6. System architecture](#6-system-architecture)
- [7. Local data model (SQLite)](#7-local-data-model-sqlite)
- [8. Provider adapters (GitHub + GitLab)](#8-provider-adapters-github--gitlab)
- [9. Sync engine (webhook-first + polling fallback)](#9-sync-engine-webhook-first--polling-fallback)
- [10. Status computation and conflict handling](#10-status-computation-and-conflict-handling)
- [11. Worker automation pipeline (Ready → In progress → PR/MR → In review)](#11-worker-automation-pipeline-ready--in-progress--prmr--in-review)
- [12. Linking rules (Issue ↔ PR/MR ↔ Draft)](#12-linking-rules-issue--prmr--draft)
- [13. UI plan (solo-dev speed optimized)](#13-ui-plan-solo-dev-speed-optimized)
- [14. Security and safety rails](#14-security-and-safety-rails)
- [15. Packaging and distribution](#15-packaging-and-distribution)
- [16. Implementation roadmap](#16-implementation-roadmap)
- [17. Acceptance criteria checklist](#17-acceptance-criteria-checklist)

---

## 0. Goals and non-goals

### Goals

1. **Single unified Kanban** across GitHub + GitLab for a repo you open locally.
2. **Repo-first workflow:** open a local repo checkout → app binds to a chosen git remote → sync tasks from that remote.
3. **Two-way sync:** moving a card in the app updates GitHub/GitLab; remote changes show in-app.
4. **Automation worker:** local process that picks Ready items and completes the Ready → PR/MR pipeline.
5. **Solo-dev speed:** minimal setup, fast controls, sensible defaults, quick iteration.
6. **Extensible architecture:** adapters for providers; easy to add more integrations later.

### Non-goals (v1)

- Multi-user/team collaboration features (permissions, multi-assignee workflows)
- Multi-device state sync (cloud)
- Hosted webhook relay service (optional later)
- Full planning/estimation and portfolio tooling

---

## 1. Core concepts and terminology

### Project (in the app)

A **Project** is a local configuration that is always linked to:

- A **local folder** that is a git repo checkout
- Exactly one **selected git remote** (e.g., `origin`, `upstream`) determining the canonical provider/repo
- A **policy file** (optional but recommended) that governs sync + worker behavior

### Card

A **Card** is a unified representation of remote items:

- GitHub Issue
- GitHub PR
- GitHub Project v2 draft item (“draft issue”)
- GitLab Issue
- GitLab Merge Request (MR)

Each card has:

- `provider` (`github` | `gitlab`)
- `type` (`issue` | `pr` | `draft` | `mr`)
- a **Kanban status**
- remote identifiers (repo + number/id + URL)
- optional link(s) to PR/MR created by the worker
- a local event timeline (audit/log)

### Local worker

A **local background worker** that:

- continuously (or on-demand) picks eligible Ready cards
- moves them to In progress everywhere
- generates a plan before coding
- runs Claude Code/Codex to implement changes
- runs policy-defined checks
- creates PR/MR
- moves the card to In review everywhere
- logs everything to the card timeline

---

## 2. Kanban workflow and mapping rules

### 2.1 Columns (fixed)

- **Draft (Backlog)**
- **Ready**
- **In progress**
- **In review**
- **Testing**
- **Done**

### 2.2 “Ready” rule (your requirement)

A card is considered **Ready** (eligible for automation) if:

- it is in the app’s **Ready** column **OR**
- the remote item has the **`ready` label** (configurable via policy)

### 2.3 Status representation on providers (mapping)

#### GitHub Projects v2 (best fit when enabled)

- Use the Project item **single-select “Status” field** with your 6 values.
- Supports items that are issues, PRs, and **draft items**.
- Updating Project fields uses the **GraphQL API** (often via `gh api graphql`).

#### GitHub Issues / PRs without Projects

- Mirror status using labels (e.g., `status::in-progress`) and use `ready` as the “pickup” label.

#### GitLab (issues + MRs)

- Boards and workflow are typically label-driven.
- Use scoped labels such as:
  - `status::draft`
  - `status::ready`
  - `status::in-progress`
  - `status::in-review`
  - `status::testing`
  - `status::done`

### 2.4 Recommended label scheme

- **Ready trigger label:** `ready`
- **Status labels:** (one at a time)
  - `status::draft`
  - `status::ready`
  - `status::in-progress`
  - `status::in-review`
  - `status::testing`
  - `status::done`

**Rule:** keep at most one `status::…` label at a time; the app enforces this during updates.

### 2.5 Source of truth rules (to avoid sync loops)

- If a GitHub Project v2 is configured and an item belongs to it:
  - **Project Status field is canonical** for that item’s status.
- Otherwise:
  - **labels are canonical**.
- The app stores a local “desired status” and continuously reconciles.

---

## 3. User flows

### 3.1 Open repo as a project

1. Click **Open Repo**
2. Select a local folder
3. App verifies it’s a git repo
4. App parses `git remote -v`
5. If multiple supported remotes are detected:
   - show a **Remote Selector** (origin vs upstream etc.)
6. Bind project to the chosen remote and load `.kanban-agent.yml` if present
7. Start sync and show the Kanban board

### 3.2 View and filter cards

- Columns show cards by derived status
- Filters:
  - label
  - assignee
  - type (issue/draft/pr/mr)
  - updated recently
  - “Ready eligible”
- Search by title/body (optional: local indexed search)

### 3.3 Move cards (drag & drop)

- Dragging between columns:
  - updates local DB immediately (optimistic UI)
  - pushes changes to remote asynchronously
- Failures show a small error badge and a “Retry” action

### 3.4 Automation (worker)

- Toggle: **Auto-run worker on Ready**
- Per-card action: **Run worker now**
- Worker:
  - locks the card
  - moves to In progress (local + remote)
  - generates plan before coding
  - creates PR/MR
  - moves to In review (local + remote)
  - logs everything

---

## 4. Repo binding via git remotes

### 4.1 Remote detection

On open:

- run `git remote -v`
- parse remote URLs and normalize to a repo key:
  - GitHub: `github:owner/name`
  - GitLab: `gitlab:<host>/<group>/<repo>` (supports self-managed host)

Remote URL formats supported:

- HTTPS: `https://github.com/owner/repo.git`
- SSH: `git@github.com:owner/repo.git`
- GitLab self-managed: `git@my.gitlab.host:group/repo.git`

### 4.2 Remote selector (when ambiguous)

If multiple remotes match:

- list each remote with provider + repo:
  - `origin → GitHub: owner/repo`
  - `upstream → GitLab: host/group/repo`
- let user pick the canonical remote for this project
- store selection in `projects.selected_remote_name`

### 4.3 Repo-linked project rule

**A Kanban project is always linked to the repo remote.**
Cards come from that remote and PR/MR creation targets that remote.

---

## 5. Policy file

### 5.1 File name and location

- `.kanban-agent.yml` in the repo root (preferred)
- optional override location via app settings per project

### 5.2 Example policy (v1)

```yaml
version: 1

repo:
  provider: auto # auto|github|gitlab
  gitlab:
    host: 'https://gitlab.com'

sync:
  webhookPreferred: true
  pollingFallbackMinutes: 3

  readyLabel: 'ready'
  statusLabels:
    draft: 'status::draft'
    ready: 'status::ready'
    inProgress: 'status::in-progress'
    inReview: 'status::in-review'
    testing: 'status::testing'
    done: 'status::done'

  githubProjectsV2:
    enabled: false
    projectId: '' # Projects v2 node id (optional)
    statusFieldName: 'Status'
    statusValues:
      draft: 'Draft'
      ready: 'Ready'
      inProgress: 'In progress'
      inReview: 'In review'
      testing: 'Testing'
      done: 'Done'

worker:
  enabled: true
  toolPreference: 'auto' # auto|claude|codex
  planFirst: true

  maxMinutes: 25
  allowNetwork: false

  branchPattern: 'kanban/{id}-{slug}'
  commitMessage: '#{issue} {title}'

  allowedCommands:
    - 'pnpm install'
    - 'pnpm lint'
    - 'pnpm test'
    - 'pnpm build'

  lintCommand: 'pnpm lint'
  testCommand: 'pnpm test'
  buildCommand: 'pnpm build'

  forbidPaths:
    - '.github/workflows/'
    - '.gitlab-ci.yml'
```

### 5.3 Policy resolution rules

- If policy exists: use it; show validation errors in UI if invalid.
- If missing: use defaults and offer “Create policy file”.
- Policy affects:
  - labels and mapping
  - webhook/polling cadence
  - worker runtime limits, allowed commands, test/lint commands
  - branch naming and commit message templates
  - which AI tool to prefer

---

## 6. System architecture

### 6.1 Process split

- **Renderer (React + TS)**
  - Kanban UI, filters, card drawer, activity log
  - Drag/drop emits commands
- **Electron Main**
  - DB, sync engine, credentials, job orchestration
  - Spawns worker process
- **Worker (Node child process)**
  - long tasks: polling sync, webhook ingest processing, AI execution, git operations

### 6.2 IPC contract (examples)

Renderer → Main:

- `openRepo(path)`
- `selectRemote(projectId, remoteName)`
- `moveCard(cardId, status)`
- `syncNow(projectId)`
- `toggleWorker(projectId, enabled)`
- `runWorker(projectId, cardId?)`

Main → Renderer:

- `projectOpened(project)`
- `cardsUpdated(projectId, cards[])`
- `syncStatus(projectId, status)`
- `jobUpdate(jobId, state, progress, logsPreview)`
- `error(projectId, message, details)`

---

## 7. Local data model (SQLite)

### 7.1 `projects`

- `id` (uuid)
- `name`
- `local_path`
- `selected_remote_name`
- `remote_repo_key` (e.g., `github:owner/repo`)
- `provider_hint` (`auto|github|gitlab`)
- `policy_json` (cached)
- `created_at`, `updated_at`

### 7.2 `cards`

- `id` (uuid)
- `project_id`
- `provider` (`github|gitlab`)
- `type` (`issue|pr|draft|mr`)
- `title`
- `body` (optional cached)
- `status` (`draft|ready|in_progress|in_review|testing|done`)
- `ready_eligible` (bool)
- `assignees_json`
- `labels_json`
- `remote_url`
- `remote_repo_key`
- remote identity:
  - GitHub: `remote_number` (issue/pr number) + optional graph node id
  - GitLab: `remote_iid` (issue/MR iid) + project id/path
- timestamps:
  - `updated_remote_at`
  - `updated_local_at`
- sync:
  - `sync_state` (`ok|pending|error`)
  - `last_error`

### 7.3 `card_links`

- `id`
- `card_id`
- `linked_type` (`pr|mr`)
- `linked_url`
- `linked_remote_repo_key`
- `linked_number_or_iid`

### 7.4 `events` (timeline / audit log)

- `id`
- `project_id`
- `card_id`
- `type` (e.g., `status_changed|synced|worker_plan|worker_run|pr_created|error`)
- `payload_json`
- `created_at`

### 7.5 `jobs`

- `id`
- `project_id`
- `card_id` (nullable)
- `type` (`sync_poll|sync_push|worker_run|webhook_ingest`)
- `state` (`queued|running|succeeded|failed|canceled`)
- `lease_until`
- `attempts`
- `payload_json`
- `last_error`
- `created_at`, `updated_at`

---

## 8. Provider adapters (GitHub + GitLab)

### 8.1 Adapter responsibilities

Each adapter implements:

- Auth status checks
- Listing issues/drafts/PRs/MRs for the repo (and/or project)
- Updating labels (and Project fields if applicable)
- Creating PR/MR
- Commenting on issues
- Fetching a single item to reconcile state

### 8.2 CLI-first approach

For solo speed:

- GitHub: use `gh` for issues and PRs, and `gh api graphql` for Projects v2
- GitLab: use `glab` for issues and MRs; use `glab api` fallback if needed

### 8.3 GitHub Projects v2 support (optional)

When enabled:

- read project items (issues, PRs, draft items)
- read and update the “Status” field
- map field values to the Kanban statuses

---

## 9. Sync engine (webhook-first + polling fallback)

### 9.1 Polling loop (always available)

Every `pollingFallbackMinutes`:

1. list changed items since last cursor
2. normalize → upsert into `cards`
3. derive status + ready eligibility
4. emit UI updates

Store cursors in `projects` or a `sync_state` table:

- last successful poll timestamp per provider (and per project if used)

### 9.2 Webhook ingest (preferred)

Modes:

1. **Local webhook server** embedded in Electron (listens on localhost)
   - requires tunneling/port forwarding to receive webhooks from GitHub/GitLab
2. **Optional relay** (later)
   - a small hosted service forwards webhook payloads to the app

Webhook handling:

- validate signatures when possible
- enqueue `webhook_ingest` job
- job upserts changes and triggers targeted reconciliation poll

### 9.3 Reconciliation strategy

Whenever:

- webhook arrives, or
- user moves a card, or
- worker changes status

…run a targeted reconcile:

- fetch the affected item(s)
- ensure remote and local converge
- if mismatch, mark conflict

---

## 10. Status computation and conflict handling

### 10.1 Deriving local status from remote

Precedence:

1. If GitHub Projects v2 enabled and item is in project:
   - map Project Status field value to local status
2. Else if status label exists (`status::…`):
   - use that
3. Else if `ready` label exists:
   - status = Ready
4. Else:
   - status = Draft

### 10.2 Ready eligibility

`ready_eligible = (status == ready) OR (labels include readyLabel)`

### 10.3 Conflicts (solo-friendly)

If both local and remote changed since last sync:

- show conflict badge on card
- card drawer shows:
  - “Keep local” (push again)
  - “Keep remote” (overwrite local)

Auto-resolution only when:

- remote change is older than local status change
- and remote didn’t change other fields (title/body/labels unrelated)

---

## 11. Worker automation pipeline (Ready → In progress → PR/MR → In review)

### 11.1 Worker loop

When enabled:

1. find next eligible card (Ready rule)
2. acquire a lock/lease
3. move to In progress (local + remote)
4. plan-before-code
5. implement changes (Claude/Codex)
6. run checks (lint/test/build)
7. commit + push
8. create PR/MR
9. move to In review (local + remote)
10. release lock

### 11.2 Picking algorithm (solo speed default)

- oldest Ready first
- skip locked or recently failed items unless manually retried
- optionally: prefer items explicitly marked “auto” (future)

### 11.3 Leases and idempotency

- each job has a lease timeout; worker renews while running
- if worker crashes:
  - lease expires, job becomes retryable
  - card status shows “stale lock” warning

### 11.4 Plan-before-code (required)

Plan output includes:

- understanding of task (issue title/body)
- approach
- files to touch
- commands to run (must be allowed)
- expected outcomes
- risks/assumptions

Plan is stored in:

- `events` as `worker_plan`
- optional issue comment (policy-controlled)

### 11.5 Repo preparation rules

- verify clean working tree (policy-controlled: fail vs stash)
- fetch latest
- create branch with policy pattern

### 11.6 Tool selection: Claude Code vs Codex

On worker start:

- detect installed executables
- if both exist: use `toolPreference`
- if none exist:
  - create branch + stub PR with plan
  - mark status accordingly

### 11.7 Command restrictions & safety

- only allow commands listed in policy
- enforce max runtime
- optional: deny network access (default off)

### 11.8 Verification

Run configured commands:

- `lintCommand`
- `testCommand`
- optional `buildCommand`

If checks fail:

- record logs in timeline
- optional: open WIP PR (policy)
- keep card In progress but mark red, or move to Draft with “failed” tag (your choice)

### 11.9 PR/MR creation

- title defaults to issue title
- body includes:
  - issue link
  - summary of changes
  - how tested
  - plan reference
- store PR/MR link in `card_links`
- comment back on issue with PR/MR link

### 11.10 Status transitions (required)

- when worker starts: Ready → In progress (local + remote)
- when PR/MR created: In progress → In review (local + remote)

---

## 12. Linking rules (Issue ↔ PR/MR ↔ Draft)

### 12.1 Backlinks

- PR/MR body references issue/draft
- issue gets comment with PR/MR link

### 12.2 Local storage

- store links in `card_links` and show in UI
- if remote already has linked PR info, import it when possible

---

## 13. UI plan (solo-dev speed optimized)

### 13.1 Main layout

- Sidebar:
  - project list
  - “Open Repo…”
- Top bar:
  - Sync status indicator
  - Worker toggle
  - Command palette (Ctrl+K)

### 13.2 Kanban board

- fixed columns
- drag/drop
- card badges:
  - provider icon
  - type icon (issue/draft/pr/mr)
  - sync error/conflict badge
  - PR/MR link badge

### 13.3 Card drawer (right panel)

- title/body preview
- remote links: “Open in GitHub/GitLab”
- status controls
- timeline feed (events)
- worker controls:
  - Run now
  - Re-run from plan
  - Cancel job
- logs view (collapsed by default)

### 13.4 Remote selection UX

Only show remote selector when needed:

- if there’s one clear remote, auto-bind
- if ambiguous, prompt once and remember

---

## 14. Security and safety rails

### 14.1 Credentials

- prefer CLI auth:
  - GitHub: `gh auth status`
  - GitLab: `glab auth status`
- if you add in-app tokens later:
  - store in OS keychain (Electron safe storage)

### 14.2 Sandbox and guardrails

- allowedCommands allowlist
- forbidPaths
- runtime limits
- optional “dry run” mode (plan only + stub PR)

### 14.3 Privacy

- minimize cached bodies (optional setting)
- redact secrets in logs shown in UI (basic regex patterns)

---

## 15. Packaging and distribution

- Electron Builder packaging for macOS/Windows/Linux
- bundle:
  - DB migrations
  - worker script
  - UI assets
- first-run onboarding:
  - detect `git`, `gh`, `glab`, `claude`, `codex`
  - show a checklist + quick fixes

---

## 16. Implementation roadmap

### Milestone A — Skeleton app

- Electron + React scaffolding
- SQLite setup + migrations
- Projects list + Open Repo
- Git remote parsing + remote selector
- Basic Kanban UI + local status changes

**Deliverable:** open a repo and manage local status quickly.

### Milestone B — Policy file + repo binding

- load/validate `.kanban-agent.yml`
- show policy status in UI
- “Create policy file” wizard

**Deliverable:** per-repo configuration works.

### Milestone C — Sync v1 (polling)

- GitHub adapter (issues + PRs) via CLI
- GitLab adapter (issues + MRs) via CLI
- labels-based status mapping
- drag/drop pushes remote label updates
- robust retries

**Deliverable:** stable two-way sync via polling.

### Milestone D — Worker v1

- job queue + leases
- pick Ready cards
- move In progress remote + local
- plan-first
- git ops + AI execution + checks
- create PR/MR
- move In review remote + local

**Deliverable:** full Ready → PR/MR automation.

### Milestone E — Webhooks + reconciliation

- local webhook server + job ingest
- webhook UI status
- targeted reconciliation after webhooks
- conflict UI

**Deliverable:** near real-time updates with fallback.

### Milestone F — GitHub Projects v2 integration

- read project items including drafts
- update Project status field
- map project status to columns
- keep labels mirrored (optional)

**Deliverable:** Projects-driven workflow supported.

### Milestone G — Solo speed polish

- Ctrl+K palette
- better logs and error actions
- fast “run worker now”
- optional WIP limits

---

## 17. Acceptance criteria checklist

### Repo binding

- [ ] Opening a repo lists remotes and binds to chosen remote
- [ ] Project remembers selected remote across restarts

### Sync (polling + webhook)

- [ ] Issues appear as cards
- [ ] Ready label makes cards eligible
- [ ] Drag/drop updates remote labels (and project field when enabled)
- [ ] Remote changes appear locally via webhook or polling
- [ ] Conflicts surface clearly and are resolvable

### Worker

- [ ] Auto-picks Ready items
- [ ] Moves items to In progress everywhere on start
- [ ] Generates and stores a plan before coding
- [ ] Applies changes using Claude Code or Codex if installed
- [ ] Runs policy commands and captures logs
- [ ] Creates PR/MR and posts backlink to issue
- [ ] Moves items to In review everywhere after PR/MR

---

**End of plan.**
