/**
 * Install Phase
 *
 * Runs npm/pnpm install to prepare the working environment.
 */

import { runProcessStreaming } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'

/**
 * Run package installation.
 */
export async function runInstall(
  ctx: PipelineContext,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  const cwd = getWorkingDir(ctx)
  const installCmd = ctx.policy.worker?.installCommand ?? 'npm install'

  log(`Installing dependencies: ${installCmd}`)

  try {
    const [command, ...args] = installCmd.split(' ')
    await runProcessStreaming({
      command,
      args,
      cwd,
      timeoutMs: 10 * 60 * 1000, // 10 minutes
      source: 'install',
      onLog: (message, meta) => log(message, meta),
      isCanceled
    })
    log('Dependencies installed successfully')
    return true
  } catch (error) {
    log(`Install failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
