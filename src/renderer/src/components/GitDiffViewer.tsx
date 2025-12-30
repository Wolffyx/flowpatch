/**
 * Git Diff Viewer Component
 *
 * A custom diff viewer that displays file changes with syntax highlighting.
 * Supports side-by-side and inline diff views.
 */

import { useState, useEffect, useMemo } from 'react'
import { FileCode, Plus, Minus, FileX, FilePlus, ArrowRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'

// ============================================================================
// Types
// ============================================================================

interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  additions: number
  deletions: number
  oldPath?: string
}

interface FileDiff {
  filePath: string
  oldContent: string
  newContent: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

interface DiffLine {
  type: 'context' | 'add' | 'remove' | 'header'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

interface GitDiffViewerProps {
  worktreeId: string
  viewMode?: 'inline' | 'side-by-side'
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function getFileStatusInfo(status: DiffFile['status']): {
  label: string
  color: string
  icon: React.ReactNode
} {
  switch (status) {
    case 'A':
      return { label: 'Added', color: 'text-green-500', icon: <FilePlus className="h-4 w-4" /> }
    case 'M':
      return { label: 'Modified', color: 'text-yellow-500', icon: <FileCode className="h-4 w-4" /> }
    case 'D':
      return { label: 'Deleted', color: 'text-red-500', icon: <FileX className="h-4 w-4" /> }
    case 'R':
      return { label: 'Renamed', color: 'text-blue-500', icon: <ArrowRight className="h-4 w-4" /> }
    case 'C':
      return { label: 'Copied', color: 'text-purple-500', icon: <FileCode className="h-4 w-4" /> }
    default:
      return { label: 'Changed', color: 'text-muted-foreground', icon: <FileCode className="h-4 w-4" /> }
  }
}

function computeDiffLines(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const result: DiffLine[] = []

  // Simple LCS-based diff algorithm
  const lcs = computeLCS(oldLines, newLines)
  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        // Context line (same in both)
        result.push({
          type: 'context',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1,
          newLineNumber: newIdx + 1
        })
        oldIdx++
        newIdx++
        lcsIdx++
      } else {
        // Line added in new
        result.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNumber: newIdx + 1
        })
        newIdx++
      }
    } else if (lcsIdx < lcs.length && newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
      // Line removed from old
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1
      })
      oldIdx++
    } else if (oldIdx < oldLines.length && newIdx < newLines.length) {
      // Both have changes
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1
      })
      oldIdx++
    } else if (oldIdx < oldLines.length) {
      // Only old has remaining lines
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1
      })
      oldIdx++
    } else if (newIdx < newLines.length) {
      // Only new has remaining lines
      result.push({
        type: 'add',
        content: newLines[newIdx],
        newLineNumber: newIdx + 1
      })
      newIdx++
    }
  }

  return result
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

// ============================================================================
// Components
// ============================================================================

function FileListItem({
  file,
  isSelected,
  onClick
}: {
  file: DiffFile
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  const statusInfo = getFileStatusInfo(file.status)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md transition-colors',
        'hover:bg-muted/50 flex items-center gap-2',
        isSelected && 'bg-muted'
      )}
    >
      <span className={statusInfo.color}>{statusInfo.icon}</span>
      <span className="flex-1 truncate text-sm font-mono">{file.path}</span>
      <div className="flex items-center gap-1 text-xs">
        {file.additions > 0 && (
          <span className="text-green-500 flex items-center">
            <Plus className="h-3 w-3" />
            {file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-red-500 flex items-center">
            <Minus className="h-3 w-3" />
            {file.deletions}
          </span>
        )}
      </div>
    </button>
  )
}

function InlineDiffView({ diff }: { diff: FileDiff }): React.JSX.Element {
  const lines = useMemo(
    () => computeDiffLines(diff.oldContent, diff.newContent),
    [diff.oldContent, diff.newContent]
  )

  return (
    <div className="font-mono text-xs">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            'flex',
            line.type === 'add' && 'bg-green-500/10',
            line.type === 'remove' && 'bg-red-500/10',
            line.type === 'header' && 'bg-blue-500/10 text-blue-500'
          )}
        >
          <span className="w-12 text-right pr-2 text-muted-foreground select-none border-r border-border">
            {line.oldLineNumber ?? ''}
          </span>
          <span className="w-12 text-right pr-2 text-muted-foreground select-none border-r border-border">
            {line.newLineNumber ?? ''}
          </span>
          <span
            className={cn(
              'w-6 text-center select-none',
              line.type === 'add' && 'text-green-500',
              line.type === 'remove' && 'text-red-500'
            )}
          >
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          <pre className="flex-1 whitespace-pre-wrap break-all pl-2">{line.content}</pre>
        </div>
      ))}
    </div>
  )
}

