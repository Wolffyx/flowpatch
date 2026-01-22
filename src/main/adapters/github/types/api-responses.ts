/**
 * GitHub API Response Types
 * Type definitions for responses from GitHub CLI (gh) commands
 */

export interface GithubIssue {
  number: number
  title: string
  body: string | null
  state: string
  url: string
  html_url?: string
  labels: { name: string }[]
  assignees: { login: string }[]
  updatedAt: string
  updated_at?: string
  node_id: string
}

export interface GithubPR {
  number: number
  title: string
  body: string | null
  state: string
  url: string
  html_url?: string
  labels: { name: string }[]
  assignees: { login: string }[]
  updatedAt: string
  updated_at?: string
  node_id: string
  isDraft: boolean
  draft?: boolean
}

export interface GithubPullRequestIssueLink {
  prNumber: number
  prUrl: string
  issueNumbers: number[]
}
