/**
 * Worker System Constants
 *
 * Centralized constants for magic numbers and configuration values.
 * All timing values are in milliseconds unless otherwise noted.
 */

// ============================================================================
// Pipeline & Worker Constants
// ============================================================================

/** Default lease renewal interval (ms) */
export const DEFAULT_LEASE_RENEWAL_MS = 60_000

/** Default pipeline timeout (ms) - 30 minutes */
export const DEFAULT_PIPELINE_TIMEOUT_MS = 30 * 60 * 1000

/** Default worker max minutes */
export const DEFAULT_WORKER_MAX_MINUTES = 25

/** AI process timeout (ms) - 20 minutes */
export const AI_PROCESS_TIMEOUT_MS = 20 * 60 * 1000

/** Default job retry cooldown (minutes) */
export const DEFAULT_RETRY_COOLDOWN_MINUTES = 30

// ============================================================================
// Polling & Interval Constants
// ============================================================================

/** Minimum poll interval for adaptive polling (ms) */
export const MIN_POLL_INTERVAL_MS = 1_000

/** Maximum poll interval for adaptive polling (ms) */
export const MAX_POLL_INTERVAL_MS = 60_000

/** Default poll interval (ms) */
export const DEFAULT_POLL_INTERVAL_MS = 30_000

/** Cancellation check interval (ms) */
export const CANCELLATION_CHECK_INTERVAL_MS = 500

/** Optimized cancellation check interval when process is running (ms) */
export const CANCELLATION_CHECK_RUNNING_INTERVAL_MS = 1_000

/** Nonce cleanup interval (ms) - 5 minutes */
export const NONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/** Lock renewal interval (ms) - 5 minutes */
export const LOCK_RENEWAL_INTERVAL_MS = 5 * 60 * 1000

// ============================================================================
// Cache Constants
// ============================================================================

/** Command cache TTL (ms) - 5 minutes */
export const COMMAND_CACHE_TTL_MS = 5 * 60 * 1000

/** AI tools cache TTL (ms) - 5 minutes */
export const AI_TOOLS_CACHE_TTL_MS = 5 * 60 * 1000

/** Git version cache TTL (ms) - 1 hour */
export const GIT_VERSION_CACHE_TTL_MS = 60 * 60 * 1000

/** Policy cache TTL (ms) - 5 minutes */
export const POLICY_CACHE_TTL_MS = 5 * 60 * 1000

/** Validation cache TTL (ms) - 1 minute */
export const VALIDATION_CACHE_TTL_MS = 60 * 1000

/** API response cache TTL (ms) - 2 minutes */
export const API_CACHE_TTL_MS = 2 * 60 * 1000

/** Query result cache TTL (ms) - 30 seconds */
export const QUERY_CACHE_TTL_MS = 30 * 1000

// ============================================================================
// Collection Size Limits
// ============================================================================

/** Maximum audit log entries */
export const MAX_AUDIT_LOG_SIZE = 1000

/** Maximum command audit log entries */
export const MAX_COMMAND_AUDIT_LOG_SIZE = 500

/** Maximum used nonces to track */
export const MAX_USED_NONCES = 10_000

/** Maximum cached policies */
export const MAX_POLICY_CACHE_SIZE = 100

/** Maximum cached validations */
export const MAX_VALIDATION_CACHE_SIZE = 500

/** Maximum active workers per pool */
export const MAX_ACTIVE_WORKERS = 8

/** Maximum worker logs per job */
export const MAX_WORKER_LOGS_PER_JOB = 1000

/** Maximum shell logs */
export const MAX_SHELL_LOGS = 500

/** Maximum error aggregation entries */
export const MAX_ERROR_AGGREGATION_ENTRIES = 100

/** Maximum API cache entries */
export const MAX_API_CACHE_SIZE = 200

/** Maximum query cache entries */
export const MAX_QUERY_CACHE_SIZE = 100

// ============================================================================
// Retry Constants
// ============================================================================

/** Default max retry attempts */
export const DEFAULT_MAX_RETRIES = 3

/** Default initial retry delay (ms) */
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000

/** Default max retry delay (ms) */
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000

/** Default retry backoff multiplier */
export const DEFAULT_BACKOFF_MULTIPLIER = 2

/** Git operation retry attempts */
export const GIT_RETRY_ATTEMPTS = 3

/** API request retry attempts */
export const API_RETRY_ATTEMPTS = 3

// ============================================================================
// Rate Limiting Constants
// ============================================================================

/** Default rate limit requests per second */
export const DEFAULT_RATE_LIMIT_RPS = 10

/** GitHub API rate limit (requests per hour for authenticated users) */
export const GITHUB_API_RATE_LIMIT_HOUR = 5000

/** GitLab API rate limit (requests per minute) */
export const GITLAB_API_RATE_LIMIT_MINUTE = 300

/** API request batch size */
export const API_BATCH_SIZE = 10

// ============================================================================
// Concurrency Constants
// ============================================================================

/** Default semaphore permits */
export const DEFAULT_SEMAPHORE_PERMITS = 5

/** Git operation concurrency limit */
export const GIT_CONCURRENCY_LIMIT = 3

/** API request concurrency limit */
export const API_CONCURRENCY_LIMIT = 5

// ============================================================================
// Process Constants
// ============================================================================

/** Process kill timeout after SIGTERM (ms) */
export const PROCESS_KILL_TIMEOUT_MS = 2_000

/** Process tail lines to keep for error messages */
export const PROCESS_TAIL_LINES = 40

// ============================================================================
// Adaptive Polling Constants
// ============================================================================

/** Backoff multiplier for adaptive polling */
export const ADAPTIVE_POLL_BACKOFF_MULTIPLIER = 1.5

/** Maximum consecutive empty polls before max backoff */
export const MAX_CONSECUTIVE_EMPTY_POLLS = 10

// ============================================================================
// Security Constants
// ============================================================================

/** Maximum request age for signature validation (ms) */
export const MAX_REQUEST_AGE_MS = 30_000

/** Session token bytes */
export const SESSION_TOKEN_BYTES = 32

// ============================================================================
// Health Check Constants
// ============================================================================

/** Health check interval (ms) - 30 seconds */
export const HEALTH_CHECK_INTERVAL_MS = 30_000

/** Health check timeout (ms) */
export const HEALTH_CHECK_TIMEOUT_MS = 5_000

// ============================================================================
// Metrics Constants
// ============================================================================

/** Metrics flush interval (ms) - 1 minute */
export const METRICS_FLUSH_INTERVAL_MS = 60_000

/** Maximum metrics history entries */
export const MAX_METRICS_HISTORY = 1000
