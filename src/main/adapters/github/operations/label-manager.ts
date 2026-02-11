/**
 * GitHub Label Manager
 * Handles all label-related operations
 */

import type { RepoLabel } from '@shared/types'
import { logAction } from '../../../utils/main-logger'
import type { GithubCLIWrapper } from '../helpers/cli-wrapper'

export interface LabelResult {
  created: boolean
  error?: string
}

/**
 * Manages GitHub labels for issues and PRs
 */
export class GithubLabelManager {
  constructor(private cli: GithubCLIWrapper) {}

  /**
   * List all labels in the repository
   */
  async listRepoLabels(): Promise<RepoLabel[]> {
    try {
      const stdout = await this.cli.label([
        'list',
        '--limit',
        '1000',
        '--json',
        'name,color,description'
      ])
      const labels = JSON.parse(stdout) as Array<{
        name: string
        color?: string
        description?: string
      }>
      return labels.map((l) => ({ name: l.name, color: l.color, description: l.description }))
    } catch (error) {
      logAction('github:listRepoLabels:error', { error: String(error) })
      return []
    }
  }

  /**
   * Create a new label in the repository
   */
  async createRepoLabel(label: RepoLabel): Promise<LabelResult> {
    const name = (label.name || '').trim()
    if (!name) return { created: false, error: 'Label name is required' }

    const args = ['create', name]
    if (label.color) args.push('--color', label.color.replace(/^#/, ''))
    if (label.description) args.push('--description', label.description)

    try {
      await this.cli.label(args)
      return { created: true }
    } catch (error) {
      return { created: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Update labels on an issue
   */
  async updateIssueLabels(
    issueNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    return this.updateItemLabels('issue', issueNumber, labelsToAdd, labelsToRemove)
  }

  /**
   * Update labels on a PR
   */
  async updatePRLabels(
    prNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    return this.updateItemLabels('pr', prNumber, labelsToAdd, labelsToRemove)
  }

  /**
   * Update labels on an issue or PR (shared logic)
   */
  private async updateItemLabels(
    itemType: 'issue' | 'pr',
    itemNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Fetch existing labels from the repository to match against
      const repoLabels = await this.fetchRepoLabelsInternal()
      logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: fetched repo labels`, {
        repoLabels,
        labelsToAdd,
        labelsToRemove
      })

      const failedAdds: string[] = []
      for (const label of labelsToAdd) {
        // Find matching label in repo (handles case, spaces, dashes, prefixes)
        let matchedLabel = this.findMatchingLabel(label, repoLabels)
        logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: matching result`, {
          original: label,
          matched: matchedLabel
        })

        if (!matchedLabel) {
          // Try adding the label by name directly first
          try {
            await this.cli.exec([
              itemType,
              'edit',
              String(itemNumber),
              '--repo',
              this.cli.repoIdentifier,
              '--add-label',
              label
            ])
            continue
          } catch (error) {
            logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: Direct add failed, attempting to create label`, {
              label,
              error: String(error)
            })
          }

          const created = await this.createRepoLabel({ name: label })
          if (!created.created) {
            failedAdds.push(label)
            logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: Failed to create missing label`, {
              label,
              error: created.error
            })
            continue
          }

          repoLabels.push(label)
          matchedLabel = label
        }

        try {
          await this.cli.exec([
            itemType,
            'edit',
            String(itemNumber),
            '--repo',
            this.cli.repoIdentifier,
            '--add-label',
            matchedLabel
          ])
        } catch (error) {
          failedAdds.push(label)
          logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: Failed to add label`, {
            label,
            matchedLabel,
            error: String(error)
          })
        }
      }

      for (const label of labelsToRemove) {
        const matchedLabel = this.findMatchingLabel(label, repoLabels)
        if (matchedLabel) {
          try {
            await this.cli.exec([
              itemType,
              'edit',
              String(itemNumber),
              '--repo',
              this.cli.repoIdentifier,
              '--remove-label',
              matchedLabel
            ])
          } catch {
            // Ignore errors when removing labels (label might not be on item)
          }
        }
      }

      if (failedAdds.length > 0) {
        logAction(`update${itemType === 'issue' ? 'Labels' : 'PRLabels'}: One or more labels failed to add`, {
          failedAdds
        })
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to update labels:', error)
      return false
    }
  }

  /**
   * Fetch all labels from the GitHub repository (internal helper)
   */
  private async fetchRepoLabelsInternal(): Promise<string[]> {
    try {
      const stdout = await this.cli.label(['list', '--json', 'name'])
      const labels = JSON.parse(stdout) as { name: string }[]
      return labels.map((l) => l.name)
    } catch (error) {
      logAction('fetchRepoLabels: Failed to fetch labels', { error: String(error) })
      return []
    }
  }

  /**
   * Find a matching label in the repository's label list
   * Handles variations like:
   * - "status::in-progress" vs "In progress" vs "in-progress"
   * - Case differences
   * - With or without "status::" prefix
   */
  private findMatchingLabel(targetLabel: string, repoLabels: string[]): string | null {
    // Normalize function: lowercase, remove dashes/spaces/colons
    const normalize = (s: string): string => {
      return s
        .toLowerCase()
        .replace(/[-_\s]+/g, '') // Remove dashes, underscores, spaces
        .replace(/:/g, '') // Remove colons too for matching
    }

    const normalizedTarget = normalize(targetLabel)

    // First try exact match
    const exactMatch = repoLabels.find((l) => l === targetLabel)
    if (exactMatch) return exactMatch

    // Then try normalized match (full label)
    const normalizedMatch = repoLabels.find((l) => normalize(l) === normalizedTarget)
    if (normalizedMatch) return normalizedMatch

    // Try matching just the status part after "::"
    if (targetLabel.includes('::')) {
      const statusPart = targetLabel.split('::')[1]
      const normalizedStatus = normalize(statusPart)

      // First check labels that also have "::" prefix
      const prefixedMatch = repoLabels.find((l) => {
        if (l.includes('::')) {
          const labelStatus = l.split('::')[1]
          return normalize(labelStatus) === normalizedStatus
        }
        return false
      })
      if (prefixedMatch) return prefixedMatch

      // Then check labels WITHOUT "::" prefix
      const unprefixedMatch = repoLabels.find((l) => {
        if (!l.includes('::')) {
          return normalize(l) === normalizedStatus
        }
        return false
      })
      if (unprefixedMatch) return unprefixedMatch
    }

    return null
  }
}
