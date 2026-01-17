# Component Analysis: Tabs System Mode vs Legacy Main Renderer

## Overview

The application has **three renderers**:
1. **Shell Renderer** (`src/renderer/shell/`) - The new tabs system mode (main window with tab management)
2. **Project Renderer** (`src/renderer/project/`) - Individual project workspace (one per tab)
3. **Main Renderer** (`src/renderer/src/`) - Legacy/shared component library

The **Shell + Project** renderers form the new **tabs system mode**. The **Main (src)** renderer is the **old single-project mode** that is largely unused now.

---

## Analysis Summary

### Components ALREADY in Tabs System (Used)

#### Shell Renderer (`src/renderer/shell/`)
- [TabBar.tsx](src/renderer/shell/components/TabBar.tsx) - Chrome-like tabs
- [HomeView.tsx](src/renderer/shell/components/HomeView.tsx) - Project list/selection
- [LogsPanel.tsx](src/renderer/shell/components/LogsPanel.tsx) - Collapsible logs
- [ActivityDialog.tsx](src/renderer/shell/components/ActivityDialog.tsx) - Jobs list
- [GlobalAgentChatDialog.tsx](src/renderer/shell/components/GlobalAgentChatDialog.tsx) - Agent chat
- [SessionHistoryDialog.tsx](src/renderer/shell/components/SessionHistoryDialog.tsx) - History browser
- [ShellToaster.tsx](src/renderer/shell/components/ShellToaster.tsx) - Notifications
- [settings/SettingsModal.tsx](src/renderer/shell/components/settings/SettingsModal.tsx) - Shell settings
- All `settings/` subcomponents (AI agents, appearance, shortcuts, etc.)

#### Project Renderer (`src/renderer/project/`)
- [WorkspaceDialog.tsx](src/renderer/project/components/WorkspaceDialog.tsx) - FlowPatch workspace management
- [UsageIndicator.tsx](src/renderer/project/components/UsageIndicator.tsx) - Usage/cost tracking

#### Shared Components Used by Project Renderer (from `src/renderer/src/`)
- [KanbanBoard.tsx](src/renderer/src/components/KanbanBoard.tsx) ✅
- [KanbanColumn.tsx](src/renderer/src/components/KanbanColumn.tsx) ✅
- [KanbanCard.tsx](src/renderer/src/components/KanbanCard.tsx) ✅
- [CardDrawer.tsx](src/renderer/src/components/CardDrawer.tsx) ✅
- [AddCardDialog.tsx](src/renderer/src/components/AddCardDialog.tsx) ✅
- [WorkerLogDialog.tsx](src/renderer/src/components/WorkerLogDialog.tsx) ✅
- [FollowUpInstructionDialog.tsx](src/renderer/src/components/FollowUpInstructionDialog.tsx) ✅
- [PlanApprovalDialog.tsx](src/renderer/src/components/PlanApprovalDialog.tsx) ✅
- [StarterCardsWizardDialog.tsx](src/renderer/src/components/StarterCardsWizardDialog.tsx) ✅
- [LabelSetupDialog.tsx](src/renderer/src/components/LabelSetupDialog.tsx) ✅
- [GithubProjectPromptDialog.tsx](src/renderer/src/components/GithubProjectPromptDialog.tsx) ✅
- [PullRequestsSection.tsx](src/renderer/src/components/PullRequestsSection.tsx) ✅
- [PullRequestCard.tsx](src/renderer/src/components/PullRequestCard.tsx) ✅
- [FeatureSuggestionsDialog.tsx](src/renderer/src/components/FeatureSuggestionsDialog.tsx) ✅
- [GraphViewDialog.tsx](src/renderer/src/components/GraphViewDialog.tsx) ✅
- All `ui/*` components (button, badge, dialog, etc.) ✅

#### Shared Components Used by Shell Renderer (from `src/renderer/src/`)
- [RepoStartDialog.tsx](src/renderer/src/components/RepoStartDialog.tsx) ✅
- All `ui/*` components ✅

---

### Components NOT Used in Tabs System Mode

These components exist in `src/renderer/src/` but are **NOT imported** by either Shell or Project renderer:

