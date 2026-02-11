/**
 * Unit tests for the checks phase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runChecks } from './checks'
import type { PipelineContext, LogFn } from './types'

vi.mock('../process-runner', () => ({
  runProcessStreaming: vi.fn(),
  WorkerCanceledError: class WorkerCanceledError extends Error {
    constructor() {
      super('Canceled')
      this.name = 'WorkerCanceledError'
    }
  }
}))

const { runProcessStreaming } = await import('../process-runner')

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    projectId: 'proj-1',
    cardId: 'card-1',
    jobId: 'job-1',
    workerId: 'worker-1',
    project: { id: 'proj-1', local_path: '/tmp/proj', policy_json: null } as PipelineContext['project'],
    card: null,
    policy: {
      version: 1,
      worker: {
        lintCommand: 'pnpm lint',
        testCommand: 'pnpm test',
        buildCommand: undefined
      }
    },
    ...overrides
  } as PipelineContext
}

describe('runChecks', () => {
  const log: LogFn = vi.fn()
  const isCanceled = vi.fn(() => false)

  beforeEach(() => {
    vi.mocked(log).mockClear()
    vi.mocked(isCanceled).mockReturnValue(false)
    vi.mocked(runProcessStreaming).mockReset()
  })

  it('returns { passed: true } when lint and test succeed', async () => {
    vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

    const ctx = makeContext()
    const result = await runChecks(ctx, log, isCanceled)

    expect(result).toEqual({ passed: true })
    expect(runProcessStreaming).toHaveBeenCalledTimes(2) // lint, test
  })

  it('returns { passed: false, failedStep: "lint", output } when lint command throws', async () => {
    vi.mocked(runProcessStreaming).mockImplementation((opts: any) => {
      opts?.onLog?.('line1', { stream: 'stderr' })
      opts?.onLog?.('line2', { stream: 'stdout' })
      return Promise.reject(new Error('Command exited with code 1'))
    })

    const ctx = makeContext()
    const result = await runChecks(ctx, log, isCanceled)

    expect(result).toEqual({
      passed: false,
      failedStep: 'lint',
      output: expect.stringContaining('line1')
    })
    expect(result).toHaveProperty('output')
    if (!result.passed && result.failedStep === 'lint') {
      expect(result.output).toContain('line2')
      expect(result.output).toContain('Command exited with code 1')
    }
    expect(runProcessStreaming).toHaveBeenCalledTimes(1)
  })

  it('returns { passed: false, failedStep: "test", output } when test command throws', async () => {
    vi.mocked(runProcessStreaming)
      .mockResolvedValueOnce(undefined) // lint passes
      .mockRejectedValueOnce(new Error('Tests failed'))

    const ctx = makeContext()
    const result = await runChecks(ctx, log, isCanceled)

    expect(result).toEqual({
      passed: false,
      failedStep: 'test',
      output: expect.stringContaining('Tests failed')
    })
    expect(runProcessStreaming).toHaveBeenCalledTimes(2)
  })

  it('skips lint when lintCommand is not set', async () => {
    vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

    const ctx = makeContext({
      policy: {
        version: 1,
        worker: { lintCommand: undefined, testCommand: 'pnpm test', buildCommand: undefined }
      }
    } as Partial<PipelineContext>)
    const result = await runChecks(ctx, log, isCanceled)

    expect(result).toEqual({ passed: true })
    expect(runProcessStreaming).toHaveBeenCalledTimes(1) // only test
  })

  describe('individual check toggles', () => {
    it('skips lint when enableLintCheck is false', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableLintCheck: false // Lint disabled
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(2) // test + build (no lint)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Lint check disabled'))
    })

    it('skips test when enableTestCheck is false', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableTestCheck: false // Test disabled
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(2) // lint + build (no test)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Test check disabled'))
    })

    it('skips build when enableBuildCheck is false', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableBuildCheck: false // Build disabled
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(2) // lint + test (no build)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Build check disabled'))
    })

    it('skips all checks when master enableChecksPhase is false', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableChecksPhase: false // Master toggle off
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(0) // No checks run
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Lint check disabled'))
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Test check disabled'))
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Build check disabled'))
    })

    it('runs all checks when all toggles are enabled', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableChecksPhase: true,
            enableLintCheck: true,
            enableTestCheck: true,
            enableBuildCheck: true
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(3) // lint + test + build
    })

    it('runs only enabled checks (lint + build, skip test)', async () => {
      vi.mocked(runProcessStreaming).mockResolvedValue(undefined)

      const ctx = makeContext({
        policy: {
          version: 1,
          worker: {
            lintCommand: 'pnpm lint',
            testCommand: 'pnpm test',
            buildCommand: 'pnpm build',
            enableLintCheck: true,
            enableTestCheck: false, // Skip test
            enableBuildCheck: true
          }
        }
      } as Partial<PipelineContext>)
      const result = await runChecks(ctx, log, isCanceled)

      expect(result).toEqual({ passed: true })
      expect(runProcessStreaming).toHaveBeenCalledTimes(2) // lint + build (no test)
    })
  })
})
