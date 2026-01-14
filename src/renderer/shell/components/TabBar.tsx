/**
 * Chrome-like Tab Bar Component
 *
 * Features:
 * - Draggable tabs for reordering with smooth animations
 * - Close button appears on hover
 * - Rounded tab design with soft styling
 * - New tab button clearly visible
 * - Tab overflow with horizontal scroll
 * - Context menu (close, close others, close to right, duplicate)
 */

import { useState, useRef, useEffect } from 'react'
import { X, Plus, Loader2, Circle, CheckCircle2, AlertCircle, Bot } from 'lucide-react'
import { cn } from '../../src/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../src/components/ui/tooltip'

export interface TabData {
  id: string
  projectId: string
  projectName: string
  isLoading?: boolean
  workerStatus?: 'idle' | 'running' | 'ready' | 'error' | null
  activeRuns?: number
}

interface TabBarProps {
  tabs: TabData[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onTabMove?: (tabId: string, newIndex: number) => void
  onCloseOthers?: (tabId: string) => void
  onCloseToRight?: (tabId: string) => void
  onDuplicateTab?: (tabId: string) => void
}

export function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  onTabMove,
  onCloseOthers,
  onCloseToRight,
  onDuplicateTab
}: TabBarProps): React.JSX.Element {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    tabId: string
    x: number
    y: number
  } | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement>(null)

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    setDraggedTabId(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (draggedTabId && dragOverIndex !== null && onTabMove) {
      onTabMove(draggedTabId, dragOverIndex)
    }
    setDraggedTabId(null)
    setDragOverIndex(null)
  }

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    onTabClose(tabId)
  }

  return (
    <div
      className="flex h-10 bg-muted/40 border-b select-none overflow-hidden"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Tabs Container */}
      <div
        ref={tabsContainerRef}
        className="flex-1 flex items-end gap-0.5 px-1 overflow-x-auto overflow-y-hidden scrollbar-thin"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const isDragging = tab.id === draggedTabId
          const isDropTarget = index === dragOverIndex && draggedTabId !== tab.id

          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onTabClick(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={cn(
                'group relative flex items-center gap-2 px-3 h-8 min-w-[140px] max-w-[220px]',
                'cursor-pointer transition-all duration-200 ease-out',
                'rounded-t-xl mt-1',
                // Active state - elevated with clear background
                isActive && [
                  'bg-background',
                  'shadow-[0_-2px_8px_-2px_rgba(0,0,0,0.1)]',
                  'border-t border-l border-r border-border/60',
                  'z-10'
                ],
                // Inactive state
                !isActive && [
                  'bg-muted/30 hover:bg-muted/60',
                  'border border-transparent',
                  'hover:border-border/30'
                ],
                // Dragging state
                isDragging && 'opacity-40 scale-95',
                // Drop target indicator
                isDropTarget && 'ml-4 before:absolute before:left-[-8px] before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-primary'
              )}
            >
              {/* Worker status indicator */}
              {tab.isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
              ) : tab.workerStatus === 'running' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      {tab.activeRuns && tab.activeRuns > 0 && (
                        <span className="text-[10px] font-medium text-primary">{tab.activeRuns}</span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Worker running{tab.activeRuns && tab.activeRuns > 1 ? ` (${tab.activeRuns} tasks)` : ''}</p>
                  </TooltipContent>
                </Tooltip>
              ) : tab.workerStatus === 'error' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Worker error - check logs</p>
                  </TooltipContent>
                </Tooltip>
              ) : tab.workerStatus === 'idle' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Bot className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Worker enabled - idle</p>
                  </TooltipContent>
                </Tooltip>
              ) : tab.workerStatus === 'ready' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Worker completed successfully</p>
                  </TooltipContent>
                </Tooltip>
              ) : !isActive ? (
                <Circle className="h-1.5 w-1.5 fill-muted-foreground/40 text-transparent shrink-0" />
              ) : null}

              {/* Tab title */}
              <span
                className={cn(
                  'truncate text-sm flex-1 transition-colors',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                )}
              >
                {tab.projectName}
              </span>

              {/* Close button - visible on hover or when active */}
              <button
                onClick={(e) => handleCloseClick(e, tab.id)}
                className={cn(
                  'p-1 rounded-lg transition-all duration-150',
                  'hover:bg-destructive/10 hover:text-destructive',
                  // Visibility
                  'opacity-0 group-hover:opacity-100',
                  isActive && 'opacity-50 group-hover:opacity-100'
                )}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Close tab"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {/* Active tab bottom border cover */}
              {isActive && <div className="absolute -bottom-px left-0 right-0 h-px bg-background" />}
            </div>
          )
        })}

        {/* Drop zone at the end */}
        {draggedTabId && (
          <div
            onDragOver={(e) => handleDragOver(e, tabs.length)}
            className={cn(
              'w-6 h-8 flex items-center justify-center transition-all',
              dragOverIndex === tabs.length && 'ml-4 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-primary'
            )}
          />
        )}

        {/* New Tab Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onNewTab}
              className={cn(
                'flex items-center justify-center w-8 h-8 ml-1 mt-1',
                'rounded-lg transition-all duration-150',
                'text-muted-foreground hover:text-foreground',
                'hover:bg-muted/80 active:scale-95'
              )}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Plus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>New project tab</p>
          </TooltipContent>
        </Tooltip>

        {/* Spacer (draggable empty area) */}
        <div className="flex-1 min-w-4" />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenu.tabId}
          tabCount={tabs.length}
          tabIndex={tabs.findIndex((t) => t.id === contextMenu.tabId)}
          onClose={() => onTabClose(contextMenu.tabId)}
          onCloseOthers={onCloseOthers ? () => onCloseOthers(contextMenu.tabId) : undefined}
          onCloseToRight={onCloseToRight ? () => onCloseToRight(contextMenu.tabId) : undefined}
          onDuplicate={onDuplicateTab ? () => onDuplicateTab(contextMenu.tabId) : undefined}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Context Menu
