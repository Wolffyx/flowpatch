# Git Worktree Support Implementation Plan

## Overview

Add git worktree support to Patchwork's worker pipeline for isolated, concurrent card processing without affecting the main working tree.

---

## Phase 1: Policy Configuration & Types

### 1.1 Extend PolicyConfig in `src/shared/types.ts`

Add new `worktree` section to `WorkerPolicyConfig`:

```typescript
worktree?: {
  enabled: boolean;                    // Default: false (opt-in)
  root: 'repo' | 'sibling' | 'custom'; // Where to create worktrees
  customPath?: string;                 // Only if root === 'custom'
  baseBranch?: string;                 // Override default branch (e.g., 'develop')
  branchPrefix: string;                // Default: 'patchwork/'
  cleanup: {
    onSuccess: 'immediate' | 'delay' | 'never';   // Default: 'immediate'
    onFailure: 'immediate' | 'delay' | 'never';   // Default: 'delay' (for debugging)
    delayMinutes?: number;                         // Default: 30
  };
  maxConcurrent: number;               // Default: 1 (sequential), max: 4
  skipInstallIfCached?: boolean;       // Skip npm install if using pnpm store
}
```

### 1.2 Branch Naming Utility

Add to `src/shared/types.ts`:

```typescript
// Branch naming: patchwork/<provider>-<number|id>-<slug>
// Max length: 100 chars, safe charset: a-z0-9-
export function generateWorktreeBranchName(
  provider: Provider,
  numberOrId: string | number,
  title: string,
  prefix: string = 'patchwork/'
): string;
```

### 1.3 Update DEFAULT_POLICY

Add sensible defaults for worktree config.

---

## Phase 2: Database Schema Extension

### 2.1 New Table: `worktrees`

Add to `src/main/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,

  -- Paths and refs
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_ref TEXT NOT NULL,           -- e.g., 'origin/main' or SHA

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'creating',  -- creating|ready|running|cleanup_pending|cleaned|error
  last_error TEXT,

  -- Locking (crash recovery)
  locked_by TEXT,                   -- Worker instance ID
  lock_expires_at TEXT,             -- ISO timestamp

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_worktrees_project ON worktrees(project_id);
CREATE INDEX idx_worktrees_card ON worktrees(card_id);
CREATE INDEX idx_worktrees_status ON worktrees(status);
CREATE UNIQUE INDEX idx_worktrees_path ON worktrees(worktree_path);
CREATE UNIQUE INDEX idx_worktrees_branch ON worktrees(project_id, branch_name);
```

### 2.2 Database Functions

Add to `src/main/db.ts`:

```typescript
// CRUD operations
createWorktree(data: WorktreeCreate): Worktree
getWorktree(id: string): Worktree | undefined
getWorktreeByPath(path: string): Worktree | undefined
getWorktreeByBranch(projectId: string, branchName: string): Worktree | undefined
getWorktreeByCard(cardId: string): Worktree | undefined
listWorktrees(projectId: string): Worktree[]
listWorktreesByStatus(projectId: string, status: WorktreeStatus): Worktree[]
updateWorktreeStatus(id: string, status: WorktreeStatus, error?: string): void
deleteWorktree(id: string): void

// Locking
acquireWorktreeLock(id: string, lockedBy: string, ttlMinutes: number): boolean
renewWorktreeLock(id: string, lockedBy: string, ttlMinutes: number): boolean
releaseWorktreeLock(id: string): void
getExpiredLocks(): Worktree[]
```

### 2.3 Migration

Add migration logic in `ensureSchema()` to handle existing databases.

---

## Phase 3: GitWorktreeManager Service

### 3.1 Create `src/main/services/git-worktree-manager.ts`

