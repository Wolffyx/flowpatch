/**
 * Provider Switch Configuration
 *
 * Configures automatic switching between AI providers when limits are reached.
 */

/**
 * How to handle when a provider hits its limits mid-execution.
 * - 'automatic': Switch to next available provider without user intervention
 * - 'approval': Pause and ask user to approve the provider switch
 * - 'disabled': Don't switch providers, fail immediately
 */
export type ProviderSwitchMode = 'automatic' | 'approval' | 'disabled'

/**
 * What to do when all providers are exhausted.
 * - 'pause_and_wait': Pause and periodically check if limits have reset
 * - 'fail_immediately': Fail the job immediately
 * - 'queue_for_later': Mark job for retry and move to next card
 */
export type ExhaustedBehavior = 'pause_and_wait' | 'fail_immediately' | 'queue_for_later'

/**
 * Configuration for automatic provider switching.
 */
export interface ProviderSwitchConfig {
  /** How to handle mid-execution limit hits. Default: 'automatic' */
  mode: ProviderSwitchMode

  /** What to do when ALL providers are exhausted. Default: 'pause_and_wait' */
  exhaustedBehavior: ExhaustedBehavior

  /** Minutes to wait before retrying (for pause_and_wait). Default: 5 */
  retryIntervalMinutes: number

  /** Maximum total wait time in minutes before giving up. Default: 60 */
  maxWaitMinutes: number

  /** Show notification when provider switch occurs. Default: true */
  notifyOnSwitch: boolean
}

/**
 * Default provider switch configuration.
 */
export const DEFAULT_PROVIDER_SWITCH_CONFIG: ProviderSwitchConfig = {
  mode: 'automatic',
  exhaustedBehavior: 'pause_and_wait',
  retryIntervalMinutes: 5,
  maxWaitMinutes: 60,
  notifyOnSwitch: true
}
