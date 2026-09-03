import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { buildRelaySource, frameRelayMessage, mintRelayMessageId } from './message.ts'
import type {
  CreateSessionArgs,
  CreateSessionResult,
  DeliveredVia,
  ListSessionsResult,
  SendSessionMessageArgs,
  SendSessionMessageResult,
  SenderIdentity,
  SessionListOptions,
  SessionOrigin,
  SessionRow,
  SessionStatus,
} from './types.ts'
import { SessionMeshError } from './types.ts'

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
  get(sessionId: string): Agent | undefined
  list(): Agent[]
  currentInitiator(): Agent | undefined
  create(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: AgentOptions
    signal?: AbortSignal
    setup?: AgentSetup
  }): Promise<{ agent: Agent }>
  resume(options: {
    resumeSessionId: string
    agentOptions?: AgentOptions
    signal?: AbortSignal
    setup?: AgentSetup
  }): Promise<{ agent: Agent }>
}

interface AgentPresetLike {
  id: string
}

interface AgentPresetsLike {
  resolve(id?: string): Promise<AgentPresetLike>
  mount(agentCtx: Context, id?: string): Promise<AgentPresetLike>
  composedPreset?(agentCtx: Context): string | undefined
}

interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string }
}

interface SessionTitleLike {
  rename(session: Agent['session'], title: string): { title: string }
}

interface WorkspaceIndex {
  bySession: Map<string, WorkspaceLike>
  archived: Set<string>
}

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
}

function includesText(value: string | undefined, needle: string | undefined): boolean {
  return needle === undefined || needle === '' || value?.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) === true
}

function statusForAgent(agent: Agent): SessionStatus {
  return agent.status === 'running' ? 'running' : 'idle'
}

function originFor(header: SessionHeaderLike): SessionOrigin {
  if (header.origin === 'subagent') return 'subagent'
  if (header.cwd !== undefined) return 'user'
  return 'unknown'
}

function resolveRecordedPreset(session: { header: SessionHeaderLike; events: readonly SessionEventLike[] }): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'agent-preset/selected' && typeof (event.data as { agentPreset?: unknown } | undefined)?.agentPreset === 'string') {
      return (event.data as { agentPreset: string }).agentPreset
    }
  }
  return session.header.agentPreset
}

function pageOf(options: SessionListOptions | undefined): { limit: number; offset: number } {
  const rawLimit = options?.limit ?? 20
  const rawOffset = options?.offset ?? 0
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  return { limit, offset }
}

async function requireDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`create_session: cwd must be an absolute path: ${path}`)
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error(`create_session: cwd is not a directory: ${path}`)
  return realpath(path)
}

function isSubagent(agent: Agent): boolean {
  return (agent.session.header as { origin?: string }).origin === 'subagent'
}

export class SessionMeshRuntime {
  private readonly ctx: Context
  private readonly creations = new Map<string, Promise<{ agent: Agent }>>()
  private readonly resumes = new Map<string, Promise<{ agent: Agent }>>()

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  async listSessions(options: SessionListOptions = {}, caller?: Agent, signal?: AbortSignal): Promise<ListSessionsResult> {
    const query = serviceOf<SessionQueryLike>(this.ctx, 'sessionQuery')
    if (query === undefined) throw new Error('list_sessions requires the Host sessionQuery service')
    const workspaces = this.workspaceIndex()
    const liveAgents = new Map(this.agentRegistry().list().map((agent) => [String(agent.id), agent]))
    let rows = (await query.listSessions(signal)).map((record) => this.projectSession(record, workspaces, liveAgents, caller))
    rows = await this.withTitles(rows, query, signal)
    rows = await this.withUpdatedAt(rows, query)
    rows = this.filterRows(rows, options)
    rows = this.sortRows(rows, options)
    const total = rows.length
    const { limit, offset } = pageOf(options)
    const items = rows.slice(offset, offset + limit)
    const nextOffset = offset + items.length < total ? offset + items.length : undefined
    return { items, total, ...(nextOffset === undefined ? {} : { nextOffset }) }
  }

  async currentSession(caller?: Agent, signal?: AbortSignal): Promise<SessionRow> {
    const agent = caller ?? this.agentRegistry().currentInitiator()
    if (agent === undefined) throw new Error('get_current_session requires an agent-owned tool call')
    const result = await this.listSessions({ ids: [String(agent.id)], archived: 'include', includeSelf: true, limit: 1 }, agent, signal)
    const row = result.items[0]
    if (row !== undefined) return row
    const liveAgents = new Map([[String(agent.id), agent]])
    return this.projectSession({ header: agent.session.header, live: true, persisted: false }, this.workspaceIndex(), liveAgents, agent)
  }

