/**
 * Checks Phase
 *
 * Handles lint, test, and build verification.
 */

import { runProcessStreaming } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'

/**
 * Run a single command.
 */
async function runCommand(
  cmd: string,
  cwd: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<void> {
  const [command, ...args] = cmd.split(' ')
  await runProcessStreaming({
    command,
    args,
    cwd,
    timeoutMs: 5 * 60 * 1000,
    source: command,
    onLog: (message, meta) => log(message, meta),
    isCanceled
  })
}

/**
 * Run verification checks (lint, test, build).
 */
export async function runChecks(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const lintCmd = ctx.policy.worker?.lintCommand
  const testCmd = ctx.policy.worker?.testCommand
  const buildCmd = ctx.policy.worker?.buildCommand
  const cwd = getWorkingDir(ctx)

  try {
    if (lintCmd) {
      log(`Running lint: ${lintCmd}`)
      await runCommand(lintCmd, cwd, log, isCanceled)
    }

    if (testCmd) {
      log(`Running tests: ${testCmd}`)
      await runCommand(testCmd, cwd, log, isCanceled)
    }

    if (buildCmd) {
      log(`Running build: ${buildCmd}`)
      await runCommand(buildCmd, cwd, log, isCanceled)
    }

    return true
  } catch (error) {
    log(`Check failed: ${error}`)
    return false
  }
}