```typescript
import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  headSha: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface EnsureWorktreeResult {
  worktreePath: string;
  branchName: string;
  created: boolean;  // true if newly created, false if reused existing
}

export class GitWorktreeManager {
  constructor(private repoPath: string) {}

  /**
   * List all worktrees using `git worktree list --porcelain`
   */
  list(): WorktreeInfo[];

  /**
   * Ensure a worktree exists for the given branch.
   * If worktree already exists at path, validates and returns it.
   * If branch exists but no worktree, creates worktree.
   * If neither exists, creates branch and worktree.
   */
  async ensureWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch: string,
    options?: {
      fetchFirst?: boolean;
      force?: boolean;
    }
  ): Promise<EnsureWorktreeResult>;

  /**
   * Remove a worktree safely.
   * Verifies path is in allowed locations before deletion.
   */
  async removeWorktree(
    worktreePath: string,
    options?: {
      force?: boolean;  // Use --force for dirty worktrees
    }
  ): Promise<void>;

  /**
   * Prune stale worktree entries
   */
  prune(): void;

  /**
   * Check if a worktree is dirty (has uncommitted changes)
   */
  isDirty(worktreePath: string): boolean;

  /**
   * Get the default branch (main/master/develop)
   */
  getDefaultBranch(): string;

  /**
   * Fetch from remote
   */
  fetch(remote?: string): void;

  /**
   * Validate that a path is a safe worktree location
   */
  isValidWorktreePath(worktreePath: string, allowedRoots: string[]): boolean;
}
```

### 3.2 Porcelain Parser

Parse `git worktree list --porcelain` output:

```
worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/feature
HEAD def789abc012
branch refs/heads/feature-branch
```

### 3.3 Path Safety

```typescript
// Only allow worktree operations in:
// 1. <repoPath>/.patchwork-worktrees/
// 2. <repoPath>/../<repoName>-worktrees/
// 3. Custom configured path
// NEVER allow arbitrary paths
```

---

## Phase 4: Worker Pipeline Integration

### 4.1 Update `src/main/worker/pipeline.ts`

#### New Phase: Worktree Setup (replaces stash + branch creation)

```typescript
private async setupWorktree(): Promise<void> {
  if (!this.policy.worktree?.enabled) {
    // Fall back to existing stash-based logic
    return this.setupTraditional();
  }

  const manager = new GitWorktreeManager(this.repoPath);

  // 1. Generate paths and names
  const branchName = generateWorktreeBranchName(
    this.card.provider,
    this.card.remote_number_or_iid,
    this.card.title,
    this.policy.worktree.branchPrefix
  );

  const worktreePath = this.computeWorktreePath(branchName);
  const baseBranch = this.policy.worktree.baseBranch || manager.getDefaultBranch();

  // 2. Create worktree record in DB
  const worktreeRecord = db.createWorktree({
    projectId: this.project.id,
    cardId: this.card.id,
    jobId: this.job.id,
    worktreePath,
    branchName,
    baseRef: `origin/${baseBranch}`,
    status: 'creating',
    lockedBy: this.workerId,
    lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  // 3. Fetch and create worktree
  manager.fetch();
  await manager.ensureWorktree(worktreePath, branchName, baseBranch, {
    fetchFirst: true
  });

  // 4. Update status
  db.updateWorktreeStatus(worktreeRecord.id, 'ready');

  // 5. Store for later use
  this.worktreePath = worktreePath;
  this.worktreeId = worktreeRecord.id;
  this.branchName = branchName;
}
```

#### Modified AI Execution

```typescript
private async runAI(): Promise<void> {
  const workingDir = this.worktreePath || this.repoPath;

  // Run AI tool in worktree directory
  await this.executeWithStreaming('claude', ['--yes', '--dangerously-skip-permissions'], {
    cwd: workingDir,
    // ... existing options
  });
}
```

#### Modified Checks/Build

```typescript
private async runChecks(): Promise<void> {
  const workingDir = this.worktreePath || this.repoPath;

  // Install dependencies in worktree (if not using shared cache)
  if (this.worktreePath && !this.policy.worktree?.skipInstallIfCached) {
    await this.executeCommand('pnpm install', { cwd: workingDir });
  }

  // Run lint/test/build in worktree
  if (this.policy.worker.lintCommand) {
    await this.executeCommand(this.policy.worker.lintCommand, { cwd: workingDir });
  }
  // ... etc
}
```

#### Modified Commit/Push

