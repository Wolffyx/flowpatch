/**
 * Priority utility functions for card ordering
 */

/**
 * Extract numeric priority from card labels.
 * Lower number = higher priority.
 *
 * Priority mapping:
 * - p0 / critical / urgent → 0 (highest)
 * - p1 / high              → 1
 * - p2 / medium            → 2
 * - p3 / low               → 3
 * - (no priority label)    → 999 (lowest)
 *
 * @param labelsJson - JSON string array of label names
 * @returns Numeric priority (0-3, or 999 for no priority)
 */
export function getPriorityFromLabels(labelsJson: string | null): number {
  if (!labelsJson) return 999

  try {
    const labels: string[] = JSON.parse(labelsJson)
    const lowerLabels = labels.map((l) => l.toLowerCase())

    // Check for p0/critical/urgent (highest priority)
    if (
      lowerLabels.some((l) => l.includes('p0') || l.includes('critical') || l.includes('urgent'))
    ) {
      return 0
    }

    // Check for p1/high
    if (lowerLabels.some((l) => l.includes('p1') || l.includes('high'))) {
      return 1
    }

    // Check for p2/medium
    if (lowerLabels.some((l) => l.includes('p2') || l.includes('medium'))) {
      return 2
    }

    // Check for p3/low
    if (lowerLabels.some((l) => l.includes('p3') || l.includes('low'))) {
      return 3
    }

    // No priority label found
    return 999
  } catch {
    // Invalid JSON or parsing error
    return 999
  }
}
