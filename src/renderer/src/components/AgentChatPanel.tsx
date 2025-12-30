/**
 * Agent Chat Panel Component
 *
 * An interactive chat interface for communicating with running agents.
 * Displays message history and allows sending new messages.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Bot, User, Info, Trash2, MessageSquare } from 'lucide-react'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

// ============================================================================
// Types
// ============================================================================

type AgentChatRole = 'user' | 'agent' | 'system'
type AgentChatMessageStatus = 'sent' | 'delivered' | 'read' | 'error'

interface AgentChatMessage {
  id: string
  job_id: string
  card_id: string
  project_id: string
  role: AgentChatRole
  content: string
  status: AgentChatMessageStatus
  metadata_json?: string
  created_at: string
  updated_at?: string
}

interface AgentChatPanelProps {
  jobId: string
  cardId: string
  className?: string
  onUnreadCountChange?: (count: number) => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function groupMessagesByDate(messages: AgentChatMessage[]): Map<string, AgentChatMessage[]> {
  const groups = new Map<string, AgentChatMessage[]>()

  for (const message of messages) {
    const dateKey = new Date(message.created_at).toDateString()
    const existing = groups.get(dateKey) ?? []
    existing.push(message)
    groups.set(dateKey, existing)
  }

  return groups
}

function getRoleIcon(role: AgentChatRole): React.ReactNode {
  switch (role) {
    case 'user':
      return <User className="h-4 w-4" />
    case 'agent':
      return <Bot className="h-4 w-4" />
    case 'system':
      return <Info className="h-4 w-4" />
  }
}

function getRoleLabel(role: AgentChatRole): string {
  switch (role) {
    case 'user':
      return 'You'
    case 'agent':
      return 'Agent'
    case 'system':
      return 'System'
  }
}

// ============================================================================
// Message Component
// ============================================================================

function ChatMessage({ message }: { message: AgentChatMessage }): React.JSX.Element {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg',
        isUser && 'bg-primary/10 ml-8',
        !isUser && !isSystem && 'bg-muted mr-8',
        isSystem && 'bg-blue-500/10 mx-4'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser && 'bg-primary text-primary-foreground',
          !isUser && !isSystem && 'bg-muted-foreground/20',
          isSystem && 'bg-blue-500/20 text-blue-500'
        )}
      >
        {getRoleIcon(message.role)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{getRoleLabel(message.role)}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.created_at)}</span>
          {message.status === 'error' && (
            <Badge variant="destructive" className="text-xs">
              Failed
            </Badge>
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function AgentChatPanel({
  jobId,
  cardId,
  className,
  onUnreadCountChange
}: AgentChatPanelProps): React.JSX.Element {
  const [messages, setMessages] = useState<AgentChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const result = await window.projectAPI.getChatMessages(jobId)
      if (!result.error) {
        setMessages(result.messages)
      }
    } catch (err) {
      console.error('Failed to load chat messages:', err)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  // Initial load
  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Subscribe to new messages
  useEffect(() => {
    const unsubscribe = window.projectAPI.onChatMessage((data) => {
      if (data.jobId === jobId && data.type === 'new') {
        setMessages((prev) => [...prev, data.message])
      }
    })

    return unsubscribe
  }, [jobId])

  // Mark messages as read when panel is visible
  useEffect(() => {
    const markAsRead = async (): Promise<void> => {
      try {
        await window.projectAPI.markChatAsRead(jobId)
        onUnreadCountChange?.(0)
      } catch (err) {
        console.error('Failed to mark messages as read:', err)
      }
    }

    if (messages.length > 0) {
      markAsRead()
    }
  }, [jobId, messages.length, onUnreadCountChange])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Send message handler
  const handleSend = async (): Promise<void> => {
    const content = inputValue.trim()
    if (!content || sending) return

    setSending(true)
    setInputValue('')

    try {
      const result = await window.projectAPI.sendChatMessage({
        jobId,
        cardId,
        content
      })

      if (result.error) {
        console.error('Failed to send message:', result.error)
        // Restore input on error
        setInputValue(content)
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setInputValue(content)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Clear chat history
  const handleClear = async (): Promise<void> => {
    if (!confirm('Clear all chat messages for this job?')) return

    try {
      await window.projectAPI.clearChatHistory(jobId)
      setMessages([])
    } catch (err) {
      console.error('Failed to clear chat:', err)
    }
  }

  // Group messages by date
  const messageGroups = groupMessagesByDate(messages)

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="font-medium text-sm">Agent Chat</span>
          {messages.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {messages.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={messages.length === 0}
          title="Clear chat history"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Send a message to interact with the agent</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(messageGroups.entries()).map(([dateKey, dateMessages]) => (
              <div key={dateKey}>
                <div className="flex items-center justify-center my-4">
                  <div className="border-t flex-1" />
                  <span className="px-3 text-xs text-muted-foreground">
                    {formatDate(dateMessages[0].created_at)}
                  </span>
                  <div className="border-t flex-1" />
                </div>
                <div className="space-y-3">
                  {dateMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to the agent..."
            className={cn(
              'flex-1 min-h-[40px] max-h-[120px] px-3 py-2 text-sm',
              'rounded-md border bg-background resize-none',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            )}
            rows={1}
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={!inputValue.trim() || sending} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
