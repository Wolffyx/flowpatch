import { useState } from 'react'
import { Check, X, FastForward, FileText } from 'lucide-react'
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
import { ScrollArea } from './ui/scroll-area'
import type { Card, PlanApproval } from '../../../shared/types'

interface PlanApprovalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  approval: PlanApproval | null
  card: Card | null
  onApprove: (approvalId: string, notes?: string) => Promise<void>
  onReject: (approvalId: string, notes?: string) => Promise<void>
  onSkip: (approvalId: string) => Promise<void>
}

function getPlanningModeLabel(mode: string): string {
  switch (mode) {
    case 'lite':
      return 'Lite'
    case 'spec':
      return 'Specification'
    case 'full':
      return 'Full'
    case 'skip':
      return 'Skip'
    default:
      return mode
  }
}

export function PlanApprovalDialog({
  open,
  onOpenChange,
  approval,
  card,
  onApprove,
  onReject,
  onSkip
}: PlanApprovalDialogProps): React.JSX.Element {
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [action, setAction] = useState<'approve' | 'reject' | 'skip' | null>(null)

  const handleApprove = async (): Promise<void> => {
    if (!approval) return
    setIsSubmitting(true)
    setAction('approve')
    try {
      await onApprove(approval.id, notes.trim() || undefined)
      setNotes('')
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
      setAction(null)
    }
  }

  const handleReject = async (): Promise<void> => {
    if (!approval) return
    setIsSubmitting(true)
    setAction('reject')
    try {
      await onReject(approval.id, notes.trim() || undefined)
      setNotes('')
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
      setAction(null)
    }
  }

  const handleSkip = async (): Promise<void> => {
    if (!approval) return
    setIsSubmitting(true)
    setAction('skip')
    try {
      await onSkip(approval.id)
      setNotes('')
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
      setAction(null)
    }
  }

  const title = card
    ? `Plan Approval - ${card.remote_number_or_iid ? `#${card.remote_number_or_iid}` : card.id.slice(0, 6)}`
    : 'Plan Approval'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[80rem] sm:max-w-[80rem] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Review the implementation plan before proceeding with AI execution.
          </DialogDescription>
        </DialogHeader>

        {approval && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">
                {getPlanningModeLabel(approval.planning_mode)} Plan
              </Badge>
              {card && (
                <span className="text-sm text-muted-foreground truncate">
                  {card.title}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Implementation Plan</div>
              <ScrollArea className="h-[40vh] rounded-md border bg-muted/20 p-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-xs font-mono">
                    {approval.plan}
                  </pre>
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">
                Reviewer Notes (Optional)
              </div>
              <Textarea
                id="reviewer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes or feedback about the plan..."
                className="h-20 resize-none"
                disabled={isSubmitting}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={handleSkip}
              disabled={isSubmitting || !approval}
              className="flex-1 sm:flex-none"
            >
              <FastForward className="h-4 w-4 mr-2" />
              {action === 'skip' ? 'Skipping...' : 'Skip Review'}
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isSubmitting || !approval}
              className="flex-1 sm:flex-none"
            >
              <X className="h-4 w-4 mr-2" />
              {action === 'reject' ? 'Rejecting...' : 'Reject'}
            </Button>
            <Button
              variant="default"
              onClick={handleApprove}
              disabled={isSubmitting || !approval}
              className="flex-1 sm:flex-none"
            >
              <Check className="h-4 w-4 mr-2" />
              {action === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
