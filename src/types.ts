export type SessionStatus = 'running' | 'idle' | 'stopped'
export type SessionOrigin = 'user' | 'subagent' | 'unknown'
export type SessionArchiveFilter = 'exclude' | 'include' | 'only'
export type SessionSortKey = 'createdAt' | 'updatedAt' | 'title' | 'cwd' | 'workspace'
export type SendSessionMode = 'queue' | 'steer'
export type DeliveredVia = 'followup' | 'steer' | 'resume-followup' | 'resume-steer'

export interface SessionSortOptions {
  by?: SessionSortKey
  order?: 'asc' | 'desc'
}

export interface SessionListOptions {
  query?: string
  ids?: string[]
  workspaceIds?: string[]
  workspacePaths?: string[]
  cwd?: string
  title?: string
  statuses?: SessionStatus[]
  origins?: SessionOrigin[]
  archived?: SessionArchiveFilter
  includeSelf?: boolean
  limit?: number
  offset?: number
  sort?: SessionSortOptions
}

export interface ListSessionsArgs {
  sessions?: SessionListOptions
}

export interface SessionRow {
  sessionId: string
  status: SessionStatus
  origin: SessionOrigin
  archived: boolean
  self: boolean
  createdAt: number
  updatedAt?: number
  cwd?: string
  title?: string
  workspaceId?: string
  workspaceTitle?: string
  workspacePath?: string
  agentPreset?: string
}

export interface ListSessionsResult {
  items: SessionRow[]
  total?: number
  nextOffset?: number
}

export interface GetCurrentSessionResult {
  session: SessionRow
}

export interface CreateSessionArgs {
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
}

export interface CreateSessionResult {
  sessionId: string
  status: 'stopped' | 'idle'
  created: true
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
}

export interface SenderIdentity {
  sessionId: string
  title?: string
  cwd?: string
  workspaceId?: string
  workspaceTitle?: string
  agentPreset?: string
}

export interface AgentRelaySource {
  kind: 'agent-relay'
  form: 'relay'
  transport: 'session.prompt'
  messageId: string
  from: SenderIdentity
  to: { sessionId: string }
  mode: SendSessionMode
  sentAt: string
  inReplyTo?: string
  threadId?: string
}

export interface SendSessionMessageArgs {
  sessionId: string
  message: string
  summary?: string
  mode?: SendSessionMode
  expectReply?: boolean
  inReplyTo?: string
}

export interface SendSessionMessageResult {
  messageId: string
  accepted: true
  mode: SendSessionMode
  to: SessionRow
  from: SenderIdentity
  deliveredVia: DeliveredVia
}

export type SendSessionMessageErrorCode =
  | 'session-not-found'
  | 'archived-session'
  | 'self-message'
  | 'resume-failed'
  | 'delivery-failed'
  | 'unsupported-origin'

export class SessionMeshError extends Error {
  readonly code: SendSessionMessageErrorCode

  constructor(code: SendSessionMessageErrorCode, message: string) {
    super(message)
    this.name = 'SessionMeshError'
    this.code = code
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-relay': AgentRelaySource
  }
}