```typescript
private async commitAndPush(): Promise<void> {
  const workingDir = this.worktreePath || this.repoPath;

  // Commit in worktree
  await this.git(`-C "${workingDir}" add -A`);
  await this.git(`-C "${workingDir}" commit -m "${commitMessage}"`);
  await this.git(`-C "${workingDir}" push -u origin ${this.branchName}`);
}
```

#### Cleanup Phase

```typescript
private async cleanup(): Promise<void> {
  if (!this.worktreeId) return;

  const policy = this.policy.worktree?.cleanup;
  const success = this.phase === 'done';
  const cleanupMode = success ? policy?.onSuccess : policy?.onFailure;

  switch (cleanupMode) {
    case 'immediate':
      await this.removeWorktreeNow();
      break;
    case 'delay':
      db.updateWorktreeStatus(this.worktreeId, 'cleanup_pending');
      // Scheduled cleanup will handle it
      break;
    case 'never':
      // Leave for manual cleanup
      break;
  }
}

private async removeWorktreeNow(): Promise<void> {
  const manager = new GitWorktreeManager(this.repoPath);
  const worktree = db.getWorktree(this.worktreeId);

  if (!worktree) return;

  try {
    await manager.removeWorktree(worktree.worktree_path, {
      force: this.policy.worktree?.cleanup?.forceOnFailure
    });
    db.updateWorktreeStatus(this.worktreeId, 'cleaned');
  } catch (err) {
    db.updateWorktreeStatus(this.worktreeId, 'error', String(err));
  }
}
```

### 4.2 Cancellation Handling

```typescript
private async handleCancel(): Promise<void> {
  if (this.worktreeId) {
    // No need for stash restore - just mark for cleanup
    db.updateWorktreeStatus(this.worktreeId, 'cleanup_pending');
  } else {
    // Traditional stash restore logic
    await this.restoreStash();
  }
}
```

---

## Phase 5: Crash Recovery

### 5.1 Create `src/main/services/worktree-reconciler.ts`

```typescript
export class WorktreeReconciler {
  constructor(private projectId: string, private repoPath: string) {}

  /**
   * Reconcile DB state with actual git worktrees on disk
   */
  async reconcile(): Promise<ReconciliationResult> {
    const manager = new GitWorktreeManager(this.repoPath);
    const dbWorktrees = db.listWorktrees(this.projectId);
    const gitWorktrees = manager.list();

    const results: ReconciliationResult = {
      orphaned: [],      // In DB but not on disk
      untracked: [],     // On disk but not in DB
      locked: [],        // Expired locks
      cleaned: []        // Successfully cleaned up
    };

    // 1. Find DB records without matching worktree on disk
    for (const dbWt of dbWorktrees) {
      if (!gitWorktrees.find(g => g.worktreePath === dbWt.worktree_path)) {
        results.orphaned.push(dbWt);
        db.updateWorktreeStatus(dbWt.id, 'error', 'Worktree missing from disk');
      }
    }

    // 2. Find expired locks
    const expired = db.getExpiredLocks();
    for (const wt of expired) {
      results.locked.push(wt);
      db.releaseWorktreeLock(wt.id);
      db.updateWorktreeStatus(wt.id, 'cleanup_pending', 'Lock expired (possible crash)');
    }

    // 3. Process cleanup_pending worktrees
    const pending = db.listWorktreesByStatus(this.projectId, 'cleanup_pending');
    for (const wt of pending) {
      try {
        await manager.removeWorktree(wt.worktree_path, { force: true });
        db.updateWorktreeStatus(wt.id, 'cleaned');
        results.cleaned.push(wt);
      } catch (err) {
        db.updateWorktreeStatus(wt.id, 'error', String(err));
      }
    }

    // 4. Prune stale git worktree entries
    manager.prune();

    return results;
  }
}
```

### 5.2 Startup Hook

Add to `src/main/index.ts`:

```typescript
async function onAppReady() {
  // ... existing init

  // Reconcile worktrees for all projects
  const projects = db.listProjects();
  for (const project of projects) {
    if (project.local_path) {
      const reconciler = new WorktreeReconciler(project.id, project.local_path);
      await reconciler.reconcile();
    }
  }

  // Start worker loops
  startEnabledWorkerLoops();
}
```

