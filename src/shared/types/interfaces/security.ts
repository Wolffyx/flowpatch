export type ExecutionOrigin =
  | 'user_action'
  | 'worker_pipeline'
  | 'ipc_request'
  | 'ai_output'
  | 'external'

export interface SecurityContext {
  webContentsId: number
  frameUrl: string
  isTrusted: boolean
  timestamp: number
  nonce: string
}

export interface SignedRequest<T = unknown> {
  payload: T
  signature: string
  nonce: string
  timestamp: number
  senderId?: number
}

export interface SecurityVerificationResult {
  valid: boolean
  error?: string
  context?: SecurityContext
}

export interface SecureCommandRequest {
  command: string
  args: string[]
  cwd: string
  securityContext: SecurityContext
  policyApproved: boolean
}

export interface SecurityAuditEntry {
  type: 'ipc_request' | 'command_execution' | 'security_violation' | 'origin_rejected'
  timestamp: string
  webContentsId?: number
  details: Record<string, unknown>
  allowed: boolean
  rejectionReason?: string
}

export interface SecurityConfig {
  enforceOriginCheck: boolean
  requireSignatures: boolean
  maxRequestAgeMs: number
  enableAuditLog: boolean
  securedChannels: string[]
}

export interface CommandGuardConfig {
  allowedCommands: string[]
  forbiddenPaths: string[]
  allowNetwork: boolean
  maxMinutes: number
}
