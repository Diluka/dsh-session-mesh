export type SessionStatus = 'running' | 'idle' | 'stopped'
export type SessionOrigin = 'user' | 'subagent' | 'unknown'
export type SessionArchiveFilter = 'exclude' | 'include' | 'only'
export type SessionSortKey = 'createdAt' | 'updatedAt' | 'title' | 'cwd' | 'workspace'

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