---

## Phase 6: Scheduled Cleanup

### 6.1 Create `src/main/services/worktree-cleanup-scheduler.ts`

```typescript
export class WorktreeCleanupScheduler {
  private intervalId: NodeJS.Timer | null = null;

  start(intervalMinutes: number = 5) {
    this.intervalId = setInterval(() => {
      this.processDelayedCleanups();
    }, intervalMinutes * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async processDelayedCleanups() {
    const projects = db.listProjects();

    for (const project of projects) {
      const pending = db.listWorktreesByStatus(project.id, 'cleanup_pending');
      const policy = parsePolicy(project.policy_json);
      const delayMs = (policy.worktree?.cleanup?.delayMinutes ?? 30) * 60 * 1000;

      for (const wt of pending) {
        const age = Date.now() - new Date(wt.updated_at).getTime();
        if (age >= delayMs) {
          const manager = new GitWorktreeManager(project.local_path);
          try {
            await manager.removeWorktree(wt.worktree_path, { force: true });
            db.updateWorktreeStatus(wt.id, 'cleaned');
          } catch (err) {
            db.updateWorktreeStatus(wt.id, 'error', String(err));
          }
        }
      }
    }
  }
}
```

---

## Phase 7: UI Components

### 7.1 Card Detail Panel

Update `src/renderer/src/components/CardDetail.tsx`:

- Show worktree info when available:
  - Branch name
  - Worktree path
  - Status (creating/ready/running/cleanup_pending/cleaned/error)
- Actions:
  - "Open Folder" - Opens worktree in file explorer
  - "Remove Worktree" - Manual cleanup
  - "Recreate Worktree" - Force recreate if error

### 7.2 Settings Dialog

Update `src/renderer/src/components/SettingsDialog.tsx`:

- Toggle: "Use Git Worktrees"
- Dropdown: Worktree location (In repo / Sibling folder / Custom)
- Path picker (if custom)
- Number: Max concurrent workers (1-4)
- Cleanup settings:
  - On success: Immediate / Delayed / Never
  - On failure: Immediate / Delayed / Never
  - Delay duration (minutes)

### 7.3 Project Overview

Add worktree status indicator:
- Count of active worktrees
- "Clean Up All" button for stale worktrees

---

## Phase 8: IPC Handlers

### 8.1 New Handlers in `src/main/index.ts`

```typescript
ipcMain.handle('listWorktrees', async (_, projectId: string) => {
  return db.listWorktrees(projectId);
});

ipcMain.handle('removeWorktree', async (_, worktreeId: string) => {
  const wt = db.getWorktree(worktreeId);
  if (!wt) throw new Error('Worktree not found');

  const project = db.getProject(wt.project_id);
  const manager = new GitWorktreeManager(project.local_path);

  await manager.removeWorktree(wt.worktree_path, { force: true });
  db.updateWorktreeStatus(worktreeId, 'cleaned');
  notifyRenderer();
});

ipcMain.handle('recreateWorktree', async (_, worktreeId: string) => {
  // Remove existing and trigger fresh creation
  const wt = db.getWorktree(worktreeId);
  if (!wt) throw new Error('Worktree not found');

  const project = db.getProject(wt.project_id);
  const manager = new GitWorktreeManager(project.local_path);

  // Force remove if exists
  try { await manager.removeWorktree(wt.worktree_path, { force: true }); } catch {}

  // Recreate
  await manager.ensureWorktree(
    wt.worktree_path,
    wt.branch_name,
    wt.base_ref,
    { fetchFirst: true, force: true }
  );

  db.updateWorktreeStatus(worktreeId, 'ready');
  notifyRenderer();
});

ipcMain.handle('openWorktreeFolder', async (_, worktreePath: string) => {
  shell.openPath(worktreePath);
});

ipcMain.handle('cleanupStaleWorktrees', async (_, projectId: string) => {
  const project = db.getProject(projectId);
  const reconciler = new WorktreeReconciler(projectId, project.local_path);
  return reconciler.reconcile();
});
```

---

## Phase 9: Safety & Validation

