/**
 * GitHub CLI Wrapper
 * Centralizes all GitHub CLI (gh) command execution
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface AuthResult {
  authenticated: boolean
  username?: string
  error?: string
}

/**
 * Wrapper for GitHub CLI (gh) command execution
 * Provides consistent command building and error handling
 */
export class GithubCLIWrapper {
  constructor(
    private owner: string,
    private repo: string,
    private repoPath: string
  ) {}

  /**
   * Get the repository identifier in owner/repo format
   */
  get repoIdentifier(): string {
    return `${this.owner}/${this.repo}`
  }

  /**
   * Build command arguments with repo flag prepended
   */
  buildRepoArgs(...args: string[]): string[] {
    return ['--repo', this.repoIdentifier, ...args]
  }

  /**
   * Execute a gh command
   */
  async exec(args: string[], options?: { cwd?: string }): Promise<string> {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: options?.cwd || this.repoPath
    })
    return stdout
  }

  /**
   * Execute gh issue command
   */
  async issue(args: string[]): Promise<string> {
    return this.exec(['issue', ...this.buildRepoArgs(...args)])
  }

  /**
   * Execute gh pr command
   */
  async pr(args: string[]): Promise<string> {
    return this.exec(['pr', ...this.buildRepoArgs(...args)])
  }

  /**
   * Execute gh label command
   */
  async label(args: string[]): Promise<string> {
    return this.exec(['label', ...this.buildRepoArgs(...args)])
  }

  /**
   * Execute gh api command
   */
  async api(args: string[]): Promise<string> {
    return this.exec(['api', ...args])
  }

  /**
   * Execute GraphQL query via gh api
   */
  async apiGraphql<T>(
    query: string,
    variables: Record<string, string | undefined | null>
  ): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`]
    
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined || value === null || value === '') continue
      // Use `-f` (string) instead of `-F` (type-coercing) so numeric-looking IDs
      // like singleSelectOptionId ("98236657") aren't sent as JSON numbers.
      args.push('-f', `${key}=${value}`)
    }

    const stdout = await this.exec(args)
    return JSON.parse(stdout) as T
  }

  /**
   * Check GitHub authentication status
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      const stdout = await this.exec(['auth', 'status', '--hostname', 'github.com'])
      const match = stdout.match(/Logged in to github.com account (\S+)/)
      return {
        authenticated: true,
        username: match ? match[1] : undefined
      }
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  }
}
