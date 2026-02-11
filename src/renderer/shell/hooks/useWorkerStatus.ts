/**
 * Worker Status Hook
 *
 * Consumes unified worker status from main process and enriches tabs with status indicators.
 * This replaces the previous multi-source computation approach.
 */

import { useState, useEffect, useMemo } from 'react'
import type { Project, WorkerStatus } from '@shared/types'
import type { TabData } from '../components/TabBar'

export interface TabDataWithStatus extends TabData {
  workerStatus: 'idle' | 'running' | 'ready' | 'error' | null
  activeRuns: number
}

interface UseWorkerStatusReturn {
  /** Tabs enriched with worker status */
  tabsWithStatus: TabDataWithStatus[]
}

/**
 * Hook to get worker status for tabs using the unified status from main process.
 */
export function useWorkerStatus(projects: Project[], tabs: TabData[]): UseWorkerStatusReturn {
  const [statusByProject, setStatusByProject] = useState<Record<string, WorkerStatus>>({})

  // Subscribe to unified status changes
  useEffect(() => {
    // Load initial status for all projects
    const loadInitialStatus = async () => {
      const initial: Record<string, WorkerStatus> = {}
      for (const project of projects) {
        try {
          const result = await window.shellAPI.getWorkerStatus(project.id)
          if (result?.status) {
            initial[project.id] = result.status
          }
        } catch {
          // Ignore errors for individual projects
        }
      }
      setStatusByProject(initial)
    }

    loadInitialStatus()

    // Subscribe to changes
    const unsubscribe = window.shellAPI.onWorkerStatusChanged((data) => {
      setStatusByProject((prev) => ({
        ...prev,
        [data.projectId]: data.status
      }))
    })

    return unsubscribe
  }, [projects])

  // Map unified status to tab display status
  const tabsWithStatus = useMemo(
    () =>
      tabs.map((tab) => {
        const project = projects.find((p) => p.id === tab.projectId)
        const status = statusByProject[tab.projectId]
        let workerStatus: 'idle' | 'running' | 'ready' | 'error' | null = null

        if (!project?.worker_enabled) {
          workerStatus = null
        } else if (!status) {
          workerStatus = 'idle'
        } else if (
          ['processing', 'testing', 'pushing', 'queued', 'paused'].includes(status.state)
        ) {
          workerStatus = 'running'
        } else if (status.state === 'failed') {
          workerStatus = 'error'
        } else if (status.state === 'succeeded') {
          workerStatus = 'ready'
        } else {
          workerStatus = 'idle'
        }

        const isActive = ['processing', 'testing', 'pushing', 'queued'].includes(
          status?.state ?? ''
        )
        return {
          ...tab,
          workerStatus,
          activeRuns: isActive ? 1 : 0
        }
      }),
    [tabs, projects, statusByProject]
  )

  return { tabsWithStatus }
}
