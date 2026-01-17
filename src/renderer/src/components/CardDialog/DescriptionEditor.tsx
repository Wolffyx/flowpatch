import { useState } from 'react'
import { Pencil, Eye, Edit3, Save } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

interface DescriptionEditorProps {
  description: string | null
  isEditing: boolean
  isSaving: boolean
  onStartEdit: () => void
  onSave: (newDescription: string) => void
  onCancel: () => void
}

export function DescriptionEditor({
  description,
  isEditing,
  isSaving,
  onStartEdit,
  onSave,
  onCancel
}: DescriptionEditorProps): React.JSX.Element {
  const [editedDescription, setEditedDescription] = useState(description || '')
  const [showPreview, setShowPreview] = useState(false)

  const handleSave = () => {
    onSave(editedDescription)
  }

  const handleCancel = () => {
    setEditedDescription(description || '')
    setShowPreview(false)
    onCancel()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Description</h3>
        {!isEditing ? (
          <Button variant="ghost" size="sm" onClick={onStartEdit} className="h-7 px-2">
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className="h-7 px-2"
          >
            {showPreview ? (
              <>
                <Edit3 className="h-3 w-3 mr-1" />
                Edit
              </>
            ) : (
              <>
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </>
            )}
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          {showPreview ? (
            <div className="min-h-[200px] rounded-md bg-muted p-4 prose prose-sm dark:prose-invert max-w-none overflow-hidden [&_*]:!max-w-full [&_*]:!table-auto [&_p]:break-words [&_p]:overflow-wrap-anywhere [&_a]:break-all [&_code]:break-all [&_pre]:!overflow-x-auto [&_pre]:!whitespace-pre-wrap [&_pre>code]:!whitespace-pre-wrap [&_table]:!block [&_table]:!overflow-x-auto">
              {editedDescription ? (
                <ReactMarkdown>{editedDescription}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground italic">No preview available</p>
              )}
            </div>
          ) : (
            <Textarea
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              className="min-h-[200px] resize-y font-mono text-sm"
              placeholder="Add a description (Markdown supported)..."
              autoFocus
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="h-3 w-3 mr-1" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : description ? (
        <div className="rounded-md bg-muted p-4 prose prose-sm dark:prose-invert max-w-none overflow-hidden [&_*]:!max-w-full [&_*]:!table-auto [&_p]:break-words [&_p]:overflow-wrap-anywhere [&_a]:break-all [&_code]:break-all [&_pre]:!overflow-x-auto [&_pre]:!whitespace-pre-wrap [&_pre>code]:!whitespace-pre-wrap [&_table]:!block [&_table]:!overflow-x-auto">
          <ReactMarkdown>{description}</ReactMarkdown>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic rounded-md bg-muted p-4">
          No description provided. Click Edit to add one.
        </div>
      )}
    </div>
  )
}
