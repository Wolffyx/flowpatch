/**
 * Worker Status Hook
 *
 * Computes worker status for projects and enriches tabs with status indicators
 */

import { useMemo } from 'react'
import type { Project, Job } from '@shared/types'
import type { TabData } from '../components/TabBar'

interface ProjectWorkerStatus {
  workerEnabled: boolean
  activeRuns: number
  lastJobState: 'running' | 'completed' | 'failed' | null
}

interface ComputedWorkerStatus {
  workerEnabled: boolean
  activeRuns: number
  lastJobState: 'running' | 'completed' | 'failed' | null
}

export interface TabDataWithStatus extends TabData {
  workerStatus: 'idle' | 'running' | 'ready' | 'error' | null
  activeRuns: number
}

interface UseWorkerStatusReturn {
  /** Computed worker status per project */
  computedWorkerStatus: Record<string, ComputedWorkerStatus>
  /** Tabs enriched with worker status */
  tabsWithStatus: TabDataWithStatus[]
}

export function useWorkerStatus(
  projects: Project[],
  recentJobs: Job[],
  projectWorkerStatus: Record<string, ProjectWorkerStatus>,
  tabs: TabData[]
): UseWorkerStatusReturn {
  // Compute per-project worker status from projects and jobs
  const computedWorkerStatus = useMemo(() => {
    const statusMap: Record<string, ComputedWorkerStatus> = {}

    // Initialize from projects (worker_enabled field)
    for (const project of projects) {
      const workerJobs = recentJobs.filter(
        j => j.project_id === project.id && j.type === 'worker_run'
      )
      const activeWorkerJobs = workerJobs.filter(
        j => j.state === 'running' || j.state === 'queued'
      )
      const latestWorkerJob = workerJobs.length > 0
        ? workerJobs.reduce((latest, job) => {
            const latestTime = latest.updated_at || latest.created_at
            const jobTime = job.updated_at || job.created_at
            return jobTime > latestTime ? job : latest
          })
        : null

      let lastJobState: 'running' | 'completed' | 'failed' | null = null
      if (activeWorkerJobs.length > 0) {
        lastJobState = 'running'
      } else if (latestWorkerJob?.state === 'succeeded') {
        lastJobState = 'completed'
      } else if (latestWorkerJob?.state === 'failed') {
        lastJobState = 'failed'
      }

      statusMap[project.id] = {
        workerEnabled: project.worker_enabled === 1,
        activeRuns: activeWorkerJobs.length,
        lastJobState
      }
    }

    // Merge with activity updates (they take precedence for active runs)
    for (const [projectId, status] of Object.entries(projectWorkerStatus)) {
      if (statusMap[projectId]) {
        // Activity updates override for activeRuns
        if (status.activeRuns > 0) {
          statusMap[projectId].activeRuns = status.activeRuns
          statusMap[projectId].lastJobState = 'running'
        }
      }
    }

    return statusMap
  }, [projects, recentJobs, projectWorkerStatus])

  // Enrich tabs with worker status for tab indicators
  const tabsWithStatus = useMemo(() =>
    tabs.map(tab => {
      const status = computedWorkerStatus[tab.projectId]
      let workerStatus: 'idle' | 'running' | 'ready' | 'error' | null = null

      if (status?.activeRuns > 0) {
        workerStatus = 'running'
      } else if (status?.lastJobState === 'failed') {
        workerStatus = 'error'
      } else if (status?.lastJobState === 'completed') {
        workerStatus = 'ready'
      } else if (status?.workerEnabled) {
        workerStatus = 'idle'
      }

      return {
        ...tab,
        workerStatus,
        activeRuns: status?.activeRuns ?? 0
      }
    }),
    [tabs, computedWorkerStatus]
  )

  return {
    computedWorkerStatus,
    tabsWithStatus
  }
}
