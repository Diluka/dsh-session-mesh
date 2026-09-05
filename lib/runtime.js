/// <reference path="../types/host.d.ts" />

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { buildRelayEnvelopeData, frameRelayMessage, mintRelayMessageId } from './message.js'
import { RelayThreadStore, assertRelayIdentifier, mintThreadId } from './thread-store.js'
import { SessionMeshError } from './types.js'

/**
 * @param {{ get(name: string): unknown }} ctx
 * @param {string} name
 * @returns {unknown | undefined}
 */
function serviceOf(ctx, name) {
  return ctx.get(name)
}

/**
 * @param {string | undefined} value
 * @param {string | undefined} needle
 * @returns {boolean}
 */
function includesText(value, needle) {
  return needle === undefined || needle === '' || value?.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) === true
}

/**
 * @param {DshAgent} agent
 * @returns {SessionStatus}
 */
function statusForAgent(agent) {
  return agent.status === 'running' ? 'running' : 'idle'
}

/**
 * @param {SessionHeaderLike} header
 * @returns {SessionOrigin}
 */
function originFor(header) {
  if (header.origin === 'subagent') return 'subagent'
  if (header.cwd !== undefined) return 'user'
  return 'unknown'
}

/**
 * @param {SessionListOptions | undefined} options
 * @returns {{ limit: number, offset: number }}
 */
