/**
 * Global Agent Chat Dialog
 *
 * A dialog for viewing and interacting with agent chats from the shell level.
 * Shows all recent jobs with chat capability and allows selecting one to chat with.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
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
  MessageSquare,
  Send,
  Bot,
  User,
  AlertCircle,
  Loader2,
  ChevronLeft
} from 'lucide-react'
import type { Job } from '@shared/types'
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

interface GlobalAgentChatDialogProps {
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

export function GlobalAgentChatDialog({
  open,
  onOpenChange,
  jobs,
  projectNameById
}: GlobalAgentChatDialogProps): React.JSX.Element {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [messages, setMessages] = useState<AgentChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Filter jobs that are worker_run type (the ones that can have chats)
  const workerJobs = jobs.filter((j) => j.type === 'worker_run')

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
    // Mark as read when viewing
    window.shellAPI.markChatAsRead(selectedJob.id).catch(console.error)
  }, [selectedJob?.id])

  // Subscribe to new messages
  useEffect(() => {
    if (!selectedJob) return

    const unsubscribe = window.shellAPI.onChatMessage((data) => {
      if (data.jobId === selectedJob.id && data.type === 'new') {
        setMessages((prev) => [...prev, data.message])
      }
    })

    return unsubscribe
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
      setInputValue('')
    }
  }, [open])

  const handleSend = useCallback(async (): Promise<void> => {
    if (!inputValue.trim() || !selectedJob || sending) return

    const content = inputValue.trim()
    setInputValue('')
    setSending(true)

    try {
      await window.shellAPI.sendChatMessage({
        jobId: selectedJob.id,
        cardId: selectedJob.card_id || '',
        projectId: selectedJob.project_id,
        content
      })
    } catch (err) {
      console.error('Failed to send message:', err)
      // Restore input on error
      setInputValue(content)
    } finally {
      setSending(false)
    }
  }, [inputValue, selectedJob, sending])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const getJobStatusBadge = (job: Job): React.JSX.Element => {
    const variant =
      job.state === 'failed'
        ? 'destructive'
        : job.state === 'running'
          ? 'default'
          : job.state === 'succeeded'
            ? 'outline'
            : 'secondary'
    return <Badge variant={variant}>{job.state}</Badge>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0 gap-0">
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
            <MessageSquare className="h-5 w-5" />
            <DialogTitle>
              {selectedJob ? `Chat • ${projectNameById[selectedJob.project_id] || 'Unknown Project'}` : 'Agent Chats'}
            </DialogTitle>
          </div>
        </DialogHeader>

        {!selectedJob ? (
          // Job list view
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {workerJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No agent jobs yet</p>
                  <p className="text-sm mt-1">Run a worker on a card to start chatting</p>
                </div>
              ) : (
                workerJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    className="w-full p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm truncate">
                        {projectNameById[job.project_id] || 'Unknown Project'}
                      </span>
                      {getJobStatusBadge(job)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatRelativeTime(job.created_at)}</span>
                      {job.card_id && <span>• Card: {job.card_id.slice(0, 8)}...</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        ) : (
          // Chat view
          <>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No messages yet</p>
                    <p className="text-sm mt-1">Send a message to interact with the agent</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-3',
                        msg.role === 'user' && 'flex-row-reverse'
                      )}
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
                      <div
                        className={cn(
                          'flex-1 max-w-[80%]',
                          msg.role === 'user' && 'text-right'
                        )}
                      >
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

            {/* Input area */}
            <div className="shrink-0 border-t p-4">
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  disabled={sending || selectedJob.state === 'succeeded' || selectedJob.state === 'failed'}
                  className="flex-1"
                />
                <Button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || sending || selectedJob.state === 'succeeded' || selectedJob.state === 'failed'}
                  size="icon"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {(selectedJob.state === 'succeeded' || selectedJob.state === 'failed') && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  This job has {selectedJob.state}. Chat is read-only.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
