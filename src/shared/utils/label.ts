/**
 * Label normalization and matching utilities.
 */

import type { RepoLabel } from '../types'

/**
 * Normalize a label name for comparison.
 * Removes case sensitivity, whitespace, and special characters.
 */
export function normalizeLabelName(name: string): string {
  return (name || '').trim().toLowerCase()
}

/**
 * Normalize a label for fuzzy matching.
 * Removes dashes, underscores, spaces, and colons.
 */
export function normalizeLabelForMatching(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]+/g, '') // Remove dashes, underscores, spaces
    .replace(/:/g, '') // Remove colons
}

/**
 * Check if a label exists in a list (case-insensitive).
 */
export function labelExists(labelName: string, existingLabels: RepoLabel[]): boolean {
  const needle = normalizeLabelName(labelName)
  if (!needle) return false
  return existingLabels.some((l) => normalizeLabelName(l.name) === needle)
}

/**
 * Find a matching label in a list with fuzzy matching.
 * Handles variations like:
 * - "In Progress" vs "In progress" vs "in-progress"
 * - Case differences
 * - With or without "status::" prefix
 */
export function findMatchingLabel(targetLabel: string, repoLabels: string[]): string | null {
  const normalizedTarget = normalizeLabelForMatching(targetLabel)

  // First try exact match
  const exactMatch = repoLabels.find((l) => l === targetLabel)
  if (exactMatch) return exactMatch

  // Then try normalized match (full label)
  const normalizedMatch = repoLabels.find((l) => normalizeLabelForMatching(l) === normalizedTarget)
  if (normalizedMatch) return normalizedMatch

  // Try matching just the status part after "::" against all labels
  if (targetLabel.includes('::')) {
    const statusPart = targetLabel.split('::')[1]
    const normalizedStatus = normalizeLabelForMatching(statusPart)

    // First check labels that also have "::" prefix
    const prefixedMatch = repoLabels.find((l) => {
      if (l.includes('::')) {
        const labelStatus = l.split('::')[1]
        return normalizeLabelForMatching(labelStatus) === normalizedStatus
      }
      return false
    })
    if (prefixedMatch) return prefixedMatch

    // Then check labels WITHOUT "::" prefix
    const unprefixedMatch = repoLabels.find((l) => {
      if (!l.includes('::')) {
        return normalizeLabelForMatching(l) === normalizedStatus
      }
      return false
    })
    if (unprefixedMatch) return unprefixedMatch
  }

  return null
}

/**
 * Extract the status part from a label (after "::").
 */
export function extractStatusFromLabel(label: string): string {
  if (label.includes('::')) {
    return label.split('::')[1] || label
  }
  return label
}

/**
 * Create a prefixed status label.
 */
export function createStatusLabel(status: string, prefix: string = 'status::'): string {
  return `${prefix}${status}`
}
