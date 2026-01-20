/**
 * Dev Server Status Hook
 *
 * Tracks dev server status for cards and listens to real-time updates
 */

import { useState, useEffect, useCallback } from 'react'

export interface DevServerStatus {
  cardId: string
  status: 'starting' | 'running' | 'stopped' | 'error' | null
  port?: number
  startedAt?: string
  error?: string
}

export interface UseDevServerStatusReturn {
  getStatus: (cardId: string) => DevServerStatus | null
  isRunning: (cardId: string) => boolean
  getPort: (cardId: string) => number | undefined
}

/**
 * Hook to track dev server status for cards
 * Listens to IPC events for real-time updates
 */
export function useDevServerStatus(cardIds?: string[]): UseDevServerStatusReturn {
  const [statuses, setStatuses] = useState<Record<string, DevServerStatus>>({})

  // Load initial statuses for all cards when cardIds change
  useEffect(() => {
    if (!cardIds || cardIds.length === 0) return

    const loadStatuses = async () => {
      const results = await Promise.allSettled(
        cardIds.map(async (cardId) => {
          try {
            const result = await window.projectAPI.getDevServerStatus(cardId)
            if (result.success && result.status) {
              return {
                cardId,
                status: {
                  cardId,
                  status: result.status as 'starting' | 'running' | 'stopped' | 'error',
                  port: result.port,
                  startedAt: result.startedAt,
                  error: result.error
                }
              }
            }
            return { cardId, status: null }
          } catch (err) {
            console.error(`[useDevServerStatus] Failed to load status for card ${cardId}:`, err)
            return { cardId, status: null }
          }
        })
      )

      setStatuses((prev) => {
        const next = { ...prev }
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.status) {
            next[result.value.cardId] = result.value.status
          } else if (result.status === 'fulfilled') {
            delete next[result.value.cardId]
          }
        })
        return next
      })
    }

    void loadStatuses()
  }, [cardIds])

  // Listen to dev server status changes
  useEffect(() => {
    const unsubscribeStatus = window.projectAPI.onDevServerStatus((data) => {
      setStatuses((prev) => ({
        ...prev,
        [data.cardId]: {
          cardId: data.cardId,
          status: data.status as 'starting' | 'running' | 'stopped' | 'error',
          startedAt: data.timestamp
        }
      }))
    })

    const unsubscribePort = window.projectAPI.onDevServerPort((data) => {
      setStatuses((prev) => ({
        ...prev,
        [data.cardId]: {
          ...prev[data.cardId],
          cardId: data.cardId,
          port: data.port,
          status: 'running'
        }
      }))
    })

    return () => {
      unsubscribeStatus()
      unsubscribePort()
    }
  }, [])

  const getStatus = useCallback(
    (cardId: string): DevServerStatus | null => {
      return statuses[cardId] || null
    },
    [statuses]
  )

  const isRunning = useCallback(
    (cardId: string): boolean => {
      const status = statuses[cardId]
      return status?.status === 'running' || status?.status === 'starting'
    },
    [statuses]
  )

  const getPort = useCallback(
    (cardId: string): number | undefined => {
      return statuses[cardId]?.port
    },
    [statuses]
  )

  return {
    getStatus,
    isRunning,
    getPort
  }
}
