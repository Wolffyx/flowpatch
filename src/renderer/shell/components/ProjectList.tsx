/**
 * Project List Sidebar Component
 *
 * Displays the list of projects in the sidebar with:
 * - Provider icons (GitHub, GitLab, local)
 * - Selection highlighting
 * - Open/create actions
 */

import { FolderOpen, Plus, Trash2, Github, GitlabIcon, Folder } from 'lucide-react'
import { Button } from '../../src/components/ui/button'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { cn } from '../../src/lib/utils'
import type { Project } from '@shared/types'

interface ProjectListProps {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onOpenRepo: () => void
  onDeleteProject: (id: string) => void
}

export function ProjectList({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenRepo,
  onDeleteProject
}: ProjectListProps): React.JSX.Element {
  const getProviderIcon = (hint: string): React.ReactNode => {
    switch (hint) {
      case 'github':
        return <Github className="h-4 w-4" />
      case 'gitlab':
        return <GitlabIcon className="h-4 w-4" />
      default:
        return <Folder className="h-4 w-4" />
    }
  }

  return (
    <div className="flex h-full w-48 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Patchwork</h1>
        <Button variant="ghost" size="icon" onClick={onOpenRepo} title="Open or Create Repository">
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-2">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <Folder className="mb-4 h-12 w-12 opacity-50" />
            <p className="mb-2 text-sm">No projects yet</p>
            <Button variant="outline" size="sm" onClick={onOpenRepo}>
              <Plus className="mr-2 h-4 w-4" />
              Open / Create Repository
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  'group flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition-colors',
                  selectedProjectId === project.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={() => onSelectProject(project.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {getProviderIcon(project.provider_hint)}
                  <span className="truncate">{project.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity',
                    selectedProjectId === project.id && 'hover:bg-primary-foreground/20'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteProject(project.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-4">
        <Button variant="outline" className="w-full" onClick={onOpenRepo}>
          <Plus className="mr-2 h-4 w-4" />
          Open / Create
        </Button>
      </div>
    </div>
  )
}