  async createSession(args: CreateSessionArgs, caller?: Agent, signal?: AbortSignal): Promise<CreateSessionResult> {
    if (args.cwd !== undefined && args.workspaceId !== undefined) {
      throw new Error('create_session accepts cwd or workspaceId, not both')
    }
    const workspaceRegistry = serviceOf<WorkspaceRegistryLike>(this.ctx, 'workspaceRegistry')
    let workspace: WorkspaceLike | undefined
    let cwd: string
    if (args.workspaceId !== undefined) {
      if (workspaceRegistry === undefined) throw new Error('create_session with workspaceId requires the Host workspaceRegistry service')
      workspace = workspaceRegistry.get(args.workspaceId)
      if (workspace === undefined) throw new Error(`create_session: workspace not found: ${args.workspaceId}`)
      cwd = workspace.path
    } else {
      cwd = await requireDirectory(args.cwd ?? caller?.session.header.cwd ?? process.cwd())
    }
    if (args.title !== undefined && serviceOf<SessionTitleLike>(this.ctx, 'sessionTitle') === undefined) {
      throw new Error('create_session title requires the Host sessionTitle service')
    }
    const sessionId = `session-${randomUUID()}`
    const composition = await this.composeAgent(args.agentPreset)
    const { agent } = await this.createOnce(sessionId, {
      cwd,
      agentPreset: composition.agentPreset,
      agentOptions: this.defaultAgentOptions(caller),
      setup: composition.setup,
      signal,
    })
    if (workspace !== undefined) {
      if (workspace.attachSession === undefined) throw new Error('create_session: workspace does not support attachSession')
      await workspace.attachSession(sessionId)
    }
    let title: string | undefined
    if (args.title !== undefined) {
      const accepted = serviceOf<SessionTitleLike>(this.ctx, 'sessionTitle')!.rename(agent.session, args.title)
      title = accepted.title
    }
    return {
      sessionId,
      status: 'idle',
      created: true,
      cwd,
      ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
      ...(title === undefined ? {} : { title }),
      ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
    }
  }