// ============================================================================

interface ContextMenuProps {
  x: number
  y: number
  tabId: string
  tabCount: number
  tabIndex: number
  onClose: () => void
  onCloseOthers?: () => void
  onCloseToRight?: () => void
  onDuplicate?: () => void
  onDismiss: () => void
}

function ContextMenu({
  x,
  y,
  tabCount,
  tabIndex,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
  onDismiss
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Position menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`
      }
    }
  }, [x, y])

  const handleClick = (action: () => void) => {
    action()
    onDismiss()
  }

  const hasTabsToRight = tabIndex < tabCount - 1
  const hasOtherTabs = tabCount > 1

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-[180px] bg-popover border rounded-xl shadow-lg py-1.5',
        'animate-in fade-in-0 zoom-in-95 duration-150'
      )}
      style={{ left: x, top: y, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem onClick={() => handleClick(onClose)}>Close Tab</MenuItem>

      {onCloseOthers && (
        <MenuItem onClick={() => handleClick(onCloseOthers)} disabled={!hasOtherTabs}>
          Close Other Tabs
        </MenuItem>
      )}

      {onCloseToRight && (
        <MenuItem onClick={() => handleClick(onCloseToRight)} disabled={!hasTabsToRight}>
          Close Tabs to the Right
        </MenuItem>
      )}

      {onDuplicate && (
        <>
          <div className="h-px bg-border/50 my-1.5 mx-2" />
          <MenuItem onClick={() => handleClick(onDuplicate)}>Duplicate Tab</MenuItem>
        </>
      )}
    </div>
  )
}

interface MenuItemProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}

function MenuItem({ children, onClick, disabled }: MenuItemProps): React.JSX.Element {
  return (
    <button
      className={cn(
        'w-full text-left px-3 py-2 text-sm rounded-lg mx-1.5 transition-colors',
        'w-[calc(100%-0.75rem)]',
        disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'hover:bg-accent hover:text-accent-foreground'
      )}
      onClick={onClick}
      disabled={disabled}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {children}
    </button>
  )
}
