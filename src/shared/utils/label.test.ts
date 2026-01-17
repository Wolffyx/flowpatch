/**
 * Unit tests for label utilities.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeLabelName,
  normalizeLabelForMatching,
  labelExists,
  findMatchingLabel,
  extractStatusFromLabel,
  createStatusLabel
} from './label'

describe('normalizeLabelName', () => {
  it('should convert to lowercase', () => {
    expect(normalizeLabelName('IN PROGRESS')).toBe('in progress')
    expect(normalizeLabelName('Ready')).toBe('ready')
  })

  it('should trim whitespace', () => {
    expect(normalizeLabelName('  ready  ')).toBe('ready')
    expect(normalizeLabelName('\tready\n')).toBe('ready')
  })

  it('should handle empty strings', () => {
    expect(normalizeLabelName('')).toBe('')
  })

  it('should handle null/undefined gracefully', () => {
    expect(normalizeLabelName(null as unknown as string)).toBe('')
    expect(normalizeLabelName(undefined as unknown as string)).toBe('')
  })
})

describe('normalizeLabelForMatching', () => {
  it('should remove dashes', () => {
    expect(normalizeLabelForMatching('in-progress')).toBe('inprogress')
  })

  it('should remove underscores', () => {
    expect(normalizeLabelForMatching('in_progress')).toBe('inprogress')
  })

  it('should remove spaces', () => {
    expect(normalizeLabelForMatching('in progress')).toBe('inprogress')
  })

  it('should remove colons', () => {
    expect(normalizeLabelForMatching('status::ready')).toBe('statusready')
  })

  it('should convert to lowercase', () => {
    expect(normalizeLabelForMatching('IN-PROGRESS')).toBe('inprogress')
  })

  it('should handle multiple special characters', () => {
    expect(normalizeLabelForMatching('status::in-progress')).toBe('statusinprogress')
    expect(normalizeLabelForMatching('status::in_review')).toBe('statusinreview')
  })
})

describe('labelExists', () => {
  const repoLabels = [
    { name: 'bug', color: 'ff0000' },
    { name: 'Feature', color: '00ff00' },
    { name: 'In Progress', color: '0000ff' }
  ]

  it('should find exact matches', () => {
    expect(labelExists('bug', repoLabels)).toBe(true)
    expect(labelExists('Feature', repoLabels)).toBe(true)
  })

  it('should be case-insensitive', () => {
    expect(labelExists('BUG', repoLabels)).toBe(true)
    expect(labelExists('feature', repoLabels)).toBe(true)
    expect(labelExists('in progress', repoLabels)).toBe(true)
  })

  it('should return false for non-existent labels', () => {
    expect(labelExists('enhancement', repoLabels)).toBe(false)
    expect(labelExists('wontfix', repoLabels)).toBe(false)
  })

  it('should return false for empty label name', () => {
    expect(labelExists('', repoLabels)).toBe(false)
    expect(labelExists('   ', repoLabels)).toBe(false)
  })

  it('should handle empty label list', () => {
    expect(labelExists('bug', [])).toBe(false)
  })
})

describe('findMatchingLabel', () => {
  const repoLabels = [
    'bug',
    'Feature',
    'In Progress',
    'status::ready',
    'status::In Review'
  ]

  it('should find exact matches first', () => {
    expect(findMatchingLabel('bug', repoLabels)).toBe('bug')
    expect(findMatchingLabel('Feature', repoLabels)).toBe('Feature')
  })

  it('should find case-insensitive matches', () => {
    expect(findMatchingLabel('BUG', repoLabels)).toBe('bug')
    expect(findMatchingLabel('feature', repoLabels)).toBe('Feature')
  })

  it('should find matches ignoring dashes and spaces', () => {
    expect(findMatchingLabel('in-progress', repoLabels)).toBe('In Progress')
    expect(findMatchingLabel('in_progress', repoLabels)).toBe('In Progress')
    expect(findMatchingLabel('inprogress', repoLabels)).toBe('In Progress')
  })

  it('should match prefixed labels against unprefixed targets', () => {
    // When looking for "status::ready", should match "status::ready"
    expect(findMatchingLabel('status::ready', repoLabels)).toBe('status::ready')
    expect(findMatchingLabel('status::in-review', repoLabels)).toBe('status::In Review')
  })

  it('should match status part after :: against labels with ::', () => {
    // Looking for a prefixed label, matching the status part
    expect(findMatchingLabel('status::Ready', repoLabels)).toBe('status::ready')
  })

  it('should return null when no match found', () => {
    expect(findMatchingLabel('enhancement', repoLabels)).toBe(null)
    expect(findMatchingLabel('status::done', repoLabels)).toBe(null)
  })

  it('should handle empty label list', () => {
    expect(findMatchingLabel('bug', [])).toBe(null)
  })
})

describe('extractStatusFromLabel', () => {
  it('should extract status after ::', () => {
    expect(extractStatusFromLabel('status::ready')).toBe('ready')
    expect(extractStatusFromLabel('status::in_progress')).toBe('in_progress')
  })

  it('should return the full label if no :: present', () => {
    expect(extractStatusFromLabel('ready')).toBe('ready')
    expect(extractStatusFromLabel('bug')).toBe('bug')
  })

  it('should handle multiple :: delimiters (splits on first only)', () => {
    // The function uses split('::')[1], which only gets the second part
    expect(extractStatusFromLabel('prefix::status::value')).toBe('status')
  })

  it('should return the full label if nothing after ::', () => {
    expect(extractStatusFromLabel('status::')).toBe('status::')
  })
})

describe('createStatusLabel', () => {
  it('should create a prefixed label with default prefix', () => {
    expect(createStatusLabel('ready')).toBe('status::ready')
    expect(createStatusLabel('in_progress')).toBe('status::in_progress')
  })

  it('should use custom prefix when provided', () => {
    expect(createStatusLabel('ready', 'state::')).toBe('state::ready')
    expect(createStatusLabel('bug', 'type:')).toBe('type:bug')
  })

  it('should work with empty prefix', () => {
    expect(createStatusLabel('ready', '')).toBe('ready')
  })
})