  async sendSessionMessage(args: SendSessionMessageArgs, caller?: Agent, signal?: AbortSignal): Promise<SendSessionMessageResult> {
    const senderAgent = caller ?? this.agentRegistry().currentInitiator()
    if (senderAgent === undefined) throw new SessionMeshError('delivery-failed', 'send_session_message requires an agent-owned tool call')
    if (String(senderAgent.id) === args.sessionId) {
      throw new SessionMeshError('self-message', 'send_session_message refuses self-message delivery in Work stage')
    }
    const mode = args.mode ?? 'queue'
    const target = await this.resolveTarget(args.sessionId, senderAgent, signal)
    if (target.archived) throw new SessionMeshError('archived-session', `send_session_message refuses archived session ${args.sessionId}`)
    if (target.origin !== 'user') {
      throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${args.sessionId} has origin ${target.origin}`)
    }
    const from = await this.senderIdentity(senderAgent, signal)
    const { agent, resumed } = await this.agentForTarget(target, senderAgent, signal)
    const messageId = mintRelayMessageId()
    const sentAt = new Date().toISOString()
    const source = buildRelaySource({
      messageId,
      from,
      toSessionId: target.sessionId,
      mode,
      sentAt,
      ...(args.inReplyTo === undefined ? {} : { inReplyTo: args.inReplyTo }),
    })
    const text = frameRelayMessage(source, args.message)
    const message = createUserMessage({ content: [{ type: 'text', text }], source })
    let deliveredVia: DeliveredVia
    try {
      if (mode === 'steer') {
        agent.steer(message)
        deliveredVia = resumed ? 'resume-steer' : 'steer'
      } else {
        agent.followup(message)
        deliveredVia = resumed ? 'resume-followup' : 'followup'
      }
    } catch (error) {
      throw new SessionMeshError('delivery-failed', `send_session_message delivery failed for ${target.sessionId}: ${String(error)}`)
    }
    return {
      messageId,
      accepted: true,
      mode,
      to: { ...target, status: statusForAgent(agent) },
      from,
      deliveredVia,
    }
  }

  private async resolveTarget(sessionId: string, caller: Agent, signal?: AbortSignal): Promise<SessionRow> {
    const result = await this.listSessions({ ids: [sessionId], archived: 'include', includeSelf: true, limit: 1 }, caller, signal)
    const target = result.items[0]
    if (target === undefined) throw new SessionMeshError('session-not-found', `send_session_message target not found: ${sessionId}`)
    return target
  }

  private async senderIdentity(agent: Agent, signal?: AbortSignal): Promise<SenderIdentity> {
    const row = await this.currentSession(agent, signal)
    return {
      sessionId: row.sessionId,
      ...(row.title === undefined ? {} : { title: row.title }),
      ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
      ...(row.workspaceId === undefined ? {} : { workspaceId: row.workspaceId }),
      ...(row.workspaceTitle === undefined ? {} : { workspaceTitle: row.workspaceTitle }),
      ...(row.agentPreset === undefined ? {} : { agentPreset: row.agentPreset }),
    }
  }

  private async agentForTarget(target: SessionRow, caller: Agent, signal?: AbortSignal): Promise<{ agent: Agent; resumed: boolean }> {
    const live = this.agentRegistry().get(target.sessionId)
    if (live !== undefined) {
      if (isSubagent(live)) {
        throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${target.sessionId} is a subagent`)
      }
      return { agent: live, resumed: false }
    }
    try {
      const agentPreset = await this.resolvedPresetForSession(target.sessionId, target.agentPreset)
      const { agent } = await this.resumeOnce(target.sessionId, agentPreset, caller, signal)
      if (isSubagent(agent)) {
        throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${target.sessionId} is a subagent`)
      }
      return { agent, resumed: true }
    } catch (error) {
      if (error instanceof SessionMeshError) throw error
      throw new SessionMeshError('resume-failed', `send_session_message could not resume ${target.sessionId}: ${String(error)}`)
    }
  }

  private async resolvedPresetForSession(sessionId: string, fallback: string | undefined): Promise<string | undefined> {
    const query = serviceOf<SessionQueryLike>(this.ctx, 'sessionQuery')
    if (query?.readSession === undefined) return fallback
    try {
      const snapshot = await query.readSession(sessionId)
      return resolveRecordedPreset({ header: snapshot.session, events: snapshot.events })
    } catch {
      return fallback
    }
  }

  private createOnce(sessionId: string, options: { cwd: string; agentPreset?: string; agentOptions?: AgentOptions; setup?: AgentSetup; signal?: AbortSignal }): Promise<{ agent: Agent }> {
    let creation = this.creations.get(sessionId)
    if (creation === undefined) {
      creation = this.agentRegistry().create({
        sessionId: SessionId(sessionId),
        meta: { cwd: options.cwd, ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }) },
        ...(options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions }),
        ...(options.setup === undefined ? {} : { setup: options.setup }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }).finally(() => this.creations.delete(sessionId))
      this.creations.set(sessionId, creation)
    }
    return creation
  }

  private resumeOnce(sessionId: string, agentPreset: string | undefined, caller: Agent, signal?: AbortSignal): Promise<{ agent: Agent }> {
    let resume = this.resumes.get(sessionId)
    if (resume === undefined) {
      resume = (async () => {
        const composition = await this.composeAgent(agentPreset)
        const agentOptions = this.defaultAgentOptions(caller)
        return this.agentRegistry().resume({
          resumeSessionId: SessionId(sessionId),
          ...(agentOptions === undefined ? {} : { agentOptions }),
          ...(composition.setup === undefined ? {} : { setup: composition.setup }),
          ...(signal === undefined ? {} : { signal }),
        })
      })().finally(() => this.resumes.delete(sessionId))
      this.resumes.set(sessionId, resume)
    }
    return resume
  }

  private agentRegistry(): AgentRegistryLike {
    return this.ctx.agents as unknown as AgentRegistryLike
  }

  private defaultAgentOptions(caller?: Agent): AgentOptions | undefined {
    const selected = serviceOf<AgentDefaultModelLike>(this.ctx, 'agentDefaultModel')?.currentSelection()
    if (selected !== undefined) return { provider: selected.provider, model: selected.model }
    if (caller?.options.provider !== undefined && caller.options.model !== undefined) {
      return { provider: caller.options.provider, model: caller.options.model }
    }
    return undefined
  }

  private async composeAgent(agentPreset?: string): Promise<{ agentPreset?: string; setup?: AgentSetup }> {
    const presets = serviceOf<AgentPresetsLike>(this.ctx, 'agentPresets')
    if (presets === undefined) {
      if (agentPreset !== undefined) throw new Error('agentPreset requires the Host agentPresets service')
      return {}
    }
    const resolved = await presets.resolve(agentPreset)
    return {
      agentPreset: resolved.id,
      setup: async (agentCtx) => {
        await presets.mount(agentCtx, resolved.id)
      },
    }
  }

  private workspaceIndex(): WorkspaceIndex {
    const registry = serviceOf<WorkspaceRegistryLike>(this.ctx, 'workspaceRegistry')
    const bySession = new Map<string, WorkspaceLike>()
    if (registry === undefined) return { bySession, archived: new Set() }
    for (const workspace of registry.list()) {
      for (const sessionId of workspace.sessionIds) {
        if (!bySession.has(sessionId)) bySession.set(sessionId, workspace)
      }
    }
    return { bySession, archived: new Set(registry.archivedSessionIds ?? []) }
  }

  private projectSession(record: SessionRecordLike, workspaces: WorkspaceIndex, liveAgents: Map<string, Agent>, caller?: Agent): SessionRow {
    const sessionId = String(record.header.id)
    const liveAgent = liveAgents.get(sessionId)
    const workspace = workspaces.bySession.get(sessionId)
    const preset = liveAgent === undefined
      ? record.header.agentPreset
      : resolveRecordedPreset({ header: liveAgent.session.header, events: liveAgent.session.events as readonly SessionEventLike[] })
        ?? serviceOf<AgentPresetsLike>(this.ctx, 'agentPresets')?.composedPreset?.(liveAgent.ctx)
        ?? record.header.agentPreset
    return {
      sessionId,
      status: liveAgent === undefined ? 'stopped' : statusForAgent(liveAgent),
      origin: originFor(record.header),
      archived: workspaces.archived.has(sessionId),
      self: caller !== undefined && String(caller.id) === sessionId,
      createdAt: record.header.createdAt,
      updatedAt: record.header.createdAt,
      ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
      ...(workspace === undefined ? {} : { workspaceId: workspace.id, workspaceTitle: workspace.title, workspacePath: workspace.path }),
      ...(preset === undefined ? {} : { agentPreset: preset }),
    }
  }

  private async withTitles(rows: SessionRow[], query: SessionQueryLike, signal?: AbortSignal): Promise<SessionRow[]> {
    if (query.readTitleSnapshots === undefined || rows.length === 0) return rows
    const observations = await query.readTitleSnapshots(rows.map((row) => row.sessionId), signal)
    return rows.map((row, index) => {
      const observation = observations[index]
      const title = observation?.status === 'fulfilled' ? observation.value?.title?.title : undefined
      return title === undefined ? row : { ...row, title }
    })
  }

  private async withUpdatedAt(rows: SessionRow[], query: SessionQueryLike): Promise<SessionRow[]> {
    if (query.listEvents === undefined || rows.length === 0) return rows
    return Promise.all(rows.map(async (row) => {
      try {
        const events = await query.listEvents!(row.sessionId)
        const updatedAt = events.reduce((latest, event) => Math.max(latest, event.time), row.createdAt)
        return { ...row, updatedAt }
      } catch {
        return row
      }
    }))
  }

  private filterRows(rows: SessionRow[], options: SessionListOptions): SessionRow[] {
    const ids = options.ids === undefined ? undefined : new Set(options.ids)
    const workspaceIds = options.workspaceIds === undefined ? undefined : new Set(options.workspaceIds)
    const workspacePaths = options.workspacePaths === undefined ? undefined : new Set(options.workspacePaths)
    const statuses = options.statuses === undefined ? undefined : new Set<SessionStatus>(options.statuses)
    const origins = options.origins === undefined ? undefined : new Set<SessionOrigin>(options.origins)
    const archived = options.archived ?? 'exclude'
    const includeSelf = options.includeSelf ?? true
    const query = options.query?.toLocaleLowerCase()
    return rows.filter((row) => {
      if (ids !== undefined && !ids.has(row.sessionId)) return false
      if (workspaceIds !== undefined && (row.workspaceId === undefined || !workspaceIds.has(row.workspaceId))) return false
      if (workspacePaths !== undefined && (row.workspacePath === undefined || !workspacePaths.has(row.workspacePath))) return false
      if (statuses !== undefined && !statuses.has(row.status)) return false
      if (origins !== undefined && !origins.has(row.origin)) return false
      if (archived === 'exclude' && row.archived) return false
      if (archived === 'only' && !row.archived) return false
      if (!includeSelf && row.self) return false
      if (!includesText(row.cwd, options.cwd)) return false
      if (!includesText(row.title, options.title)) return false
      if (query === undefined || query === '') return true
      return [row.sessionId, row.title, row.cwd, row.workspaceId, row.workspaceTitle, row.workspacePath]
        .some((value) => value?.toLocaleLowerCase().includes(query) === true)
    })
  }

  private sortRows(rows: SessionRow[], options: SessionListOptions): SessionRow[] {
    const sort = options.sort ?? { by: 'updatedAt', order: 'desc' }
    const order = sort.order === 'asc' ? 1 : -1
    const valueOf = (row: SessionRow): string | number => {
      switch (sort.by) {
        case 'createdAt': return row.createdAt
        case 'title': return row.title ?? row.sessionId
        case 'cwd': return row.cwd ?? ''
        case 'workspace': return row.workspaceTitle ?? row.workspacePath ?? row.workspaceId ?? ''
        case 'updatedAt':
        default: return row.updatedAt ?? row.createdAt
      }
    }
    return [...rows].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      const primary = typeof av === 'number' && typeof bv === 'number'
        ? av === bv ? 0 : av < bv ? -1 : 1
        : String(av).localeCompare(String(bv))
      if (primary !== 0) return primary * order
      return (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || a.sessionId.localeCompare(b.sessionId)
    })
  }
}
