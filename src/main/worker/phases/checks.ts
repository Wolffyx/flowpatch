/**
 * Checks Phase
 *
 * Handles lint, test, and build verification. Runs each step separately with
 * output capture so the pipeline can retry with AI on lint failure.
 */

import { runProcessStreaming, WorkerCanceledError } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn, type ChecksResult } from './types'
import { isCheckEnabled, getCheckSkipReason } from '@shared/utils/phase-utils'

/**
 * Run a single command and capture output. On failure returns the captured
 * output and error message for use in fix prompts.
 */
async function runCommandWithCapture(
  cmd: string,
  cwd: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<{ success: true } | { success: false; output: string }> {
  const [command, ...args] = cmd.split(' ')
  const outputLines: string[] = []

  try {
    await runProcessStreaming({
      command,
      args,
      cwd,
      timeoutMs: 5 * 60 * 1000,
      source: command,
      onLog: (message, meta) => {
        log(message, meta)
        outputLines.push(message)
      },
      isCanceled
    })
    return { success: true }
  } catch (error) {
    if (error instanceof WorkerCanceledError) {
      throw error
    }
    const output =
      outputLines.join('\n') + '\n' + (error instanceof Error ? error.message : String(error))
    log(`Check failed: ${error}`)
    return { success: false, output }
  }
}

/**
 * Run verification checks (lint, test, build). Runs each step separately with
 * output capture. Returns a structured result so the pipeline can retry with
 * AI when lint fails.
 *
 * @returns {ChecksResult} - `{ passed: true }` on success, or
 *   `{ passed: false, failedStep: 'lint'|'test'|'build', output: string }` on failure.
 */
export async function runChecks(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<ChecksResult> {
  const lintCmd = ctx.policy.worker?.lintCommand
  const testCmd = ctx.policy.worker?.testCommand
  const buildCmd = ctx.policy.worker?.buildCommand
  const cwd = getWorkingDir(ctx)

  // Lint check
  if (lintCmd) {
    if (isCheckEnabled(ctx.policy, 'lint')) {
      log(`Running lint: ${lintCmd}`)
      const result = await runCommandWithCapture(lintCmd, cwd, log, isCanceled)
      if (!result.success) {
        return { passed: false, failedStep: 'lint', output: result.output }
      }
    } else {
      log(getCheckSkipReason('lint'))
    }
  }

  // Test check
  if (testCmd) {
    if (isCheckEnabled(ctx.policy, 'test')) {
      log(`Running tests: ${testCmd}`)
      const result = await runCommandWithCapture(testCmd, cwd, log, isCanceled)
      if (!result.success) {
        return { passed: false, failedStep: 'test', output: result.output }
      }
    } else {
      log(getCheckSkipReason('test'))
    }
  }

  // Build check
  if (buildCmd) {
    if (isCheckEnabled(ctx.policy, 'build')) {
      log(`Running build: ${buildCmd}`)
      const result = await runCommandWithCapture(buildCmd, cwd, log, isCanceled)
      if (!result.success) {
        return { passed: false, failedStep: 'build', output: result.output }
      }
    } else {
      log(getCheckSkipReason('build'))
    }
  }

  return { passed: true }
}
