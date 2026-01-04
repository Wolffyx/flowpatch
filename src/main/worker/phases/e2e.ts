/**
 * E2E Phase
 *
 * Handles Playwright E2E test creation and execution with retry loop.
 */

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { runProcessStreaming, WorkerCanceledError } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { runClaudeCode, runCodex, isClaudeRetryableLimitError } from './ai'
import { getAvailableAITools } from '../cache'

/**
 * E2E phase result structure.
 */
export interface E2EResult {
  success: boolean
  testsCreated: boolean
  testsRun: boolean
  fixAttempts: number
  lastError?: string
}

/**
 * Check if Playwright is installed in the project.
 */
export async function checkPlaywrightInstalled(cwd: string): Promise<boolean> {
  try {
    const packageJsonPath = join(cwd, 'package.json')
    if (!existsSync(packageJsonPath)) return false

    const packageJson = require(packageJsonPath)
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    }

    return '@playwright/test' in deps || 'playwright' in deps
  } catch {
    return false
  }
}

/**
 * Detect existing E2E test files in configured directories.
 */
export function detectExistingE2ETests(cwd: string, testDirs: string[]): string[] {
  const testFiles: string[] = []

  for (const dir of testDirs) {
    const fullPath = join(cwd, dir)
    if (!existsSync(fullPath)) continue

    try {
      const files = readdirSync(fullPath, { recursive: true, withFileTypes: true })
      for (const file of files) {
        if (file.isFile() && (file.name.endsWith('.spec.ts') || file.name.endsWith('.test.ts') || file.name.endsWith('.e2e.ts'))) {
          testFiles.push(join(dir, file.name))
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  return testFiles
}

/**
 * Build prompt for AI to create E2E tests.
 */
export function buildE2ECreationPrompt(
  ctx: PipelineContext,
  changedFiles: string[],
  testDirectory: string
): string {
  return `# Task: Create Playwright E2E Tests for Electron Application

## Context
You are testing an Electron application. The following files were modified:
${changedFiles.map((f) => `- ${f}`).join('\n')}

## Issue Being Implemented
Title: ${ctx.card!.title}
Description: ${ctx.card!.body || 'No description provided'}

## Requirements
1. Create Playwright tests using @playwright/test with Electron support
2. Use _electron.launch() for Electron-specific testing
3. Test the user-facing functionality added/modified by this issue
4. Place tests in: ${testDirectory}
5. Follow existing test patterns if any exist

## Playwright Electron Test Structure
\`\`\`typescript
import { test, expect, _electron as electron } from '@playwright/test';

test.describe('Feature Name', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await electron.launch({ args: ['.'] });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should do something', async () => {
    // Test implementation
  });
});
\`\`\`

## Instructions
1. Analyze the changed files to understand what functionality was added
2. Create comprehensive E2E tests that verify the user-facing behavior
3. Focus on testing the happy path and important edge cases
4. Ensure tests are stable and not flaky

Create the E2E tests now.`
}

/**
 * Build prompt for AI to fix failing E2E tests.
 */
export function buildE2EFixPrompt(
  ctx: PipelineContext,
  errorOutput: string,
  attempt: number,
  maxAttempts: number
): string {
  return `# Task: Fix Failing E2E Tests

## Test Failure Output
\`\`\`
${errorOutput}
\`\`\`

## Attempt
This is fix attempt ${attempt} of ${maxAttempts}.

## Issue Context
Title: ${ctx.card!.title}
Description: ${ctx.card!.body || 'No description provided'}

## Instructions
Analyze the test failure and fix either:
1. The test code if the test expectations are wrong
2. The application code if the implementation is incorrect
3. Both if needed

Focus on making the tests pass while ensuring the intended functionality works correctly.

Fix the failing tests now.`
}

/**
 * Run E2E tests and capture output.
 */
async function runE2ETests(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<{ success: boolean; output: string }> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const testCommand = config?.testCommand || 'npx playwright test'
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000

  const [command, ...args] = testCommand.split(' ')
  const outputLines: string[] = []

  try {
    await runProcessStreaming({
      command,
      args,
      cwd,
      timeoutMs,
      source: 'e2e',
      onLog: (message, meta) => {
        log(message, meta)
        outputLines.push(message)
      },
      isCanceled
    })

    return { success: true, output: outputLines.join('\n') }
  } catch (error) {
    if (error instanceof WorkerCanceledError) {
      throw error
    }
    return {
      success: false,
      output: outputLines.join('\n') + '\n' + (error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * Attempt to fix failing E2E tests using AI.
 */
async function attemptE2EFix(
  ctx: PipelineContext,
  errorOutput: string,
  attempt: number,
  maxAttempts: number,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000

  // Build fix prompt
  const prompt = buildE2EFixPrompt(ctx, errorOutput, attempt, maxAttempts)

  // Always try Claude first (as per user requirement) - use cached check
  const aiTools = await getAvailableAITools()
  const hasClaude = aiTools.claude
  const hasCodex = aiTools.codex

  // Get thinking mode configuration from policy
  const thinkingConfig = ctx.policy.features?.thinking
  const thinkingEnabled = thinkingConfig?.enabled !== false
  const thinkingMode = thinkingEnabled ? thinkingConfig?.mode : undefined
  const thinkingBudget = thinkingConfig?.budgetTokens

  try {
    if (hasClaude) {
      try {
        log('Attempting E2E fix with Claude Code...')
        await runClaudeCode({
          prompt,
          timeoutMs,
          cwd,
          log,
          isCanceled,
          thinkingMode,
          thinkingBudget
        })
        return true
      } catch (error) {
        if (error instanceof WorkerCanceledError) throw error
        if (hasCodex && isClaudeRetryableLimitError(error)) {
          log('Claude failed, falling back to Codex for fix...')
          await runCodex(prompt, timeoutMs, cwd, log, isCanceled)
          return true
        }
        throw error
      }
    } else if (hasCodex) {
      log('Attempting E2E fix with Codex...')
      await runCodex(prompt, timeoutMs, cwd, log, isCanceled)
      return true
    }

    log('No AI tool available for fix attempt')
    return false
  } catch (error) {
    if (error instanceof WorkerCanceledError) throw error
    log(`Fix attempt error: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Create E2E tests using AI.
 */
async function createE2ETests(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000
  const testDirs = config?.testDirectories || ['e2e', 'tests/e2e', 'test/e2e']
  const testDirectory = testDirs[0] // Use first directory for new tests

  // Get list of changed files (simplified - just use card info)
  const changedFiles = ['(files changed by AI implementation)']

  // Build creation prompt
  const prompt = buildE2ECreationPrompt(ctx, changedFiles, testDirectory)

  // Always try Claude first - use cached check
  const aiTools = await getAvailableAITools()
  const hasClaude = aiTools.claude
  const hasCodex = aiTools.codex

  // Get thinking mode configuration from policy
  const thinkingConfig = ctx.policy.features?.thinking
  const thinkingEnabled = thinkingConfig?.enabled !== false
  const thinkingMode = thinkingEnabled ? thinkingConfig?.mode : undefined
  const thinkingBudget = thinkingConfig?.budgetTokens

  try {
    if (hasClaude) {
      try {
        log('Creating E2E tests with Claude Code...')
        await runClaudeCode({
          prompt,
          timeoutMs,
          cwd,
          log,
          isCanceled,
          thinkingMode,
          thinkingBudget
        })
        return true
      } catch (error) {
        if (error instanceof WorkerCanceledError) throw error
        if (hasCodex && isClaudeRetryableLimitError(error)) {
          log('Claude failed, falling back to Codex for test creation...')
          await runCodex(prompt, timeoutMs, cwd, log, isCanceled)
          return true
        }
        throw error
      }
    } else if (hasCodex) {
      log('Creating E2E tests with Codex...')
      await runCodex(prompt, timeoutMs, cwd, log, isCanceled)
      return true
    }

    log('No AI tool available for E2E test creation')
    return false
  } catch (error) {
    if (error instanceof WorkerCanceledError) throw error
    log(`E2E test creation error: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Main E2E phase orchestrator with retry loop.
 */
export async function runE2EPhase(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<E2EResult> {
  const config = ctx.policy.worker?.e2e

  // Check if E2E is enabled
  if (!config?.enabled) {
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  }

  const maxRetries = config.maxRetries || 3
  const cwd = getWorkingDir(ctx)
  const testDirs = config.testDirectories || ['e2e', 'tests/e2e', 'test/e2e']

  // Step 1: Check Playwright is available
  const playwrightInstalled = await checkPlaywrightInstalled(cwd)
  if (!playwrightInstalled) {
    log('Playwright not installed in project, skipping E2E phase')
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  }

  // Step 2: Detect or create E2E tests
  let existingTests = detectExistingE2ETests(cwd, testDirs)
  let testsCreated = false

  if (existingTests.length === 0 && config.createTestsIfMissing) {
    log('No E2E tests found, instructing AI to create them...')
    const creationSuccess = await createE2ETests(ctx, log, isCanceled)
    if (!creationSuccess) {
      log('Failed to create E2E tests, continuing without E2E validation')
      return { success: false, testsCreated: false, testsRun: false, fixAttempts: 0, lastError: 'Failed to create E2E tests' }
    }
    testsCreated = true

    // Re-check for tests after creation
    existingTests = detectExistingE2ETests(cwd, testDirs)
    if (existingTests.length === 0) {
      log('AI did not create any E2E test files, continuing without E2E validation')
      return { success: false, testsCreated: true, testsRun: false, fixAttempts: 0, lastError: 'No E2E test files created' }
    }

    log(`E2E tests created: ${existingTests.join(', ')}`)
  } else if (existingTests.length === 0) {
    log('No E2E tests found and createTestsIfMissing is disabled, skipping E2E phase')
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  } else {
    log(`Found existing E2E tests: ${existingTests.join(', ')}`)
  }

  // Step 3: Run tests with retry loop
  let fixAttempts = 0
  let lastError: string | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (isCanceled()) throw new WorkerCanceledError()

    log(`Running E2E tests (attempt ${attempt + 1}/${maxRetries + 1})...`)
    const result = await runE2ETests(ctx, log, isCanceled)

    if (result.success) {
      log('E2E tests passed!')
      return { success: true, testsCreated, testsRun: true, fixAttempts }
    }

    lastError = result.output

    // Don't attempt fix on last iteration
    if (attempt >= maxRetries) {
      log(`E2E tests failed after ${maxRetries + 1} attempts`)
      break
    }

    // Attempt fix using AI
    fixAttempts++
    log(`E2E tests failed, attempting fix ${fixAttempts}/${maxRetries}...`)

    const fixSuccess = await attemptE2EFix(ctx, lastError, fixAttempts, maxRetries, log, isCanceled)
    if (!fixSuccess) {
      log('Fix attempt failed, continuing to next attempt...')
    }
  }

  return {
    success: false,
    testsCreated,
    testsRun: true,
    fixAttempts,
    lastError
  }
}
