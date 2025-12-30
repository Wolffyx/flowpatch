/**
 * Session History Dialog
 *
 * Shows past worker sessions (agent runs) with their chat history.
 * Allows viewing historical conversations and session details.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '../../src/components/ui/dialog'
import { Button } from '../../src/components/ui/button'
import { Badge } from '../../src/components/ui/badge'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { Input } from '../../src/components/ui/input'
import {
  History,
  ChevronLeft,
  Search,
  Bot,
  User,
  AlertCircle,
  Loader2,
  Calendar,
  Clock,
  MessageSquare,
  FileCode,
  CheckCircle2,
  XCircle,
  Play
} from 'lucide-react'
import type { Job, JobResultEnvelope } from '@shared/types'
import { cn } from '../../src/lib/utils'

// Types matching the shell preload
interface AgentChatMessage {
  id: string
  job_id: string
  card_id: string
  project_id: string
  role: 'user' | 'agent' | 'system'
  content: string
  status: 'sent' | 'delivered' | 'read' | 'error'
  metadata_json?: string
  created_at: string
  updated_at?: string
}

interface SessionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: Job[]
  projectNameById: Record<string, string>
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === now.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })
}

function parseResult(job: Job): JobResultEnvelope | null {
  if (!job.result_json) return null
  try {
    return JSON.parse(job.result_json) as JobResultEnvelope
  } catch {
    return null
  }
}

function getSessionStateIcon(state: Job['state']): React.ReactNode {
  switch (state) {
    case 'succeeded':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'failed':
    case 'blocked':
      return <XCircle className="h-4 w-4 text-destructive" />
    case 'running':
    case 'queued':
      return <Play className="h-4 w-4 text-blue-500" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

export function SessionHistoryDialog({
  open,
  onOpenChange,
  jobs,
  projectNameById
}: SessionHistoryDialogProps): React.JSX.Element {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [messages, setMessages] = useState<AgentChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Filter to only worker_run jobs (agent sessions)
  const workerSessions = useMemo(() => {
    return jobs
      .filter((j) => j.type === 'worker_run')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [jobs])

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return workerSessions
    const query = searchQuery.toLowerCase()
    return workerSessions.filter((job) => {
      const projectName = projectNameById[job.project_id]?.toLowerCase() || ''
      const result = parseResult(job)
      const summary = result?.summary?.toLowerCase() || ''
      return projectName.includes(query) || summary.includes(query)
    })
  }, [workerSessions, searchQuery, projectNameById])

  // Group sessions by date
  const sessionsByDate = useMemo(() => {
    const groups: Record<string, Job[]> = {}
    for (const job of filteredSessions) {
      const dateKey = new Date(job.created_at).toDateString()
      if (!groups[dateKey]) groups[dateKey] = []
      groups[dateKey].push(job)
    }
    return groups
  }, [filteredSessions])

  // Load messages when a job is selected
  useEffect(() => {
    if (!selectedJob) {
      setMessages([])
      return
    }

    const loadMessages = async (): Promise<void> => {
      setLoading(true)
      try {
        const result = await window.shellAPI.getChatMessages(selectedJob.id)
        if (!result.error) {
          setMessages(result.messages)
        }
      } catch (err) {
        console.error('Failed to load messages:', err)
      } finally {
        setLoading(false)
      }
    }

    loadMessages()
  }, [selectedJob?.id])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Reset selection when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedJob(null)
      setMessages([])
      setSearchQuery('')
    }
  }, [open])

  const sessionCount = workerSessions.length
  const completedCount = workerSessions.filter((j) => j.state === 'succeeded').length
  const failedCount = workerSessions.filter((j) => j.state === 'failed').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[75vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            {selectedJob && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 -ml-2"
                onClick={() => setSelectedJob(null)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <History className="h-5 w-5" />
            <DialogTitle>
              {selectedJob
                ? `Session • ${projectNameById[selectedJob.project_id] || 'Unknown'}`
                : 'Session History'}
            </DialogTitle>
            {!selectedJob && (
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span>{sessionCount} sessions</span>
                <span className="text-green-500">{completedCount} completed</span>
                {failedCount > 0 && <span className="text-destructive">{failedCount} failed</span>}
              </div>
            )}
          </div>
        </DialogHeader>

        {!selectedJob ? (
          // Session list view
          <>
            {/* Search */}
            <div className="px-4 py-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions..."
                  className="pl-9"
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-6">
                {Object.keys(sessionsByDate).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No sessions found</p>
                    <p className="text-sm mt-1">
                      {searchQuery ? 'Try a different search term' : 'Run a worker on a card to create a session'}
                    </p>
                  </div>
                ) : (
                  Object.entries(sessionsByDate).map(([dateKey, dateJobs]) => (
                    <div key={dateKey}>
                      <div className="flex items-center gap-2 mb-3">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">
                          {formatDateGroup(dateJobs[0].created_at)}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {dateJobs.map((job) => {
                          const result = parseResult(job)
                          const summary = result?.summary || job.last_error || 'No summary available'
                          const projectName = projectNameById[job.project_id] || 'Unknown Project'

                          return (
                            <button
                              key={job.id}
                              onClick={() => setSelectedJob(job)}
                              className="w-full p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5">{getSessionStateIcon(job.state)}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="font-medium text-sm truncate">{projectName}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                      {formatDateTime(job.created_at)}
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground line-clamp-2">{summary}</p>
                                  <div className="flex items-center gap-2 mt-2">
                                    <Badge
                                      variant={
                                        job.state === 'succeeded'
                                          ? 'default'
                                          : job.state === 'failed'
                                            ? 'destructive'
                                            : 'secondary'
                                      }
                                      className="text-xs"
                                    >
                                      {job.state}
                                    </Badge>
                                    {job.card_id && (
                                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <FileCode className="h-3 w-3" />
                                        Card: {job.card_id.slice(0, 8)}...
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          // Session detail view with messages
          <>
            {/* Session info header */}
            <div className="px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getSessionStateIcon(selectedJob.state)}
                  <Badge
                    variant={
                      selectedJob.state === 'succeeded'
                        ? 'default'
                        : selectedJob.state === 'failed'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {selectedJob.state}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(selectedJob.created_at)}
                </div>
              </div>
              {parseResult(selectedJob)?.summary && (
                <p className="text-sm text-muted-foreground mt-2">{parseResult(selectedJob)?.summary}</p>
              )}
              {selectedJob.last_error && (
                <p className="text-sm text-destructive mt-2">{selectedJob.last_error}</p>
              )}
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No chat messages in this session</p>
                    <p className="text-sm mt-1">This session may have run without user interaction</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}
                    >
                      <div
                        className={cn(
                          'shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : msg.role === 'agent'
                              ? 'bg-muted'
                              : 'bg-muted/50'
                        )}
                      >
                        {msg.role === 'user' ? (
                          <User className="h-4 w-4" />
                        ) : msg.role === 'agent' ? (
                          <Bot className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                      </div>
                      <div className={cn('flex-1 max-w-[80%]', msg.role === 'user' && 'text-right')}>
                        <div
                          className={cn(
                            'inline-block rounded-lg px-3 py-2 text-sm',
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : msg.role === 'agent'
                                ? 'bg-muted'
                                : 'bg-muted/50 text-muted-foreground italic'
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatRelativeTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
