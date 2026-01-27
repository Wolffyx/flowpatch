/**
 * E2E Phase
 *
 * Handles Playwright E2E test creation and execution with retry loop.
 * Supports multiple application types:
 * - Electron: Desktop apps using _electron.launch()
 * - Web: Web apps with dev server
 * - Static: Static HTML/JS apps using file:// protocol
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { runProcessStreaming, WorkerCanceledError } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { runClaudeCode, runCodex, isClaudeRetryableLimitError } from './ai'
import { getAvailableAITools } from '../cache'

import type { AppType, E2ETestConfig } from '../../../shared/types/interfaces/e2e-test'
import type { Card, CardE2EOverride } from '../../../shared/types/interfaces/card'

import { DevServerManager } from '../services/dev-server-manager'
import { detectAppType, resolveAutoAppType } from '../services/app-type-detector'
import { TestPersistenceManager } from '../services/test-persistence-manager'
import {
  buildBrowserE2ECreationPrompt,
  buildBrowserE2EFixPrompt,
  type BrowserPromptContext
} from './prompts/browser-test-prompts'

/**
 * E2E phase result structure.
 */
export interface E2EResult {
  success: boolean
  testsCreated: boolean
  testsRun: boolean
  fixAttempts: number
  lastError?: string
  appType?: AppType
  devServerUrl?: string
}

/**
 * Check if Playwright is installed in the project.
 */
