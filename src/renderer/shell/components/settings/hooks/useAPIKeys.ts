/**
 * API Keys Hook
 *
 * Manages API key state and persistence
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'

interface UseAPIKeysReturn {
  anthropicApiKey: string
  openaiApiKey: string
  showAnthropicKey: boolean
  showOpenaiKey: boolean
  savingAnthropicKey: boolean
  savingOpenaiKey: boolean
  setAnthropicApiKey: (key: string) => void
  setOpenaiApiKey: (key: string) => void
  setShowAnthropicKey: (show: boolean) => void
  setShowOpenaiKey: (show: boolean) => void
  loadAPIKeys: () => Promise<void>
  handleSaveAnthropicKey: () => Promise<void>
  handleSaveOpenaiKey: () => Promise<void>
}

export function useAPIKeys(): UseAPIKeysReturn {
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false)
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false)

  const loadAPIKeys = useCallback(async () => {
    try {
      const anthropic = (await window.electron.ipcRenderer.invoke('getApiKey', {
        key: 'anthropic'
      })) as string | null
      const openai = (await window.electron.ipcRenderer.invoke('getApiKey', {
        key: 'openai'
      })) as string | null
      setAnthropicApiKey(anthropic || '')
      setOpenaiApiKey(openai || '')
    } catch {
      // API keys feature may not be implemented yet
    }
  }, [])

  const handleSaveAnthropicKey = useCallback(async () => {
    setSavingAnthropicKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', {
        key: 'anthropic',
        value: anthropicApiKey
      })
      toast.success('Anthropic API key saved')
    } catch (err) {
      console.error('Failed to save Anthropic API key:', err)
      toast.error('Failed to save Anthropic API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingAnthropicKey(false)
    }
  }, [anthropicApiKey])

  const handleSaveOpenaiKey = useCallback(async () => {
    setSavingOpenaiKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', {
        key: 'openai',
        value: openaiApiKey
      })
      toast.success('OpenAI API key saved')
    } catch (err) {
      console.error('Failed to save OpenAI API key:', err)
      toast.error('Failed to save OpenAI API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingOpenaiKey(false)
    }
  }, [openaiApiKey])

  return {
    anthropicApiKey,
    openaiApiKey,
    showAnthropicKey,
    showOpenaiKey,
    savingAnthropicKey,
    savingOpenaiKey,
    setAnthropicApiKey,
    setOpenaiApiKey,
    setShowAnthropicKey,
    setShowOpenaiKey,
    loadAPIKeys,
    handleSaveAnthropicKey,
    handleSaveOpenaiKey
  }
}
