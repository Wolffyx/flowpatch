/**
 * Audio Notifications Hook
 *
 * Monitors worker job state changes and plays appropriate notification sounds.
 */

import { useEffect, useRef, useCallback } from 'react'
import {
  playNotificationSound,
  initAudio,
  type NotificationSoundType
} from '../services/audio-notifications'
import type { Job, NotificationsConfig } from '../../../shared/types'

interface UseAudioNotificationsOptions {
  /** Notification settings */
  config: NotificationsConfig
  /** Current jobs to monitor */
  jobs: Job[]
  /** Whether the hook is enabled */
  enabled?: boolean
}

/**
 * Hook that monitors job state changes and plays notification sounds
 */
export function useAudioNotifications({
  config,
  jobs,
  enabled = true
}: UseAudioNotificationsOptions): {
  playSound: (type: NotificationSoundType) => Promise<void>
  initializeAudio: () => void
} {
  // Track previous job states to detect changes
  const prevJobStatesRef = useRef<Map<string, string>>(new Map())
  const audioInitializedRef = useRef(false)

  // Initialize audio on first user interaction
  const initializeAudio = useCallback(() => {
    if (!audioInitializedRef.current) {
      initAudio()
      audioInitializedRef.current = true
    }
  }, [])

  // Play sound with current config
  const playSound = useCallback(
    async (type: NotificationSoundType) => {
      if (!enabled || !config.audioEnabled) return
      await playNotificationSound(type, config)
    },
    [config, enabled]
  )

  // Monitor job state changes
  useEffect(() => {
    if (!enabled || !config.audioEnabled) return

    const currentStates = new Map<string, string>()

    for (const job of jobs) {
      currentStates.set(job.id, job.state)

      const prevState = prevJobStatesRef.current.get(job.id)

      // Skip if no previous state (new job) or same state
      if (!prevState || prevState === job.state) continue

      // Detect state transitions
      if (job.state === 'succeeded' && prevState === 'running') {
        // Job completed successfully
        if (config.soundOnComplete) {
          void playNotificationSound('complete', config)
        }
      } else if (job.state === 'failed' && prevState === 'running') {
        // Job failed
        if (config.soundOnError) {
          void playNotificationSound('error', config)
        }
      } else if (job.state === 'pending_approval' && prevState === 'running') {
        // Job needs approval
        if (config.soundOnApproval) {
          void playNotificationSound('approval', config)
        }
      }
    }

    // Update previous states
    prevJobStatesRef.current = currentStates
  }, [jobs, config, enabled])

  return {
    playSound,
    initializeAudio
  }
}

/**
 * Get default notification config
 */
export function getDefaultNotificationsConfig(): NotificationsConfig {
  return {
    audioEnabled: false,
    soundOnComplete: true,
    soundOnError: true,
    soundOnApproval: true
  }
}