export async function checkPlaywrightInstalled(cwd: string): Promise<boolean> {
  try {
    const packageJsonPath = join(cwd, 'package.json')
    if (!existsSync(packageJsonPath)) return false

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
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
 * Get card-level E2E override configuration from card metadata.
 */
function getCardE2EOverride(card: Card | null): CardE2EOverride | null {
  if (!card?.metadata_json) {
    return null
  }

  try {
    const metadata = JSON.parse(card.metadata_json)
    return metadata.e2e || null
  } catch {
    return null
  }
}

/**
 * Resolve the effective app type, considering card overrides and auto-detection.
 */
async function resolveEffectiveAppType(
  config: E2ETestConfig,
  cardOverride: CardE2EOverride | null,
  cwd: string,
  log: LogFn
): Promise<AppType> {
  // Card override takes priority
  if (cardOverride?.appType) {
    log(`Using card-level app type override: ${cardOverride.appType}`)
    return cardOverride.appType
  }

  // Use config value or auto-detect
  const configAppType = config.appType ?? 'auto'

  if (configAppType === 'auto') {
    const detected = await detectAppType(cwd)
    log(`Auto-detected app type: ${detected}`)
    return detected
  }

  return configAppType
}

/**
 * Build prompt for AI to create E2E tests based on app type.
 */
function buildE2ECreationPromptForAppType(
  ctx: PipelineContext,
  appType: AppType,
  baseUrl: string,
  testDirectory: string,
  existingTests: string[]
): string {
  const changedFiles = ['(files changed by AI implementation)']

  if (appType === 'electron') {
    // Use existing Electron prompt
    return buildElectronE2ECreationPrompt(ctx, changedFiles, testDirectory)
  }

  // Use browser prompts for web and static
  const promptCtx: BrowserPromptContext = {
    appType,
    baseUrl,
    changedFiles,
    cardTitle: ctx.card!.title,
    cardBody: ctx.card!.body || '',
    testDirectory,
    existingTests,
    framework: 'playwright'
  }

  return buildBrowserE2ECreationPrompt(promptCtx)
}

/**
 * Build prompt for AI to create E2E tests for Electron apps.
 */
function buildElectronE2ECreationPrompt(
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
function buildE2EFixPromptForAppType(
  ctx: PipelineContext,
  appType: AppType,
  baseUrl: string,
  errorOutput: string,
  attempt: number,
  maxAttempts: number
): string {
  if (appType === 'electron') {
    return buildElectronE2EFixPrompt(ctx, errorOutput, attempt, maxAttempts)
  }

  const promptCtx: BrowserPromptContext = {
    appType,
    baseUrl,
    changedFiles: [],
    cardTitle: ctx.card!.title,
    cardBody: ctx.card!.body || '',
    testDirectory: '',
    existingTests: [],
    framework: 'playwright'
  }

  return buildBrowserE2EFixPrompt(promptCtx, errorOutput, attempt, maxAttempts)
}

/**
 * Build prompt for AI to fix failing Electron E2E tests.
 */
function buildElectronE2EFixPrompt(
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
  isCanceled: () => boolean,
  testCommand?: string
): Promise<{ success: boolean; output: string }> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const effectiveTestCommand = testCommand || config?.testCommand || 'npx playwright test'
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000

  const [command, ...args] = effectiveTestCommand.split(' ')
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
      output:
        outputLines.join('\n') + '\n' + (error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * Attempt to fix failing E2E tests using AI.
 */
async function attemptE2EFix(
  ctx: PipelineContext,
  appType: AppType,
  baseUrl: string,
  errorOutput: string,
  attempt: number,
  maxAttempts: number,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000

  // Build fix prompt based on app type
  const prompt = buildE2EFixPromptForAppType(ctx, appType, baseUrl, errorOutput, attempt, maxAttempts)

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
  appType: AppType,
  baseUrl: string,
  testDirectory: string,
  existingTests: string[],
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const config = ctx.policy.worker?.e2e
  const cwd = getWorkingDir(ctx)
  const timeoutMs = (config?.timeoutMinutes || 10) * 60 * 1000

  // Build creation prompt based on app type
  const prompt = buildE2ECreationPromptForAppType(ctx, appType, baseUrl, testDirectory, existingTests)

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
 * Supports multiple application types with automatic dev server management.
 */
export async function runE2EPhase(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<E2EResult> {
  const config = ctx.policy.worker?.e2e

  // Check if E2E is enabled at project level
  if (!config?.enabled) {
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  }

  // Check for card-level E2E override
  const cardOverride = getCardE2EOverride(ctx.card)
  if (cardOverride?.enabled === false) {
    log('E2E testing disabled for this card via override')
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  }

  const maxRetries = config.maxRetries || 3
  const cwd = getWorkingDir(ctx)

  // Step 1: Check Playwright is available
  const playwrightInstalled = await checkPlaywrightInstalled(cwd)
  if (!playwrightInstalled) {
    log('Playwright not installed in project, skipping E2E phase')
    return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0 }
  }

  // Step 2: Determine app type
  let appType = await resolveEffectiveAppType(config, cardOverride, cwd, log)

  // Resolve 'auto' to concrete type
  if (appType === 'auto') {
    appType = await resolveAutoAppType(cwd)
    log(`Resolved auto app type to: ${appType}`)
  }

  // Step 3: Initialize dev server if needed
  let devServerManager: DevServerManager | null = null
  let baseUrl = cardOverride?.baseUrl || config.baseUrl || ''

  if (appType === 'web') {
    log('Starting dev server for web app E2E testing...')
    devServerManager = new DevServerManager(config.devServer || {}, cwd, log)

    const startResult = await devServerManager.start()
    if (!startResult.success) {
      log(`Dev server failed to start: ${startResult.error}`)
      return {
        success: false,
        testsCreated: false,
        testsRun: false,
        fixAttempts: 0,
        lastError: `Dev server failed to start: ${startResult.error}`,
        appType
      }
    }

    baseUrl = startResult.url || baseUrl
    log(`Dev server running at: ${baseUrl}`)
  } else if (appType === 'static') {
    // For static apps, baseUrl is typically file:// protocol
    baseUrl = baseUrl || `file://${join(cwd, 'index.html')}`
    log(`Static app base URL: ${baseUrl}`)
  }

  // Step 4: Initialize test persistence manager
  const testPersistenceConfig = {
    mode: config.testPersistence || 'persistent',
    testDirectory: config.testDirectories?.[0] || 'e2e',
    tempDirectory: config.tempTestDirectory || '.flowpatch/temp-tests',
    cardId: ctx.cardId,
    jobId: ctx.jobId || '',
    cwd
  }
  const persistenceManager = new TestPersistenceManager(testPersistenceConfig, log)
  persistenceManager.ensureTestDirectory()

  const testDirectory = persistenceManager.getRelativeTestDirectory()
  let testsCreated = false
  let lastError: string | undefined

  try {
    // Step 5: Detect or create E2E tests
    let existingTests = persistenceManager.scanExistingTests()

    if (existingTests.length === 0 && config.createTestsIfMissing) {
      log(`No E2E tests found, instructing AI to create them for ${appType} app...`)

      const creationSuccess = await createE2ETests(
        ctx,
        appType,
        baseUrl,
        testDirectory,
        existingTests,
        log,
        isCanceled
      )

      if (!creationSuccess) {
        log('Failed to create E2E tests, continuing without E2E validation')
        return {
          success: false,
          testsCreated: false,
          testsRun: false,
          fixAttempts: 0,
          lastError: 'Failed to create E2E tests',
          appType,
          devServerUrl: baseUrl
        }
      }
      testsCreated = true

      // Re-check for tests after creation
      existingTests = persistenceManager.scanExistingTests()
      if (existingTests.length === 0) {
        log('AI did not create any E2E test files, continuing without E2E validation')
        return {
          success: false,
          testsCreated: true,
          testsRun: false,
          fixAttempts: 0,
          lastError: 'No E2E test files created',
          appType,
          devServerUrl: baseUrl
        }
      }

      // Track created files for cleanup
      existingTests.forEach((file) => persistenceManager.trackCreatedFile(file))
      log(`E2E tests created: ${existingTests.join(', ')}`)
    } else if (existingTests.length === 0) {
      log('No E2E tests found and createTestsIfMissing is disabled, skipping E2E phase')
      return { success: true, testsCreated: false, testsRun: false, fixAttempts: 0, appType }
    } else {
      log(`Found existing E2E tests: ${existingTests.join(', ')}`)
    }

    // Step 6: Run tests with retry loop
    let fixAttempts = 0
    const testCommand = cardOverride?.testCommand || config.testCommand

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isCanceled()) throw new WorkerCanceledError()

      log(`Running E2E tests (attempt ${attempt + 1}/${maxRetries + 1})...`)
      const result = await runE2ETests(ctx, log, isCanceled, testCommand)

      if (result.success) {
        log('E2E tests passed!')
        return {
          success: true,
          testsCreated,
          testsRun: true,
          fixAttempts,
          appType,
          devServerUrl: baseUrl
        }
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

      const fixSuccess = await attemptE2EFix(
        ctx,
        appType,
        baseUrl,
        lastError,
        fixAttempts,
        maxRetries,
        log,
        isCanceled
      )
      if (!fixSuccess) {
        log('Fix attempt failed, continuing to next attempt...')
      }
    }

    return {
      success: false,
      testsCreated,
      testsRun: true,
      fixAttempts,
      lastError,
      appType,
      devServerUrl: baseUrl
    }
  } finally {
    // Cleanup: stop dev server
    if (devServerManager) {
      log('Stopping dev server...')
      await devServerManager.stop()
    }

    // Cleanup: remove temporary tests if configured
    const e2eSuccess = !lastError
    await persistenceManager.cleanup(e2eSuccess)
  }
}
