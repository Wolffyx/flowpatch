/**
 * Shell Activity Hook
 *
 * Manages activity state, jobs, and worker status
 */

import { useState, useEffect, useCallback } from 'react'
import type { Job } from '@shared/types'
import type { ActivityState } from '../interfaces'

interface ProjectWorkerStatus {
  workerEnabled: boolean
  activeRuns: number
  lastJobState: 'running' | 'completed' | 'failed' | null
}

interface UseShellActivityReturn {
  /** Current activity state */
  activity: ActivityState
  /** Recent jobs */
  recentJobs: Job[]
  /** Per-project worker status */
  projectWorkerStatus: Record<string, ProjectWorkerStatus>
  /** Load activity from the shell API */
  loadActivity: () => Promise<void>
  /** Load recent jobs from the shell API */
  loadRecentJobs: () => Promise<void>
}

export function useShellActivity(
  onStateUpdated?: () => void
): UseShellActivityReturn {
  const [activity, setActivity] = useState<ActivityState>({
    totalActiveRuns: 0,
    isBusy: false,
    busyProjects: []
  })
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [projectWorkerStatus, setProjectWorkerStatus] = useState<Record<string, ProjectWorkerStatus>>({})

  const loadActivity = useCallback(async (): Promise<void> => {
    try {
      const activityState = await window.shellAPI.getActivity()
      setActivity(activityState)
    } catch (error) {
      console.error('Failed to load activity:', error)
    }
  }, [])

  const loadRecentJobs = useCallback(async (): Promise<void> => {
    try {
      const jobs = await window.shellAPI.getRecentJobs(200)
      setRecentJobs(jobs)
    } catch (error) {
      console.error('Failed to load recent jobs:', error)
      setRecentJobs([])
    }
  }, [])

  // Subscribe to activity updates and track per-project worker status
  useEffect(() => {
    const unsubscribe = window.shellAPI.onActivityUpdate((activityData) => {
      // Update per-project worker status for tab indicators
      setProjectWorkerStatus(prev => ({
        ...prev,
        [activityData.projectId]: {
          workerEnabled: true, // If we get updates, worker is enabled
          activeRuns: activityData.activeRuns,
          lastJobState: activityData.activeRuns > 0 ? 'running' : 'completed'
        }
      }))
      loadActivity()
    })
    return unsubscribe
  }, [loadActivity])

  // Subscribe to global state updates (jobs/projects, etc.)
  useEffect(() => {
    const unsubscribe = window.shellAPI.onStateUpdated(() => {
      onStateUpdated?.()
      loadActivity()
      loadRecentJobs()
    })
    return unsubscribe
  }, [onStateUpdated, loadActivity, loadRecentJobs])

  return {
    activity,
    recentJobs,
    projectWorkerStatus,
    loadActivity,
    loadRecentJobs
  }
}