| Component | Purpose | Status |
|-----------|---------|--------|
| [Sidebar.tsx](src/renderer/src/components/Sidebar.tsx) | Project list sidebar | **NOT USED** - Replaced by HomeView in shell |
| [TopBar.tsx](src/renderer/src/components/TopBar.tsx) | Project toolbar | **NOT USED** - Functionality in project toolbar |
| [CommandPalette.tsx](src/renderer/src/components/CommandPalette.tsx) | Keyboard-driven command menu | **NOT USED** - Not in tabs system |
| [RemoteSelector.tsx](src/renderer/src/components/RemoteSelector.tsx) | Git remote selection dialog | **NOT USED** - Not in tabs system |
| [StartupCheckDialog.tsx](src/renderer/src/components/StartupCheckDialog.tsx) | CLI agent availability check | **NOT USED** - Not in tabs system |
| [SettingsDialog.tsx](src/renderer/src/components/SettingsDialog.tsx) | Legacy settings modal | **NOT USED** - Shell has SettingsModal |
| [ShortcutsEditor.tsx](src/renderer/src/components/ShortcutsEditor.tsx) | Keyboard shortcuts config | **NOT USED** - Shell has ShortcutsSection |
| [AgentChatDialog.tsx](src/renderer/src/components/AgentChatDialog.tsx) | Per-card agent chat | **NOT USED** - Shell has GlobalAgentChatDialog |
| [AgentChatPanel.tsx](src/renderer/src/components/AgentChatPanel.tsx) | Agent chat panel | **NOT USED** - Shell has GlobalAgentChatDialog |
| [GitDiffDialog.tsx](src/renderer/src/components/GitDiffDialog.tsx) | Git diff viewer dialog | **NOT USED** - Not in tabs system |
| [GitDiffViewer.tsx](src/renderer/src/components/GitDiffViewer.tsx) | Git diff component | **NOT USED** - Not in tabs system |
| [DependencyManager.tsx](src/renderer/src/components/DependencyManager.tsx) | Card dependencies | **NOT USED** - Not in tabs system |
| [AIDescriptionDialog.tsx](src/renderer/src/components/AIDescriptionDialog.tsx) | AI description generation | **NOT USED** - Not in tabs system |

---

### Features/Functionality to Move to Tabs System

Based on the analysis, these features exist in the old main renderer but are **missing from the tabs system**:

1. **CommandPalette** - Keyboard-driven command menu (Cmd+K)
   - Location: [src/renderer/src/components/CommandPalette.tsx](src/renderer/src/components/CommandPalette.tsx)
   - Should be added to: Shell App or Project App

2. **StartupCheckDialog** - First-launch CLI agent check
   - Location: [src/renderer/src/components/StartupCheckDialog.tsx](src/renderer/src/components/StartupCheckDialog.tsx)
   - Should be added to: Shell App (global check on startup)

3. **RemoteSelector** - Git remote selection when multiple remotes exist
   - Location: [src/renderer/src/components/RemoteSelector.tsx](src/renderer/src/components/RemoteSelector.tsx)
   - Should be added to: Project App or Shell (during project open)

4. **GitDiff components** - View git diffs for changes
   - Location: [src/renderer/src/components/GitDiffDialog.tsx](src/renderer/src/components/GitDiffDialog.tsx), [GitDiffViewer.tsx](src/renderer/src/components/GitDiffViewer.tsx)
   - Should be added to: CardDrawer or WorkspaceDialog

5. **DependencyManager** - Manage card dependencies
   - Location: [src/renderer/src/components/DependencyManager.tsx](src/renderer/src/components/DependencyManager.tsx)
   - Should be added to: CardDrawer

6. **AIDescriptionDialog** - AI-powered description generation
   - Location: [src/renderer/src/components/AIDescriptionDialog.tsx](src/renderer/src/components/AIDescriptionDialog.tsx)
   - Should be added to: AddCardDialog or CardDrawer

7. **Per-card AgentChat** - Chat with agent about specific card
   - Location: [src/renderer/src/components/AgentChatDialog.tsx](src/renderer/src/components/AgentChatDialog.tsx), [AgentChatPanel.tsx](src/renderer/src/components/AgentChatPanel.tsx)
   - Current: Shell has GlobalAgentChatDialog which is job-based
   - Consideration: May want card-specific chat in CardDrawer

---

### Files That Can Be Removed (Unused)

These components/files are **NOT USED** by the tabs system and appear to be legacy:

1. **[Sidebar.tsx](src/renderer/src/components/Sidebar.tsx)** - Old project list sidebar
   - Replaced by: HomeView.tsx in shell

2. **[TopBar.tsx](src/renderer/src/components/TopBar.tsx)** - Old project toolbar
   - Replaced by: Project App toolbar + shell tab bar

3. **[SettingsDialog.tsx](src/renderer/src/components/SettingsDialog.tsx)** - Old settings modal
   - Replaced by: Shell SettingsModal with sections

4. **[ShortcutsEditor.tsx](src/renderer/src/components/ShortcutsEditor.tsx)** - Old shortcuts editor
   - Replaced by: Shell ShortcutsSection

