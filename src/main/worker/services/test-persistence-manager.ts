/**
 * Test Persistence Manager
 *
 * Manages the lifecycle of E2E test files based on persistence mode.
 * - persistent: Tests are kept and committed with the PR
 * - temporary: Tests are cleaned up after card completion
 */

import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'

import type { TestPersistence } from '../../../shared/types/interfaces/e2e-test'

type LogFn = (message: string, meta?: { source: string; stream: 'stdout' | 'stderr' }) => void

export interface TestPersistenceConfig {
  mode: TestPersistence
  testDirectory: string
  tempDirectory: string
  cardId: string
  jobId: string
  cwd: string
}

export class TestPersistenceManager {
  private config: TestPersistenceConfig
  private createdFiles: Set<string> = new Set()
  private createdDirectories: Set<string> = new Set()
  private log: LogFn
  private effectiveTestDirectory: string

  constructor(config: TestPersistenceConfig, log: LogFn) {
    this.config = config
    this.log = log

    // Determine effective test directory based on persistence mode
    if (config.mode === 'temporary') {
      // Use temp directory with job-specific subfolder
      this.effectiveTestDirectory = join(
        config.cwd,
        config.tempDirectory,
        `e2e-${config.jobId || config.cardId}`
      )
    } else {
      // Use configured test directory
      this.effectiveTestDirectory = join(config.cwd, config.testDirectory)
    }
  }

  /**
   * Get the directory where tests should be created.
   */
  getTestDirectory(): string {
    return this.effectiveTestDirectory
  }

  /**
   * Get the relative test directory from the project root.
   */
  getRelativeTestDirectory(): string {
    return relative(this.config.cwd, this.effectiveTestDirectory)
  }

  /**
   * Ensure the test directory exists.
   */
  ensureTestDirectory(): void {
    if (!existsSync(this.effectiveTestDirectory)) {
      this.log(`Creating test directory: ${this.getRelativeTestDirectory()}`)
      mkdirSync(this.effectiveTestDirectory, { recursive: true })

      if (this.config.mode === 'temporary') {
        // Track created directories for cleanup
        this.trackCreatedDirectory(this.effectiveTestDirectory)
      }
    }
  }

  /**
   * Track a created test file for potential cleanup.
   */
  trackCreatedFile(filePath: string): void {
    const absolutePath = join(this.config.cwd, filePath)
    this.createdFiles.add(absolutePath)
    this.log(`Tracking test file: ${filePath}`)
  }

  /**
   * Track a created directory for potential cleanup.
   */
  private trackCreatedDirectory(dirPath: string): void {
    this.createdDirectories.add(dirPath)
  }

  /**
   * Get list of created test files.
   */
  getCreatedFiles(): string[] {
    return Array.from(this.createdFiles)
  }

  /**
   * Cleanup temporary tests after completion.
   * Only runs when mode is 'temporary'.
   */
  async cleanup(success: boolean): Promise<void> {
    if (this.config.mode !== 'temporary') {
      this.log('Persistent mode: keeping test files')
      return
    }

    this.log(`Cleaning up temporary tests (success: ${success})...`)

    // Clean up tracked files
    for (const filePath of this.createdFiles) {
      try {
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true })
          this.log(`Removed: ${relative(this.config.cwd, filePath)}`)
        }
      } catch (error) {
        this.log(`Warning: Failed to remove ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Clean up the test directory if it's empty and was created by us
    await this.cleanupEmptyDirectories()

    // Clean up parent temp directory if empty
    await this.cleanupTempDirectory()

    this.createdFiles.clear()
    this.createdDirectories.clear()
  }

  /**
   * Clean up empty directories that were created for tests.
   */
  private async cleanupEmptyDirectories(): Promise<void> {
    // Sort directories by depth (deepest first)
    const sortedDirs = Array.from(this.createdDirectories).sort(
      (a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length
    )

    for (const dirPath of sortedDirs) {
      try {
        if (existsSync(dirPath) && this.isDirectoryEmpty(dirPath)) {
          rmSync(dirPath, { recursive: true, force: true })
          this.log(`Removed empty directory: ${relative(this.config.cwd, dirPath)}`)
        }
      } catch (error) {
        this.log(`Warning: Failed to remove directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * Clean up the temp directory parent if it's empty.
   */
  private async cleanupTempDirectory(): Promise<void> {
    const tempParent = join(this.config.cwd, this.config.tempDirectory)

    try {
      if (existsSync(tempParent) && this.isDirectoryEmpty(tempParent)) {
        rmSync(tempParent, { recursive: true, force: true })
        this.log(`Removed empty temp directory: ${this.config.tempDirectory}`)
      }
    } catch {
      // Ignore errors when cleaning up parent temp directory
    }
  }

  /**
   * Check if a directory is empty.
   */
  private isDirectoryEmpty(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath)
      return entries.length === 0
    } catch {
      return false
    }
  }

  /**
   * Scan the test directory for existing test files.
   */
  scanExistingTests(): string[] {
    if (!existsSync(this.effectiveTestDirectory)) {
      return []
    }

    const testFiles: string[] = []
    this.scanDirectory(this.effectiveTestDirectory, testFiles)
    return testFiles.map((f) => relative(this.config.cwd, f))
  }

  /**
   * Recursively scan a directory for test files.
   */
  private scanDirectory(dirPath: string, testFiles: string[]): void {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)

        if (entry.isDirectory()) {
          this.scanDirectory(fullPath, testFiles)
        } else if (entry.isFile() && this.isTestFile(entry.name)) {
          testFiles.push(fullPath)
        }
      }
    } catch {
      // Ignore errors reading directories
    }
  }

  /**
   * Check if a file is a test file based on naming convention.
   */
  private isTestFile(filename: string): boolean {
    return (
      filename.endsWith('.spec.ts') ||
      filename.endsWith('.spec.js') ||
      filename.endsWith('.test.ts') ||
      filename.endsWith('.test.js') ||
      filename.endsWith('.e2e.ts') ||
      filename.endsWith('.e2e.js')
    )
  }

  /**
   * Get suggested test file name based on card title.
   */
  getSuggestedTestFileName(cardTitle: string): string {
    // Convert title to kebab-case
    const kebabCase = cardTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)

    return `${kebabCase}.spec.ts`
  }
}
