import { useState } from 'react'
import { Send, MessageSquare, AlertCircle, Lightbulb, Plus, Ban } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Textarea } from './ui/textarea'
import type { Card, Job, FollowUpInstructionType } from '../../../shared/types'

interface FollowUpInstructionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null
  card: Card | null
  onSubmit: (data: {
    jobId: string
    cardId: string
    instructionType: FollowUpInstructionType
    content: string
    priority?: number
  }) => Promise<void>
}

const instructionTypeOptions: {
  value: FollowUpInstructionType
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'revision',
    label: 'Request Revision',
    description: 'Ask the worker to modify or improve the current approach',
    icon: <MessageSquare className="h-4 w-4" />
  },
  {
    value: 'clarification',
    label: 'Provide Clarification',
    description: 'Clarify requirements or provide additional context',
    icon: <Lightbulb className="h-4 w-4" />
  },
  {
    value: 'additional',
    label: 'Add Task',
    description: 'Add an additional task or requirement to the current work',
    icon: <Plus className="h-4 w-4" />
  },
  {
    value: 'abort',
    label: 'Request Abort',
    description: 'Request the worker to stop and clean up the current task',
    icon: <Ban className="h-4 w-4" />
  }
]

export function FollowUpInstructionDialog({
  open,
  onOpenChange,
  job,
  card,
  onSubmit
}: FollowUpInstructionDialogProps): React.JSX.Element {
  const [instructionType, setInstructionType] = useState<FollowUpInstructionType>('revision')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    if (!job || !card || !content.trim()) return
    setIsSubmitting(true)
    try {
      await onSubmit({
        jobId: job.id,
        cardId: card.id,
        instructionType,
        content: content.trim(),
        priority: instructionType === 'abort' ? 100 : 0
      })
      setContent('')
      setInstructionType('revision')
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const selectedType = instructionTypeOptions.find((t) => t.value === instructionType)
  const title = card
    ? `Send Instruction - ${card.remote_number_or_iid ? `#${card.remote_number_or_iid}` : card.id.slice(0, 6)}`
    : 'Send Follow-up Instruction'

  const jobStateLabel =
    job?.state === 'running'
      ? 'running'
      : job?.state === 'pending_approval'
        ? 'waiting for approval'
        : job?.state || 'unknown'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[32rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Send an instruction to the worker. It will be processed at the next checkpoint.
          </DialogDescription>
        </DialogHeader>

        {job && card && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="capitalize">
                {jobStateLabel}
              </Badge>
              <span className="text-sm text-muted-foreground truncate">{card.title}</span>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Instruction Type</div>
              <div className="grid grid-cols-2 gap-2">
                {instructionTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setInstructionType(option.value)}
                    disabled={isSubmitting}
                    className={`flex items-center gap-2 p-2 rounded-md border text-left text-sm transition-colors ${
                      instructionType === option.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted/50'
                    } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              {selectedType && (
                <p className="text-xs text-muted-foreground">{selectedType.description}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Instruction</div>
              <Textarea
                id="instruction-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  instructionType === 'revision'
                    ? 'Describe what changes you want the worker to make...'
                    : instructionType === 'clarification'
                      ? 'Provide additional context or clarification...'
                      : instructionType === 'additional'
                        ? 'Describe the additional task or requirement...'
                        : 'Explain why the task should be aborted...'
                }
                className="h-32 resize-none"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Press Ctrl+Enter (Cmd+Enter on Mac) to submit
              </p>
            </div>

            {instructionType === 'abort' && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
                <div className="text-destructive">
                  <strong>Warning:</strong> Requesting abort will stop the worker and may leave the
                  task incomplete. Use this only when necessary.
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !job || !card || !content.trim()}
            variant={instructionType === 'abort' ? 'destructive' : 'default'}
          >
            <Send className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Sending...' : 'Send Instruction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