function pageOf(options) {
  const rawLimit = options?.limit ?? 20
  const rawOffset = options?.offset ?? 0
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  return { limit, offset }
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function requireDirectory(path) {
  if (!isAbsolute(path)) throw new Error(`create_session: cwd must be an absolute path: ${path}`)
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error(`create_session: cwd is not a directory: ${path}`)
  return realpath(path)
}

/**
 * @param {DshAgent} agent
 * @returns {boolean}
 */
function isSubagent(agent) {
  return /** @type {{ origin?: string }} */ (agent.session.header).origin === 'subagent'
}

/** @type {{ readonly kind: 'plugin', readonly plugin: 'dsh-session-mesh' }} */
const relayMessageSource = { kind: 'plugin', plugin: 'dsh-session-mesh' }

export class SessionMeshRuntime {
  /** @type {SessionMeshHostContext} */
  ctx

  /** @type {Map<string, Promise<{ agent: DshAgent }>>} */
  creations = new Map()

  /** @type {Map<string, Promise<{ agent: DshAgent }>>} */
  resumes = new Map()

  /** @type {RelayThreadStoreLike} */
  threadStore

  /**
   * @param {SessionMeshHostContext} ctx
   * @param {SessionMeshRuntimeOptions} [options]
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx
    this.threadStore = options.threadStore ?? new RelayThreadStore(options.threadStoreOptions)
  }

  /**
   * @param {SessionListOptions} [options]
   * @param {DshAgent} [caller]
   * @param {AbortSignal} [signal]
   * @returns {Promise<ListSessionsResult>}
   */
  async listSessions(options = {}, caller, signal) {
    const query = /** @type {SessionQueryLike | undefined} */ (serviceOf(this.ctx, 'sessionQuery'))
    if (query === undefined) throw new Error('list_sessions requires the Host sessionQuery service')
    const workspaces = this.workspaceIndex()
    const liveAgents = new Map(this.agentRegistry().list().map((agent) => [String(agent.id), agent]))
    let records = await query.listSessions(signal)
    if (options.ids !== undefined) {
      const ids = new Set(options.ids)
      records = records.filter((record) => ids.has(String(record.header.id)))
    }
    let rows = records.map((record) => this.projectSession(record, workspaces, liveAgents, caller))
    const needsFullTitleScan = options.title !== undefined || options.query !== undefined || options.sort?.by === 'title'
    if (needsFullTitleScan) rows = await this.withTitles(rows, query, signal)
    rows = this.filterRows(rows, options)
    rows = this.sortRows(rows, options)
    const total = rows.length
    const { limit, offset } = pageOf(options)
    const page = rows.slice(offset, offset + limit)
    const items = needsFullTitleScan ? page : await this.withTitles(page, query, signal)
    const nextOffset = offset + items.length < total ? offset + items.length : undefined
    return { items, total, ...(nextOffset === undefined ? {} : { nextOffset }) }
  }

  /**
   * @param {DshAgent} [caller]
   * @param {AbortSignal} [signal]
   * @returns {Promise<SessionRow>}
   */
  async currentSession(caller, signal) {
    const agent = caller ?? this.agentRegistry().currentInitiator()
    if (agent === undefined) throw new Error('current session identity requires an agent-owned tool call')
    const sessionId = String(agent.id)
    return this.projectSession(
      { header: /** @type {SessionHeaderLike} */ (agent.session.header), live: true, persisted: false },
      this.workspaceIndex(),
      new Map([[sessionId, agent]]),
      agent,
    )
  }

  /**
   * @param {CreateSessionArgs} args
   * @param {DshAgent} [caller]
   * @param {AbortSignal} [signal]
   * @returns {Promise<CreateSessionResult>}
   */
  async createSession(args, caller, signal) {
    if (args.cwd !== undefined && args.workspaceId !== undefined) {
      throw new Error('create_session accepts cwd or workspaceId, not both')
    }
    const workspaceRegistry = /** @type {WorkspaceRegistryLike | undefined} */ (serviceOf(this.ctx, 'workspaceRegistry'))
    /** @type {WorkspaceLike | undefined} */
    let workspace
    /** @type {string} */
    let cwd
    if (args.workspaceId !== undefined) {
      if (workspaceRegistry === undefined) throw new Error('create_session with workspaceId requires the Host workspaceRegistry service')
      workspace = workspaceRegistry.get(args.workspaceId)
      if (workspace === undefined) throw new Error(`create_session: workspace not found: ${args.workspaceId}`)
      cwd = workspace.path
    } else {
      cwd = await requireDirectory(args.cwd ?? caller?.session.header.cwd ?? process.cwd())
    }
    if (args.title !== undefined && /** @type {SessionTitleLike | undefined} */ (serviceOf(this.ctx, 'sessionTitle')) === undefined) {
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
    /** @type {string | undefined} */
    let title
    if (args.title !== undefined) {
      const titleService = /** @type {SessionTitleLike} */ (serviceOf(this.ctx, 'sessionTitle'))
      const accepted = titleService.rename(agent.session, args.title)
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

  /**
   * @param {SendSessionMessageArgs} args
   * @param {DshAgent} [caller]
   * @param {AbortSignal} [signal]
   * @returns {Promise<SendSessionMessageResult>}
   */
  async sendSessionMessage(args, caller, signal) {
    const senderAgent = caller ?? this.agentRegistry().currentInitiator()
    if (senderAgent === undefined) throw new SessionMeshError('delivery-failed', 'send_session_message requires an agent-owned tool call')
    if (String(senderAgent.id) === args.sessionId) {
      throw new SessionMeshError('self-message', 'send_session_message refuses self-message delivery in Work stage')
    }
    const mode = args.mode ?? 'queue'
    const threadId = args.threadId === undefined ? mintThreadId() : assertRelayIdentifier(args.threadId, 'send_session_message: threadId')
    const inReplyTo = args.inReplyTo === undefined ? undefined : assertRelayIdentifier(args.inReplyTo, 'send_session_message: inReplyTo')
    const target = await this.resolveTarget(args.sessionId, senderAgent, signal)
    if (target.archived) throw new SessionMeshError('archived-session', `send_session_message refuses archived session ${args.sessionId}`)
    if (target.origin !== 'user') {
      throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${args.sessionId} has origin ${target.origin}`)
    }
    const from = await this.senderIdentity(senderAgent, signal)
    const { agent, resumed } = await this.agentForTarget(target, senderAgent, signal)
    const messageId = mintRelayMessageId()
    const sentAt = new Date().toISOString()
    const envelope = buildRelayEnvelopeData({
      messageId,
      from,
      toSessionId: target.sessionId,
      mode,
      sentAt,
      threadId,
      ...(inReplyTo === undefined ? {} : { inReplyTo }),
    })
    const text = frameRelayMessage(envelope, args.message)
    const message = createUserMessage({ content: [{ type: 'text', text }], source: relayMessageSource })
    /** @type {DeliveredVia} */
    let deliveredVia
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
    /** @type {string | undefined} */
    let threadIndexError
    try {
      await this.threadStore.append({
        threadId,
        messageId,
        sentAt,
        from,
        to: { sessionId: target.sessionId },
        mode,
        deliveredVia,
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(inReplyTo === undefined ? {} : { inReplyTo }),
        ...(args.expectReply === undefined ? {} : { expectReply: args.expectReply }),
      })
    } catch (error) {
      threadIndexError = error instanceof Error ? error.message : String(error)
    }
    return {
      messageId,
      threadId,
      accepted: true,
      mode,
      to: { ...target, status: statusForAgent(agent) },
      from,
      deliveredVia,
      threadIndexed: threadIndexError === undefined,
      ...(threadIndexError === undefined ? {} : { threadIndexError }),
    }
  }

  /**
   * @param {GetSessionThreadArgs} args
   * @returns {Promise<GetSessionThreadResult>}
   */
  getSessionThread(args) {
    return this.threadStore.readThread(args)
  }

  /**
   * @private
   * @param {string} sessionId
   * @param {DshAgent} [caller]
   * @param {AbortSignal} [signal]
   * @returns {Promise<SessionRow | undefined>}
   */
  async sessionById(sessionId, caller, signal) {
    const live = this.agentRegistry().get(sessionId)
    const workspaces = this.workspaceIndex()
    if (live !== undefined) {
      return this.projectSession(
        { header: /** @type {SessionHeaderLike} */ (live.session.header), live: true, persisted: false },
        workspaces,
        new Map([[sessionId, live]]),
        caller,
      )
    }
    const query = /** @type {SessionQueryLike | undefined} */ (serviceOf(this.ctx, 'sessionQuery'))
    if (query === undefined) return undefined
    const records = await query.listSessions(signal)
    const record = records.find((entry) => String(entry.header.id) === sessionId)
    return record === undefined ? undefined : this.projectSession(record, workspaces, new Map(), caller)
  }

  /**
   * @private
   * @param {string} sessionId
   * @param {DshAgent} caller
   * @param {AbortSignal} [signal]
   * @returns {Promise<SessionRow>}
   */
  async resolveTarget(sessionId, caller, signal) {
    const target = await this.sessionById(sessionId, caller, signal)
    if (target === undefined) throw new SessionMeshError('session-not-found', `send_session_message target not found: ${sessionId}`)
    return target
  }

  /**
   * @private
   * @param {DshAgent} agent
   * @param {AbortSignal} [signal]
   * @returns {Promise<SenderIdentity>}
   */
  async senderIdentity(agent, signal) {
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

  /**
   * @private
   * @param {SessionRow} target
   * @param {DshAgent} caller
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ agent: DshAgent, resumed: boolean }>}
   */
  async agentForTarget(target, caller, signal) {
    const live = this.agentRegistry().get(target.sessionId)
    if (live !== undefined) {
      if (isSubagent(live)) {
        throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${target.sessionId} is a subagent`)
      }
      return { agent: live, resumed: false }
    }
    try {
      const { agent } = await this.resumeOnce(target.sessionId, target.agentPreset, caller, signal)
      if (isSubagent(agent)) {
        throw new SessionMeshError('unsupported-origin', `send_session_message supports ordinary sessions only; ${target.sessionId} is a subagent`)
      }
      return { agent, resumed: true }
    } catch (error) {
      if (error instanceof SessionMeshError) throw error
      throw new SessionMeshError('resume-failed', `send_session_message could not resume ${target.sessionId}: ${String(error)}`)
    }
  }

  /**
   * @private
   * @param {string} sessionId
   * @param {{ cwd: string, agentPreset?: string, agentOptions?: DshAgentOptions, setup?: DshAgentSetup, signal?: AbortSignal }} options
   * @returns {Promise<{ agent: DshAgent }>}
   */
  createOnce(sessionId, options) {
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

  /**
   * @private
   * @param {string} sessionId
   * @param {string | undefined} agentPreset
   * @param {DshAgent} caller
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ agent: DshAgent }>}
   */
  resumeOnce(sessionId, agentPreset, caller, signal) {
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

  /**
   * @private
   * @returns {AgentRegistryLike}
   */
  agentRegistry() {
    return this.ctx.agents
  }

  /**
   * @private
   * @param {DshAgent} [caller]
   * @returns {DshAgentOptions | undefined}
   */
  defaultAgentOptions(caller) {
    const selected = /** @type {AgentDefaultModelLike | undefined} */ (serviceOf(this.ctx, 'agentDefaultModel'))?.currentSelection()
    if (selected !== undefined) return { provider: selected.provider, model: selected.model }
    if (caller?.options.provider !== undefined && caller.options.model !== undefined) {
      return { provider: caller.options.provider, model: caller.options.model }
    }
    return undefined
  }

  /**
   * @private
   * @param {string | undefined} [agentPreset]
   * @returns {Promise<{ agentPreset?: string, setup?: DshAgentSetup }>}
   */
  async composeAgent(agentPreset) {
    const presets = /** @type {AgentPresetsLike | undefined} */ (serviceOf(this.ctx, 'agentPresets'))
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

  /**
   * @private
   * @returns {WorkspaceIndex}
   */
  workspaceIndex() {
    const registry = /** @type {WorkspaceRegistryLike | undefined} */ (serviceOf(this.ctx, 'workspaceRegistry'))
    const bySession = new Map()
    if (registry === undefined) return { bySession, archived: new Set() }
    for (const workspace of registry.list()) {
      for (const sessionId of workspace.sessionIds) {
        if (!bySession.has(sessionId)) bySession.set(sessionId, workspace)
      }
    }
    return { bySession, archived: new Set(registry.archivedSessionIds ?? []) }
  }

  /**
   * @private
   * @param {SessionRecordLike} record
   * @param {WorkspaceIndex} workspaces
   * @param {Map<string, DshAgent>} liveAgents
   * @param {DshAgent} [caller]
   * @returns {SessionRow}
   */
  projectSession(record, workspaces, liveAgents, caller) {
    const sessionId = String(record.header.id)
    const liveAgent = liveAgents.get(sessionId)
    const workspace = workspaces.bySession.get(sessionId)
    const preset = liveAgent === undefined
      ? record.header.agentPreset
      : /** @type {AgentPresetsLike | undefined} */ (serviceOf(this.ctx, 'agentPresets'))?.composedPreset?.(liveAgent.ctx)
        ?? record.header.agentPreset
    return {
      sessionId,
      status: liveAgent === undefined ? 'stopped' : statusForAgent(liveAgent),
      origin: originFor(record.header),
      archived: workspaces.archived.has(sessionId),
      self: caller !== undefined && String(caller.id) === sessionId,
      createdAt: record.header.createdAt,
      ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
      ...(workspace === undefined ? {} : { workspaceId: workspace.id, workspaceTitle: workspace.title, workspacePath: workspace.path }),
      ...(preset === undefined ? {} : { agentPreset: preset }),
    }
  }

  /**
   * @private
   * @param {SessionRow[]} rows
   * @param {SessionQueryLike} query
   * @param {AbortSignal} [signal]
   * @returns {Promise<SessionRow[]>}
   */
  async withTitles(rows, query, signal) {
    if (query.readTitleSnapshots === undefined || rows.length === 0) return rows
    const observations = await query.readTitleSnapshots(rows.map((row) => row.sessionId), signal)
    return rows.map((row, index) => {
      const observation = observations[index]
      const title = observation?.status === 'fulfilled' ? observation.value?.title?.title : undefined
      return title === undefined ? row : { ...row, title }
    })
  }

  /**
   * @private
   * @param {SessionRow[]} rows
   * @param {SessionListOptions} options
   * @returns {SessionRow[]}
   */
  filterRows(rows, options) {
    const ids = options.ids === undefined ? undefined : new Set(options.ids)
    const workspaceIds = options.workspaceIds === undefined ? undefined : new Set(options.workspaceIds)
    const workspacePaths = options.workspacePaths === undefined ? undefined : new Set(options.workspacePaths)
    const statuses = options.statuses === undefined ? undefined : new Set(options.statuses)
    const origins = options.origins === undefined ? undefined : new Set(options.origins)
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
        .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(query))
    })
  }

  /**
   * @private
   * @param {SessionRow[]} rows
   * @param {SessionListOptions} options
   * @returns {SessionRow[]}
   */
  sortRows(rows, options) {
    const sort = options.sort ?? { by: 'updatedAt', order: 'desc' }
    const order = sort.order === 'asc' ? 1 : -1
    /**
     * @param {SessionRow} row
     * @returns {string | number}
     */
    const valueOf = (row) => {
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