function SideBySideDiffView({ diff }: { diff: FileDiff }): React.JSX.Element {
  const lines = useMemo(
    () => computeDiffLines(diff.oldContent, diff.newContent),
    [diff.oldContent, diff.newContent]
  )

  // Pair up lines for side-by-side view
  const pairs: Array<{ left?: DiffLine; right?: DiffLine }> = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'context') {
      pairs.push({ left: line, right: line })
      i++
    } else if (line.type === 'remove') {
      // Look ahead for an add
      const nextLine = lines[i + 1]
      if (nextLine?.type === 'add') {
        pairs.push({ left: line, right: nextLine })
        i += 2
      } else {
        pairs.push({ left: line, right: undefined })
        i++
      }
    } else if (line.type === 'add') {
      pairs.push({ left: undefined, right: line })
      i++
    } else {
      i++
    }
  }

  return (
    <div className="font-mono text-xs flex">
      {/* Left side (old) */}
      <div className="flex-1 border-r border-border">
        {pairs.map((pair, idx) => (
          <div
            key={idx}
            className={cn(
              'flex',
              pair.left?.type === 'remove' && 'bg-red-500/10',
              !pair.left && 'bg-muted/30'
            )}
          >
            <span className="w-12 text-right pr-2 text-muted-foreground select-none border-r border-border">
              {pair.left?.oldLineNumber ?? ''}
            </span>
            <span
              className={cn('w-6 text-center select-none', pair.left?.type === 'remove' && 'text-red-500')}
            >
              {pair.left?.type === 'remove' ? '-' : ' '}
            </span>
            <pre className="flex-1 whitespace-pre-wrap break-all pl-2">
              {pair.left?.content ?? ''}
            </pre>
          </div>
        ))}
      </div>

      {/* Right side (new) */}
      <div className="flex-1">
        {pairs.map((pair, idx) => (
          <div
            key={idx}
            className={cn(
              'flex',
              pair.right?.type === 'add' && 'bg-green-500/10',
              !pair.right && 'bg-muted/30'
            )}
          >
            <span className="w-12 text-right pr-2 text-muted-foreground select-none border-r border-border">
              {pair.right?.newLineNumber ?? ''}
            </span>
            <span
              className={cn('w-6 text-center select-none', pair.right?.type === 'add' && 'text-green-500')}
            >
              {pair.right?.type === 'add' ? '+' : ' '}
            </span>
            <pre className="flex-1 whitespace-pre-wrap break-all pl-2">
              {pair.right?.content ?? ''}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function GitDiffViewer({
  worktreeId,
  viewMode = 'inline',
  className
}: GitDiffViewerProps): React.JSX.Element {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load file list
  useEffect(() => {
    const loadFiles = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.projectAPI.getDiffFiles(worktreeId)
        if (result.error) {
          setError(result.error)
        } else {
          setFiles(result.files)
          if (result.files.length > 0 && !selectedFile) {
            setSelectedFile(result.files[0].path)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load files')
      } finally {
        setLoading(false)
      }
    }

    loadFiles()
  }, [worktreeId])

  // Load selected file diff
  useEffect(() => {
    if (!selectedFile) {
      setFileDiff(null)
      return
    }

    const loadDiff = async (): Promise<void> => {
      try {
        const result = await window.projectAPI.getFileDiff(worktreeId, selectedFile)
        if (result.error) {
          console.error('Failed to load diff:', result.error)
        } else {
          setFileDiff(result.diff)
        }
      } catch (err) {
        console.error('Failed to load diff:', err)
      }
    }

    loadDiff()
  }, [worktreeId, selectedFile])

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="text-muted-foreground">Loading diff...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="text-destructive">{error}</div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="text-muted-foreground">No changes found</div>
      </div>
    )
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Stats header */}
      <div className="flex items-center gap-4 p-3 border-b bg-muted/30">
        <Badge variant="outline">{files.length} files changed</Badge>
        <span className="text-green-500 text-sm flex items-center gap-1">
          <Plus className="h-3 w-3" />
          {totalAdditions}
        </span>
        <span className="text-red-500 text-sm flex items-center gap-1">
          <Minus className="h-3 w-3" />
          {totalDeletions}
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* File list sidebar */}
        <div className="w-64 border-r flex flex-col min-h-0">
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {files.map((file) => (
                <FileListItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onClick={() => setSelectedFile(file.path)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Diff content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {fileDiff ? (
            <>
              {/* File header */}
              <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
                <span className="font-mono text-sm">{fileDiff.filePath}</span>
                <Badge
                  variant={
                    fileDiff.status === 'added'
                      ? 'default'
                      : fileDiff.status === 'deleted'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {fileDiff.status}
                </Badge>
              </div>

              {/* Diff view */}
              <ScrollArea className="flex-1">
                {viewMode === 'inline' ? (
                  <InlineDiffView diff={fileDiff} />
                ) : (
                  <SideBySideDiffView diff={fileDiff} />
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Select a file to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
