/**
 * Chrome-like Tab Bar Component
 *
 * Features:
 * - Draggable tabs for reordering
 * - Close button on each tab
 * - New tab button
 * - Tab overflow with scroll
 * - Context menu (close, close others, close to right, duplicate)
 */

import { useState, useRef, useEffect } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { cn } from '../../src/lib/utils'

export interface TabData {
  id: string
  projectId: string
  projectName: string
  isLoading?: boolean
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
      className="flex h-9 bg-muted/50 border-b select-none overflow-hidden"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Tabs Container */}
      <div
        ref={tabsContainerRef}
        className="flex-1 flex items-end overflow-x-auto overflow-y-hidden scrollbar-none"
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
                'group relative flex items-center gap-2 px-3 h-8 min-w-[120px] max-w-[200px]',
                'border-r border-border/50 cursor-pointer transition-colors',
                'rounded-t-lg -mb-px',
                isActive
                  ? 'bg-background border-t border-l border-r border-border z-10'
                  : 'bg-muted/30 hover:bg-muted/60',
                isDragging && 'opacity-50',
                isDropTarget && 'border-l-2 border-l-primary'
              )}
            >
              {/* Loading indicator */}
              {tab.isLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
              )}

              {/* Tab title */}
              <span className="truncate text-sm flex-1">{tab.projectName}</span>

              {/* Close button */}
              <button
                onClick={(e) => handleCloseClick(e, tab.id)}
                className={cn(
                  'p-0.5 rounded hover:bg-muted-foreground/20 transition-opacity',
                  'opacity-0 group-hover:opacity-100',
                  isActive && 'opacity-60 group-hover:opacity-100'
                )}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {/* Active tab bottom border cover */}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-px bg-background" />}
            </div>
          )
        })}

        {/* Drop zone at the end */}
        {draggedTabId && (
          <div
            onDragOver={(e) => handleDragOver(e, tabs.length)}
            className={cn(
              'w-8 h-8 flex items-center justify-center',
              dragOverIndex === tabs.length && 'border-l-2 border-l-primary'
            )}
          />
        )}

        {/* New Tab Button - sits after the last tab */}
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-9 h-9 hover:bg-muted/60 transition-colors"
          title="Open new project"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Spacer (draggable empty area) */}
        <div className="flex-1" />
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
      className="fixed z-50 min-w-[160px] bg-popover border rounded-md shadow-md py-1"
      style={{ left: x, top: y, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem onClick={() => handleClick(onClose)}>Close</MenuItem>

      {onCloseOthers && (
        <MenuItem onClick={() => handleClick(onCloseOthers)} disabled={!hasOtherTabs}>
          Close Others
        </MenuItem>
      )}

      {onCloseToRight && (
        <MenuItem onClick={() => handleClick(onCloseToRight)} disabled={!hasTabsToRight}>
          Close Tabs to the Right
        </MenuItem>
      )}

      {onDuplicate && (
        <>
          <div className="h-px bg-border my-1" />
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
        'w-full text-left px-3 py-1.5 text-sm',
        disabled
          ? 'text-muted-foreground cursor-not-allowed'
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