### 9.1 Path Safety Checks

```typescript
// In GitWorktreeManager
isValidWorktreePath(worktreePath: string, config: WorktreePolicyConfig): boolean {
  const resolved = path.resolve(worktreePath);

  // Must be absolute
  if (!path.isAbsolute(resolved)) return false;

  // Must be under allowed roots
  const allowedRoots = this.getAllowedRoots(config);
  const isUnderAllowed = allowedRoots.some(root =>
    resolved.startsWith(path.resolve(root))
  );

  if (!isUnderAllowed) return false;

  // Must not be the main repo
  if (resolved === path.resolve(this.repoPath)) return false;

  // Must not contain path traversal
  if (resolved.includes('..')) return false;

  return true;
}

private getAllowedRoots(config: WorktreePolicyConfig): string[] {
  const roots: string[] = [];

  switch (config.root) {
    case 'repo':
      roots.push(path.join(this.repoPath, '.patchwork-worktrees'));
      break;
    case 'sibling':
      roots.push(path.join(path.dirname(this.repoPath), `${path.basename(this.repoPath)}-worktrees`));
      break;
    case 'custom':
      if (config.customPath) roots.push(config.customPath);
      break;
  }

  return roots;
}
```

### 9.2 Force Delete Safeguards

```typescript
async removeWorktree(worktreePath: string, options?: { force?: boolean }): Promise<void> {
  // 1. Validate path is safe
  if (!this.isValidWorktreePath(worktreePath, this.config)) {
    throw new Error(`Refusing to remove path outside allowed worktree roots: ${worktreePath}`);
  }

  // 2. Verify it's actually a git worktree
  const worktrees = this.list();
  const match = worktrees.find(wt => wt.worktreePath === worktreePath);
  if (!match) {
    throw new Error(`Path is not a registered git worktree: ${worktreePath}`);
  }

  // 3. Remove via git
  const forceFlag = options?.force ? '--force' : '';
  execSync(`git -C "${this.repoPath}" worktree remove ${forceFlag} "${worktreePath}"`, {
    stdio: 'pipe'
  });
}
```

---

## Phase 10: Testing

### 10.1 Unit Tests

Create `src/main/services/__tests__/git-worktree-manager.test.ts`:

- Branch name generation (length limits, character safety)
- Porcelain output parsing
- Path safety validation
- Error handling for missing git

### 10.2 Integration Tests

Create `tests/integration/worktree.test.ts`:

- Create worktree in temp repo
- Run commands in worktree
- Commit and push from worktree
- Remove worktree
- Crash recovery simulation

---

## Implementation Order

1. **Types & Policy** (Phase 1) - ~30 min
2. **Database Schema** (Phase 2) - ~30 min
3. **GitWorktreeManager** (Phase 3) - ~2 hours
4. **Pipeline Integration** (Phase 4) - ~2 hours
5. **Crash Recovery** (Phase 5) - ~1 hour
6. **Scheduled Cleanup** (Phase 6) - ~30 min
7. **UI Components** (Phase 7) - ~2 hours
8. **IPC Handlers** (Phase 8) - ~30 min
9. **Safety & Validation** (Phase 9) - ~1 hour
10. **Testing** (Phase 10) - ~2 hours

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Git version too old | Check `git --version` on startup, disable worktrees if < 2.17 |
| Disk space exhaustion | Monitor worktree count, warn at maxConcurrent |
| Windows path length | Use `\\?\` prefix for long paths, limit branch names |
| Orphaned worktrees on crash | Reconciliation on startup + scheduled cleanup |
| Concurrent worktree collision | Unique branch names with card ID + DB uniqueness constraint |
| npm install in worktree slow | Optional skipInstallIfCached for pnpm/yarn berry |

---

## Success Criteria

- [ ] Worker can process cards in isolated worktrees
- [ ] Main working tree is never modified by worker
- [ ] Crash recovery cleans up stale worktrees
- [ ] UI shows worktree status and allows manual management
- [ ] Policy allows fine-grained control over cleanup behavior
- [ ] All existing non-worktree functionality continues to work
- [ ] Path safety prevents accidental deletion of non-worktree directories
