/**
 * useProviderAvailability Hook
 *
 * Fetches and caches AI CLI provider availability status.
 * Checks which providers (claude, codex, opencode) are installed on the system.
 */

import { useState, useEffect } from 'react'
import type { ProviderAvailabilityInfo } from '@shared/types'

interface UseProviderAvailabilityReturn {
  /** List of all providers with availability status */
  providers: ProviderAvailabilityInfo[]

  /** Whether availability data is still loading */
  loading: boolean

  /** Check if a specific provider is available */
  isAvailable: (key: string) => boolean

  /** Reload availability status */
  reload: () => Promise<void>
}

export function useProviderAvailability(): UseProviderAvailabilityReturn {
  const [providers, setProviders] = useState<ProviderAvailabilityInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadAvailability = async (): Promise<void> => {
    try {
      setLoading(true)
      const result = (await window.electron.ipcRenderer.invoke('providers:getAvailability')) as {
        providers: ProviderAvailabilityInfo[]
        error?: string
      }

      if (result.error) {
        console.error('Failed to load provider availability:', result.error)
        setProviders([])
      } else {
        setProviders(result.providers)
      }
    } catch (error) {
      console.error('Error loading provider availability:', error)
      setProviders([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAvailability()
  }, [])

  const isAvailable = (key: string): boolean => {
    return providers.find((p) => p.key === key)?.available ?? false
  }

  return {
    providers,
    loading,
    isAvailable,
    reload: loadAvailability
  }
}