5. **[src/renderer/src/App.tsx](src/renderer/src/App.tsx)** - Main renderer entry point
   - NOT USED in tabs mode (shell and project have their own App.tsx)

6. **[src/renderer/src/main.tsx](src/renderer/src/main.tsx)** - Main renderer bootstrap
   - NOT USED in tabs mode

7. **[src/renderer/src/store/](src/renderer/src/store/)** - All store files
   - useAppStore.ts, useProjects.ts, useCards.ts, useWorker.ts, useSync.ts, useUISettings.ts
   - NOT USED by project renderer (it uses direct IPC calls)

9. **[src/renderer/src/lib/useShortcuts.ts](src/renderer/src/lib/useShortcuts.ts)** - Shortcuts hook
   - Only used by old main App.tsx

---

## Recommendations

### Features to Add to Tabs System

| Feature | Priority | Target Location |
|---------|----------|-----------------|
| CommandPalette | High | Shell App (Cmd+K global) |
| StartupCheckDialog | Medium | Shell App (first launch) |
| RemoteSelector | Medium | Shell App or Project |
| GitDiff components | Medium | CardDrawer |
| DependencyManager | Medium | CardDrawer |
| AIDescriptionDialog | Low | AddCardDialog |
| Per-card AgentChat | Low | Already have GlobalAgentChatDialog |

### Files Safe to Remove

