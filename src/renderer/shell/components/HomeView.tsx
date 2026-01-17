/**
 * Home View Component
 *
 * Welcome screen with grouped project list, search, and create/open actions.
 * Projects are grouped by provider (GitHub, GitLab, Local) with collapsible sections.
 */

import { useState, useMemo } from 'react'
import {
  Github,
  GitlabIcon,
  Folder,
  ChevronDown,
  ChevronRight,
  Search,
  Trash2,
  ExternalLink,
  FolderOpen,
  AlertCircle,
  Plus
} from 'lucide-react'
import { Button } from '../../src/components/ui/button'
import { Input } from '../../src/components/ui/input'
import { Badge } from '../../src/components/ui/badge'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { cn } from '../../src/lib/utils'
import type { Project } from '@shared/types'

type ProviderGroup = 'github' | 'gitlab' | 'local'

interface HomeViewProps {
  projects: Project[]
  onOpenProject: (project: Project) => void
  onRemoveProject: (project: Project) => void
  onOpenCreateDialog: () => void
}

/**
 * Determine the provider group for a project
 */
function getProviderGroup(project: Project): ProviderGroup {
  if (project.remote_repo_key?.includes('github.com') || project.provider_hint === 'github') {
    return 'github'
  }
  if (project.remote_repo_key?.includes('gitlab') || project.provider_hint === 'gitlab') {
    return 'gitlab'
  }
  return 'local'
}

/**
 * Get the provider icon component
 */
function ProviderIcon({
  provider,
  className
}: {
  provider: ProviderGroup
  className?: string
}): React.JSX.Element {
  switch (provider) {
    case 'github':
      return <Github className={className} />
    case 'gitlab':
      return <GitlabIcon className={className} />
    default:
      return <Folder className={className} />
  }
}

/**
 * Get provider display label
 */
function getProviderLabel(provider: ProviderGroup): string {
  switch (provider) {
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    default:
      return 'Local'
  }
}

/**
 * Extract short repo name from remote_repo_key
 * e.g., "github.com/user/repo" -> "user/repo"
 */
function getShortRepoKey(remoteRepoKey: string | null): string | null {
  if (!remoteRepoKey) return null
  // Remove domain prefix
  const match = remoteRepoKey.match(/(?:github\.com|gitlab\.com|gitlab\.[^/]+)\/(.+)/)
  return match ? match[1] : remoteRepoKey
}

/**
 * Truncate path for display, keeping the end visible
 */
function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path
  return '...' + path.slice(-(maxLength - 3))
}

/**
 * Convert remote_repo_key to a full browser URL
 * e.g., "github.com/user/repo" -> "https://github.com/user/repo"
 */
function getRemoteUrl(remoteRepoKey: string | null): string | null {
  if (!remoteRepoKey) return null
  // If already has protocol, return as-is
  if (remoteRepoKey.startsWith('http://') || remoteRepoKey.startsWith('https://')) {
    return remoteRepoKey
  }
  // Add https:// prefix
  return `https://${remoteRepoKey}`
}

/**
 * Open URL in external browser
 */
