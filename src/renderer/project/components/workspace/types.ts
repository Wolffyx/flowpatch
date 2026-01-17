import type { Job, JobResultEnvelope } from '@shared/types'

export type ApprovalState = {
  confirmIndexBuild: boolean
  confirmIndexRefresh: boolean
  confirmWatchToggle: boolean
  confirmDocsRefresh: boolean
  confirmContextPreview: boolean
  confirmRepair: boolean
  confirmMigrate: boolean
}

export const defaultApproval: ApprovalState = {
  confirmIndexBuild: true,
  confirmIndexRefresh: true,
  confirmWatchToggle: true,
  confirmDocsRefresh: true,
  confirmContextPreview: true,
  confirmRepair: true,
  confirmMigrate: true
}

export function latestJobOfType(jobs: Job[], type: Job['type']): Job | null {
  const matches = jobs.filter((j) => j.type === type)
  if (matches.length === 0) return null
  return matches.reduce((latest, job) => {
    const latestTime = latest.updated_at || latest.created_at
    const jobTime = job.updated_at || job.created_at
    return jobTime > latestTime ? job : latest
  })
}

export function jobIsActive(job: Job | null): boolean {
  return job?.state === 'queued' || job?.state === 'running'
}

export function parseJobResult(job: Job | null): JobResultEnvelope | null {
  if (!job?.result_json) return null
  try {
    return JSON.parse(job.result_json) as JobResultEnvelope
  } catch {
    return null
  }
}