| File | Confidence | Reason |
|------|------------|--------|
| Sidebar.tsx | High | Replaced by HomeView |
| TopBar.tsx | High | Replaced by project toolbar |
| SettingsDialog.tsx | High | Replaced by SettingsModal |
| ShortcutsEditor.tsx | High | Replaced by ShortcutsSection |
| src/App.tsx | High | Main renderer not used |
| src/main.tsx | High | Main renderer not used |
| src/store/*.ts | High | Project uses direct IPC |
| src/lib/useShortcuts.ts | High | Only used by old main App |

### Files to Keep (Shared Components)

**MUST KEEP:**
- `src/renderer/src/context/ThemeContext.tsx` - Used by project renderer via `project/main.tsx`
- `src/renderer/src/components/ui/sonner.tsx` - Uses ThemeContext, used by project renderer
- All UI primitives in `src/renderer/src/components/ui/` - Used by both shell and project
- All dialogs imported by project renderer (see "Already Used" section above)

---

## Implementation Plan

### Phase 1: Move Missing Features to Tabs System

#### 1.1 Add CommandPalette to Shell App (High Priority)
**Files to modify:**
- [src/renderer/shell/App.tsx](src/renderer/shell/App.tsx)

**Changes:**
1. Import CommandPalette from `../src/components/CommandPalette`
2. Add `commandPaletteOpen` state
3. Add keyboard shortcut handler for Cmd+K
4. Render CommandPalette with appropriate handlers:
   - `onOpenRepo` → `setRepoDialogOpen(true)`
   - `onSync` → trigger sync for active project
   - `onRunWorker` → trigger worker for active project
   - `onAddCard` → navigate to project and open add card dialog

#### 1.2 Add StartupCheckDialog to Shell App (Medium Priority)
**Files to modify:**
- [src/renderer/shell/App.tsx](src/renderer/shell/App.tsx)

**Changes:**
1. Import StartupCheckDialog from `../src/components/StartupCheckDialog`
2. Add `startupCheckOpen` state
3. Add useEffect to check CLI agents on first launch (from old App.tsx logic)
4. Render StartupCheckDialog

#### 1.3 Add RemoteSelector to Shell App (Medium Priority)
**Files to modify:**
- [src/renderer/shell/App.tsx](src/renderer/shell/App.tsx) OR create new hook

**Changes:**
1. Import RemoteSelector from `../src/components/RemoteSelector`
2. Add state for pending remote selection
3. Hook into project open flow to show RemoteSelector when multiple remotes exist
4. Render RemoteSelector dialog

#### 1.4 Add GitDiff to CardDrawer (Medium Priority)
**Files to modify:**
- [src/renderer/src/components/CardDrawer.tsx](src/renderer/src/components/CardDrawer.tsx)

**Changes:**
1. Import GitDiffDialog from `./GitDiffDialog`
2. Add button to view git diff for card's worktree
3. Add state and dialog rendering

#### 1.5 Add DependencyManager to CardDrawer (Medium Priority)
**Files to modify:**
- [src/renderer/src/components/CardDrawer.tsx](src/renderer/src/components/CardDrawer.tsx)

**Changes:**
1. Import DependencyManager from `./DependencyManager`
2. Add section in CardDrawer for managing dependencies
3. Hook up to projectAPI for dependency operations

#### 1.6 Add AIDescriptionDialog to AddCardDialog (Low Priority)
**Files to modify:**
- [src/renderer/src/components/AddCardDialog.tsx](src/renderer/src/components/AddCardDialog.tsx)

**Changes:**
1. Import AIDescriptionDialog
2. Add "Generate with AI" button
3. Handle AI-generated description insertion

---

### Phase 2: Remove Unused Files

After moving features, the following files can be safely deleted:

#### Components (src/renderer/src/components/)
```
src/renderer/src/components/Sidebar.tsx          # Replaced by HomeView
src/renderer/src/components/TopBar.tsx           # Replaced by project toolbar
src/renderer/src/components/SettingsDialog.tsx   # Replaced by SettingsModal
src/renderer/src/components/ShortcutsEditor.tsx  # Replaced by ShortcutsSection
```

#### Store (src/renderer/src/store/)
```
src/renderer/src/store/useAppStore.ts
src/renderer/src/store/useProjects.ts
src/renderer/src/store/useCards.ts
src/renderer/src/store/useWorker.ts
src/renderer/src/store/useSync.ts
src/renderer/src/store/useUISettings.ts
src/renderer/src/store/index.ts
```

#### Main Renderer Entry (src/renderer/src/)
```
src/renderer/src/App.tsx    # Old main renderer entry
src/renderer/src/main.tsx   # Old main renderer bootstrap
```

#### Lib (src/renderer/src/lib/)
```
src/renderer/src/lib/useShortcuts.ts  # Only used by old App.tsx
```

---

### Files to KEEP (Shared by Tabs System)

**Context:**
- `src/renderer/src/context/ThemeContext.tsx` - Used by project renderer

**UI Primitives:**
- All files in `src/renderer/src/components/ui/`

**Shared Components (used by project renderer):**
- KanbanBoard.tsx, KanbanColumn.tsx, KanbanCard.tsx
- CardDrawer.tsx
- AddCardDialog.tsx
- WorkerLogDialog.tsx
- FollowUpInstructionDialog.tsx
- PlanApprovalDialog.tsx
- StarterCardsWizardDialog.tsx
- LabelSetupDialog.tsx
- GithubProjectPromptDialog.tsx
- PullRequestsSection.tsx, PullRequestCard.tsx
- FeatureSuggestionsDialog.tsx
- GraphViewDialog.tsx
- RepoStartDialog.tsx (used by shell)

**Components to keep for feature migration:**
- CommandPalette.tsx (will be added to shell)
- StartupCheckDialog.tsx (will be added to shell)
- RemoteSelector.tsx (will be added to shell)
- GitDiffDialog.tsx, GitDiffViewer.tsx (will be added to CardDrawer)
- DependencyManager.tsx (will be added to CardDrawer)
- AIDescriptionDialog.tsx (will be added to AddCardDialog)
- AgentChatDialog.tsx, AgentChatPanel.tsx (keep for potential per-card chat)

---

## Verification

1. **Build the app**: `npm run build` - ensure no import errors
2. **Run the app**: Verify shell opens with tabs
3. **Test features**:
   - Cmd+K opens CommandPalette in shell
   - First launch shows StartupCheckDialog
   - Multiple remotes show RemoteSelector
   - CardDrawer has GitDiff and Dependencies sections
4. **Verify no regressions**: All existing functionality still works

---

## Summary

**Files to Remove (12 files):**
1. `src/renderer/src/components/Sidebar.tsx`
2. `src/renderer/src/components/TopBar.tsx`
3. `src/renderer/src/components/SettingsDialog.tsx`
4. `src/renderer/src/components/ShortcutsEditor.tsx`
5. `src/renderer/src/App.tsx`
6. `src/renderer/src/main.tsx`
7. `src/renderer/src/store/useAppStore.ts`
8. `src/renderer/src/store/useProjects.ts`
9. `src/renderer/src/store/useCards.ts`
10. `src/renderer/src/store/useWorker.ts`
11. `src/renderer/src/store/useSync.ts`
12. `src/renderer/src/store/useUISettings.ts`
13. `src/renderer/src/store/index.ts`
14. `src/renderer/src/lib/useShortcuts.ts`

**Features to Move (6 features):**
1. CommandPalette → Shell App
2. StartupCheckDialog → Shell App
3. RemoteSelector → Shell App
4. GitDiff components → CardDrawer
5. DependencyManager → CardDrawer
6. AIDescriptionDialog → AddCardDialog
