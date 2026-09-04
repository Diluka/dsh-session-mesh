import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare global {
  type CordisContext = Context
  type DshAgent = Agent
  type DshAgentOptions = AgentOptions
  type DshAgentSetup = AgentSetup
  type DshToolDefinition = ToolDefinition
  type DshToolRunContext = ToolRunContext
  type DshJsonValue = JsonValue

  type SessionStatus = 'running' | 'idle' | 'stopped'
  type SessionOrigin = 'user' | 'subagent' | 'unknown'
  type SessionArchiveFilter = 'exclude' | 'include' | 'only'
  type SessionSortKey = 'createdAt' | 'updatedAt' | 'title' | 'cwd' | 'workspace'
  type SendSessionMode = 'queue' | 'steer'
  type DeliveredVia = 'followup' | 'steer' | 'resume-followup' | 'resume-steer'
  type SendSessionMessageErrorCode =
    | 'session-not-found'
    | 'archived-session'
    | 'self-message'
    | 'resume-failed'
    | 'delivery-failed'
    | 'unsupported-origin'

  interface SessionSortOptions {
    by?: SessionSortKey
    order?: 'asc' | 'desc'
  }

  interface SessionListOptions {
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

  interface ListSessionsArgs {
    sessions?: SessionListOptions
  }

  interface SessionRow {
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

  interface ListSessionsResult {
    items: SessionRow[]
    total?: number
    nextOffset?: number
  }

  interface GetCurrentSessionResult {
    session: SessionRow
  }

  interface CreateSessionArgs {
    cwd?: string
    workspaceId?: string
    title?: string
    agentPreset?: string
  }

  interface CreateSessionResult {
    sessionId: string
    status: 'stopped' | 'idle'
    created: true
    cwd?: string
    workspaceId?: string
    title?: string
    agentPreset?: string
  }

  interface SenderIdentity {
    sessionId: string
    title?: string
    cwd?: string
    workspaceId?: string
    workspaceTitle?: string
    agentPreset?: string
  }

  interface RelayEnvelopeData {
    transport: 'session.prompt'
    messageId: string
    from: SenderIdentity
    to: { sessionId: string }
    mode: SendSessionMode
    sentAt: string
    inReplyTo?: string
    threadId?: string
  }

  interface SendSessionMessageArgs {
    sessionId: string
    message: string
    summary?: string
    mode?: SendSessionMode
    expectReply?: boolean
    inReplyTo?: string
  }

  interface SendSessionMessageResult {
    messageId: string
    accepted: true
    mode: SendSessionMode
    to: SessionRow
    from: SenderIdentity
    deliveredVia: DeliveredVia
  }

  interface SessionHeaderLike {
    id: string
    createdAt: number
    cwd?: string
    parentSession?: string
    origin?: 'subagent'
    agentPreset?: string
  }

  interface SessionRecordLike {
    header: SessionHeaderLike
    live: boolean
    persisted: boolean
  }

  interface SessionEventRecordLike {
    time: number
  }

  interface SessionEventLike {
    type: string
    data?: unknown
  }

  interface SessionLogSnapshotLike {
    session: SessionHeaderLike
    events: readonly SessionEventLike[]
  }

  interface SessionTitleObservationResultLike {
    status: 'fulfilled' | 'rejected'
    value?: { title?: { title?: string } }
  }

  interface SessionQueryLike {
    listSessions(signal?: AbortSignal): Promise<SessionRecordLike[]>
    readSession?(sessionId: string): Promise<SessionLogSnapshotLike>
    readTitleSnapshots?(sessionIds: readonly string[], signal?: AbortSignal): Promise<SessionTitleObservationResultLike[]>
    listEvents?(sessionId: string): Promise<SessionEventRecordLike[]>
  }

  interface WorkspaceLike {
    id: string
    path: string
    title: string
    sessionIds: readonly string[]
    attachSession?(sessionId: string): Promise<void>
  }

  interface WorkspaceRegistryLike {
    get(id: string): WorkspaceLike | undefined
    list(): WorkspaceLike[]
    readonly archivedSessionIds?: readonly string[]
  }

  interface AgentRegistryLike {
    get(sessionId: string): DshAgent | undefined
    list(): DshAgent[]
    currentInitiator(): DshAgent | undefined
    create(options: {
      sessionId: string
      meta?: { cwd?: string; agentPreset?: string }
      agentOptions?: DshAgentOptions
      signal?: AbortSignal
      setup?: DshAgentSetup
    }): Promise<{ agent: DshAgent }>
    resume(options: {
      resumeSessionId: string
      agentOptions?: DshAgentOptions
      signal?: AbortSignal
      setup?: DshAgentSetup
    }): Promise<{ agent: DshAgent }>
  }

  interface AgentPresetLike {
    id: string
  }

  interface AgentPresetsLike {
    resolve(id?: string): Promise<AgentPresetLike>
    mount(agentCtx: CordisContext, id?: string): Promise<AgentPresetLike>
    composedPreset?(agentCtx: CordisContext): string | undefined
  }

  interface AgentDefaultModelLike {
    currentSelection(): { provider: string; model: string }
  }

  interface SessionTitleLike {
    rename(session: DshAgent['session'], title: string): { title: string }
  }

  interface WorkspaceIndex {
    bySession: Map<string, WorkspaceLike>
    archived: Set<string>
  }

  interface SessionMeshHostContext {
    get(name: string): unknown
    tools: { register(definition: DshToolDefinition): () => void }
    agents: AgentRegistryLike
  }
}

export {}
