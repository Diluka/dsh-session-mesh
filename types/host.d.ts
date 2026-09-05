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
    threadId: string
    from: SenderIdentity
    to: { sessionId: string }
    mode: SendSessionMode
    sentAt: string
    inReplyTo?: string
  }

  interface SendSessionMessageArgs {
    sessionId: string
    message: string
    summary?: string
    mode?: SendSessionMode
    expectReply?: boolean
    inReplyTo?: string
    threadId?: string
  }

  interface RelayThreadMessage {
    seq: number
    threadId: string
    messageId: string
    sentAt: string
    from: SenderIdentity
    to: { sessionId: string }
    mode: SendSessionMode
    deliveredVia: DeliveredVia
    inReplyTo?: string
    expectReply?: boolean
    summary?: string
  }

  interface RelayThreadManifest {
    version: 1
    threadId: string
    pageSize: number
    messageCount: number
    createdAt: string
    updatedAt: string
    latestSeq: number
  }

  interface RelayThreadPage {
    version: 1
    threadId: string
    page: number
    startSeq: number
    messages: RelayThreadMessage[]
  }

  interface RelayThreadAppendInput {
    threadId: string
    messageId: string
    sentAt: string
    from: SenderIdentity
    to: { sessionId: string }
    mode: SendSessionMode
    deliveredVia: DeliveredVia
    summary?: string
    inReplyTo?: string
    expectReply?: boolean
  }

  interface GetSessionThreadArgs {
    threadId: string
    limit?: number
  }

  interface GetSessionThreadResult {
    threadId: string
    messages: RelayThreadMessage[]
    count: number
    total: number
    latestSeq?: number
  }

  interface RelayThreadStoreLike {
    append(input: RelayThreadAppendInput): Promise<void>
    readThread(args: GetSessionThreadArgs): Promise<GetSessionThreadResult>
  }

  interface RelayThreadStoreOptions {
    root?: string
    pageSize?: number
    maxReadLimit?: number
  }

  interface SessionMeshRuntimeOptions {
    threadStore?: RelayThreadStoreLike
    threadStoreOptions?: RelayThreadStoreOptions
  }

  interface SendSessionMessageResult {
    messageId: string
    threadId: string
    accepted: true
    mode: SendSessionMode
    to: SessionRow
    from: SenderIdentity
    deliveredVia: DeliveredVia
    threadIndexed: boolean
    threadIndexError?: string
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

  interface SessionTitleObservationResultLike {
    status: 'fulfilled' | 'rejected'
    value?: { title?: { title?: string } }
  }

  interface SessionQueryLike {
    listSessions(signal?: AbortSignal): Promise<SessionRecordLike[]>
    readTitleSnapshots?(sessionIds: readonly string[], signal?: AbortSignal): Promise<SessionTitleObservationResultLike[]>
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
