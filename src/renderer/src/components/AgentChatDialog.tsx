/**
 * Agent Chat Dialog
 *
 * A dialog wrapper for the AgentChatPanel component.
 * Can be opened from the CardDrawer to interact with a running agent.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { AgentChatPanel } from './AgentChatPanel'
import { MessageSquare } from 'lucide-react'

interface AgentChatDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  cardId: string
  cardTitle?: string
}

export function AgentChatDialog({
  open,
  onOpenChange,
  jobId,
  cardId,
  cardTitle
}: AgentChatDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <DialogTitle>
              {cardTitle ? `Chat • ${cardTitle}` : 'Agent Chat'}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <AgentChatPanel
            jobId={jobId}
            cardId={cardId}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