function openInBrowser(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function HomeView({
  projects,
  onOpenProject,
  onRemoveProject,
  onOpenCreateDialog
}: HomeViewProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<ProviderGroup>>(
    new Set(['github', 'gitlab', 'local'])
  )
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  // Filter and group projects
  const { groupedProjects, totalCount } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    // Filter projects by search query
    const filtered = projects.filter((p) => {
      if (!query) return true
      return (
        p.name.toLowerCase().includes(query) ||
        p.local_path.toLowerCase().includes(query) ||
        (p.remote_repo_key?.toLowerCase().includes(query) ?? false)
      )
    })

    // Group by provider
    const groups: Record<ProviderGroup, Project[]> = {
      github: [],
      gitlab: [],
      local: []
    }

    filtered.forEach((project) => {
      const group = getProviderGroup(project)
      groups[group].push(project)
    })

    return {
      groupedProjects: groups,
      totalCount: filtered.length
    }
  }, [projects, searchQuery])

  const toggleGroup = (group: ProviderGroup): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }

  const toggleProject = (projectId: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const providerOrder: ProviderGroup[] = ['github', 'gitlab', 'local']
  const hasProjects = projects.length > 0

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col items-center p-8 overflow-hidden">
      {/* Header */}
      <div className="text-center mb-8 mt-4">
        <h1 className="text-3xl font-bold text-foreground mb-2">Welcome to FlowPatch</h1>
        <p className="text-muted-foreground">Select a project or create a new one</p>
      </div>

      {/* Main content area */}
      <div className="w-full max-w-lg flex flex-col flex-1 min-h-0">
        {hasProjects && (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10"
              />
              {searchQuery && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {totalCount} found
                </span>
              )}
            </div>

            {/* Projects list */}
            <ScrollArea className="flex-1 -mx-2 px-2">
              <div className="space-y-3 pb-4">
                {providerOrder.map((provider) => {
                  const projectsInGroup = groupedProjects[provider]
                  if (projectsInGroup.length === 0) return null

                  const isExpanded = expandedGroups.has(provider)

                  return (
                    <div key={provider} className="rounded-xl border bg-card overflow-hidden">
                      {/* Group header */}
                      <button
                        type="button"
                        onClick={() => toggleGroup(provider)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                      >
                        <ProviderIcon provider={provider} className="h-5 w-5 text-muted-foreground" />
                        <span className="font-semibold text-sm flex-1 text-left">
                          {getProviderLabel(provider)}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-xs',
                            projectsInGroup.length > 0 && 'bg-primary/10 text-primary'
                          )}
                        >
                          {projectsInGroup.length}
                        </Badge>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>

                      {/* Projects in group */}
                      {isExpanded && (
                        <div className="border-t">
                          {projectsInGroup.map((project) => (
                            <ProjectCard
                              key={project.id}
                              project={project}
                              isExpanded={expandedProjects.has(project.id)}
                              onToggleExpand={() => toggleProject(project.id)}
                              onOpen={() => onOpenProject(project)}
                              onRemove={() => onRemoveProject(project)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Empty search state */}
                {totalCount === 0 && searchQuery && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No projects match "{searchQuery}"</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        )}

        {/* Empty state - no projects */}
        {!hasProjects && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <FolderOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground mb-2">No projects yet</p>
            <p className="text-sm text-muted-foreground/70 mb-6">
              Open an existing repository or create a new one to get started
            </p>
          </div>
        )}

        {/* Create/Open button */}
        <div className="pt-4 border-t mt-auto">
          <Button onClick={onOpenCreateDialog} className="w-full h-11 text-base gap-2">
            <Plus className="h-5 w-5" />
            Open / Create Project
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Individual project card with expand/collapse functionality
 */
interface ProjectCardProps {
  project: Project
  isExpanded: boolean
  onToggleExpand: () => void
  onOpen: () => void
  onRemove: () => void
}

function ProjectCard({
  project,
  isExpanded,
  onToggleExpand,
  onOpen,
  onRemove
}: ProjectCardProps): React.JSX.Element {
  const hasError = project.local_path_exists === false
  const shortRepoKey = getShortRepoKey(project.remote_repo_key)
  const remoteUrl = getRemoteUrl(project.remote_repo_key)

  const handleOpenRemote = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (remoteUrl) {
      openInBrowser(remoteUrl)
    }
  }

  return (
    <div
      className={cn(
        'border-b last:border-b-0 transition-colors',
        hasError && 'bg-destructive/5'
      )}
    >
      {/* Main row - always visible */}
      <div className="flex items-center gap-2 p-3 hover:bg-muted/30 transition-colors">
        {/* Expand/collapse button */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="p-1 rounded hover:bg-muted shrink-0"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* Project info - clickable to open */}
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left group"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {project.name}
            </span>
            {hasError && (
              <span title="Folder not found">
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              </span>
            )}
          </div>
          {!isExpanded && shortRepoKey && (
            <div className="text-xs text-muted-foreground truncate">{shortRepoKey}</div>
          )}
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Open in browser button - only show if has remote */}
          {remoteUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-chart-2"
              onClick={handleOpenRemote}
              title="Open in browser"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            title="Remove from recent projects"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pl-10 space-y-2 text-sm">
          {/* Local path */}
          <div className="flex items-start gap-2">
            <Folder className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground mb-0.5">Local Path</div>
              <div
                className={cn(
                  'font-mono text-xs break-all',
                  hasError ? 'text-destructive' : 'text-foreground'
                )}
                title={project.local_path}
              >
                {truncatePath(project.local_path, 60)}
              </div>
            </div>
          </div>

          {/* Remote info - clickable to open in browser */}
          {project.remote_repo_key && (
            <button
              type="button"
              onClick={handleOpenRemote}
              className={cn(
                'flex items-start gap-2 w-full text-left',
                'p-2 -m-2 rounded-lg',
                'hover:bg-muted/50 transition-colors group/remote',
                'cursor-pointer'
              )}
              title="Open in browser"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover/remote:text-chart-2 transition-colors" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1.5">
                  Remote ({project.selected_remote_name || 'origin'})
                  <span className="text-[10px] opacity-0 group-hover/remote:opacity-100 transition-opacity text-chart-2">
                    Click to open
                  </span>
                </div>
                <div className="font-mono text-xs text-foreground break-all group-hover/remote:text-chart-2 transition-colors">
                  {project.remote_repo_key}
                </div>
              </div>
            </button>
          )}

          {/* Missing folder warning */}
          {hasError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Folder not found at this location</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
