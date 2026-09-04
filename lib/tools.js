/// <reference path="../types/host.d.ts" />

import { SessionMeshRuntime } from './runtime.js'

/** @type {readonly SessionStatus[]} */
const statusValues = ['running', 'idle', 'stopped']
/** @type {readonly SessionOrigin[]} */
const originValues = ['user', 'subagent', 'unknown']
/** @type {readonly SessionArchiveFilter[]} */
const archiveValues = ['exclude', 'include', 'only']
/** @type {readonly SessionSortKey[]} */
const sortKeyValues = ['createdAt', 'updatedAt', 'title', 'cwd', 'workspace']
/** @type {readonly SendSessionMode[]} */
const sendModeValues = ['queue', 'steer']
/** @type {readonly ('asc' | 'desc')[]} */
const sortOrderValues = ['asc', 'desc']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | undefined}
 */
function optionalString(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requiredString(value, label) {
  if (typeof value === 'string') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {boolean | undefined}
 */
function optionalBoolean(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number | undefined}
 */
function optionalNumber(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string[] | undefined}
 */
function optionalStringArray(value, label) {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return [...value]
  throw new Error(label)
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} values
 * @param {string} label
 * @returns {T}
 */
function enumValue(value, values, label) {
  if (typeof value === 'string' && /** @type {readonly string[]} */ (values).includes(value)) return /** @type {T} */ (value)
  throw new Error(label)
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} values
 * @param {string} label
 * @returns {T[] | undefined}
 */
function optionalEnumArray(value, values, label) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(label)
  return value.map((entry) => enumValue(entry, values, label))
}

/**
 * @param {unknown} value
 * @returns {SessionListOptions}
 */
export function parseSessionListOptions(value) {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('list_sessions: sessions must be an object')
  const query = optionalString(value.query, 'list_sessions: sessions.query must be a string')
  const ids = optionalStringArray(value.ids, 'list_sessions: sessions.ids must be a string array')
  const workspaceIds = optionalStringArray(value.workspaceIds, 'list_sessions: sessions.workspaceIds must be a string array')
  const workspacePaths = optionalStringArray(value.workspacePaths, 'list_sessions: sessions.workspacePaths must be a string array')
  const cwd = optionalString(value.cwd, 'list_sessions: sessions.cwd must be a string')
  const title = optionalString(value.title, 'list_sessions: sessions.title must be a string')
  const statuses = optionalEnumArray(value.statuses, statusValues, 'list_sessions: sessions.statuses is invalid')
  const origins = optionalEnumArray(value.origins, originValues, 'list_sessions: sessions.origins is invalid')
  const includeSelf = optionalBoolean(value.includeSelf, 'list_sessions: sessions.includeSelf must be a boolean')
  const limit = optionalNumber(value.limit, 'list_sessions: sessions.limit must be a finite number')
  const offset = optionalNumber(value.offset, 'list_sessions: sessions.offset must be a finite number')
  const sortValue = value.sort
  /** @type {SessionListOptions['sort']} */
  let sort
  if (sortValue !== undefined) {
    if (!isRecord(sortValue)) throw new Error('list_sessions: sessions.sort must be an object')
    sort = {
      by: enumValue(sortValue.by, sortKeyValues, 'list_sessions: sessions.sort.by is invalid'),
      ...(sortValue.order === undefined ? {} : { order: enumValue(sortValue.order, sortOrderValues, 'list_sessions: sessions.sort.order must be asc or desc') }),
    }
  }
  return {
    ...(query === undefined ? {} : { query }),
    ...(ids === undefined ? {} : { ids }),
    ...(workspaceIds === undefined ? {} : { workspaceIds }),
    ...(workspacePaths === undefined ? {} : { workspacePaths }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(title === undefined ? {} : { title }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(origins === undefined ? {} : { origins }),
    ...(value.archived === undefined ? {} : { archived: enumValue(value.archived, archiveValues, 'list_sessions: sessions.archived must be exclude, include, or only') }),
    ...(includeSelf === undefined ? {} : { includeSelf }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(sort === undefined ? {} : { sort }),
  }
}

/**
 * @param {unknown} args
 * @returns {ListSessionsArgs}
 */
function parseListSessionsArgs(args) {
  if (args === undefined) return {}
  if (!isRecord(args)) throw new Error('list_sessions arguments must be an object')
  return { sessions: parseSessionListOptions(args.sessions) }
}

/**
 * @param {unknown} args
 * @returns {CreateSessionArgs}
 */
function parseCreateSessionArgs(args) {
  if (args === undefined) return {}
  if (!isRecord(args)) throw new Error('create_session arguments must be an object')
  const cwd = optionalString(args.cwd, 'create_session: cwd must be a string')
  const workspaceId = optionalString(args.workspaceId, 'create_session: workspaceId must be a string')
  const title = optionalString(args.title, 'create_session: title must be a string')
  const agentPreset = optionalString(args.agentPreset, 'create_session: agentPreset must be a string')
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(title === undefined ? {} : { title }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
  }
}

/**
 * @param {unknown} args
 * @returns {SendSessionMessageArgs}
 */
function parseSendSessionMessageArgs(args) {
  if (!isRecord(args)) throw new Error('send_session_message arguments must be an object')
  const sessionId = requiredString(args.sessionId, 'send_session_message: sessionId must be a string')
  const message = requiredString(args.message, 'send_session_message: message must be a string')
  const summary = optionalString(args.summary, 'send_session_message: summary must be a string')
  const mode = args.mode === undefined ? undefined : enumValue(args.mode, sendModeValues, 'send_session_message: mode must be queue or steer')
  const expectReply = optionalBoolean(args.expectReply, 'send_session_message: expectReply must be a boolean')
  const inReplyTo = optionalString(args.inReplyTo, 'send_session_message: inReplyTo must be a string')
  return {
    sessionId,
    message,
    ...(summary === undefined ? {} : { summary }),
    ...(mode === undefined ? {} : { mode }),
    ...(expectReply === undefined ? {} : { expectReply }),
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
  }
}

const statusSchemaValues = [...statusValues]
const originSchemaValues = [...originValues]
const sendModeSchemaValues = [...sendModeValues]

/** @type {Record<string, unknown>} */
const sessionRowSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId', 'status', 'origin', 'archived', 'self', 'createdAt'],
  properties: {
    sessionId: { type: 'string' },
    status: { type: 'string', enum: statusSchemaValues },
    origin: { type: 'string', enum: originSchemaValues },
    cwd: { type: 'string' },
    title: { type: 'string' },
    workspaceId: { type: 'string' },
    workspaceTitle: { type: 'string' },
    workspacePath: { type: 'string' },
    agentPreset: { type: 'string' },
    archived: { type: 'boolean' },
    self: { type: 'boolean' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
}

/** @type {Record<string, unknown>} */
const senderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string' },
    title: { type: 'string' },
    cwd: { type: 'string' },
    workspaceId: { type: 'string' },
    workspaceTitle: { type: 'string' },
    agentPreset: { type: 'string' },
  },
}

/**
 * @param {SessionRow} row
 * @returns {string}
 */
function renderSessionRow(row) {
  const title = row.title === undefined || row.title === '' ? row.sessionId : row.title
  const cwd = row.cwd ?? '(no cwd)'
  const workspace = row.workspaceTitle ?? row.workspacePath ?? row.workspaceId
  const self = row.self ? ' self' : ''
  const archive = row.archived ? ' archived' : ''
  return workspace === undefined
    ? `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd}`
    : `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd} - ${workspace}`
}

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildListSessionsTool(runtime) {
  return {
    name: 'list_sessions',
    description: 'List ordinary durable DSH sessions visible to this host. Returns JSON rows; archived sessions are excluded by default.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessions: {
          type: 'object',
          additionalProperties: false,
          description: 'Optional filters, pagination, and sorting.',
          properties: {
            query: { type: 'string', description: 'Case-insensitive substring over id, title, cwd, and workspace fields.' },
            ids: { type: 'array', items: { type: 'string' } },
            workspaceIds: { type: 'array', items: { type: 'string' } },
            workspacePaths: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string', description: 'Case-insensitive substring over session cwd.' },
            title: { type: 'string', description: 'Case-insensitive substring over latest title.' },
            statuses: { type: 'array', items: { type: 'string', enum: statusSchemaValues } },
            origins: { type: 'array', items: { type: 'string', enum: originSchemaValues } },
            archived: { type: 'string', enum: [...archiveValues], description: 'Default is exclude.' },
            includeSelf: { type: 'boolean', description: 'Default true.' },
            limit: { type: 'number', description: 'Default 20, maximum 100.' },
            offset: { type: 'number', description: 'Rows to skip after filtering and sorting.' },
            sort: {
              type: 'object',
              additionalProperties: false,
              properties: {
                by: { type: 'string', enum: [...sortKeyValues] },
                order: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: { type: 'array', items: sessionRowSchema },
          total: { type: 'number' },
          nextOffset: { type: 'number' },
        },
      },
      /**
       * @param {unknown} _args
       * @param {DshJsonValue} value
       */
      render(_args, value) {
        const result = /** @type {ListSessionsResult} */ (/** @type {unknown} */ (value))
        const text = result.items.length === 0 ? '(no sessions)' : result.items.map(renderSessionRow).join('\n')
        return [{ type: 'text', text }]
      },
    },
    isConcurrencySafe: () => true,
    /**
     * @param {unknown} rawArgs
     * @param {DshToolRunContext} exec
     */
    async execute(rawArgs, exec) {
      const args = parseListSessionsArgs(rawArgs)
      return runtime.listSessions(args.sessions, exec.agent, exec.signal)
    },
  }
}

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildCreateSessionTool(runtime) {
  return {
    name: 'create_session',
    description: 'Create an ordinary DSH session without sending a prompt. Use cwd or workspaceId, not both.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'Absolute working directory for the new session.' },
        workspaceId: { type: 'string', description: 'Workspace to create the session in.' },
        title: { type: 'string', description: 'Optional title to set after creation.' },
        agentPreset: { type: 'string', description: 'Optional preset id; omitted uses the DSH default preset.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId', 'status', 'created'],
        properties: {
          sessionId: { type: 'string' },
          status: { type: 'string', enum: ['stopped', 'idle'] },
          cwd: { type: 'string' },
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          agentPreset: { type: 'string' },
          created: { type: 'boolean' },
        },
      },
      /**
       * @param {unknown} _args
       * @param {DshJsonValue} value
       */
      render(_args, value) {
        const result = /** @type {{ sessionId: string, status: string, cwd?: string, workspaceId?: string }} */ (/** @type {unknown} */ (value))
        const where = result.workspaceId ?? result.cwd ?? '(default cwd)'
        return [{ type: 'text', text: `created ${result.sessionId} [${result.status}] - ${where}` }]
      },
    },
    /**
     * @param {unknown} rawArgs
     * @param {DshToolRunContext} exec
     */
    async execute(rawArgs, exec) {
      return runtime.createSession(parseCreateSessionArgs(rawArgs), exec.agent, exec.signal)
    },
  }
}

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildSendSessionMessageTool(runtime) {
  return {
    name: 'send_session_message',
    description: 'Send an agent relay message to an ordinary DSH sessionId. The plugin generates a structured relay envelope before the request body.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionId', 'message'],
      properties: {
        sessionId: { type: 'string', description: 'Target ordinary DSH session id.' },
        message: { type: 'string', description: 'Message body to send after the generated dsh-relay envelope.' },
        summary: { type: 'string', description: 'Optional 5-10 word recap shown by the sender tool card.' },
        mode: { type: 'string', enum: sendModeSchemaValues, description: 'queue appends after the current turn; steer interrupts a running target. Default queue.' },
        expectReply: { type: 'boolean', description: 'Signals collaboration intent only; the tool does not wait for a reply.' },
        inReplyTo: { type: 'string', description: 'Relay message id this message replies to.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId', 'accepted', 'mode', 'to', 'from', 'deliveredVia'],
        properties: {
          messageId: { type: 'string' },
          accepted: { type: 'boolean' },
          mode: { type: 'string', enum: sendModeSchemaValues },
          to: sessionRowSchema,
          from: senderSchema,
          deliveredVia: { type: 'string', enum: ['followup', 'steer', 'resume-followup', 'resume-steer'] },
        },
      },
      /**
       * @param {unknown} _args
       * @param {DshJsonValue} value
       */
      render(_args, value) {
        const result = /** @type {SendSessionMessageResult} */ (/** @type {unknown} */ (value))
        return [{ type: 'text', text: `${result.messageId} delivered via ${result.deliveredVia} to ${result.to.sessionId}` }]
      },
    },
    /**
     * @param {unknown} rawArgs
     * @param {DshToolRunContext} exec
     */
    async execute(rawArgs, exec) {
      return runtime.sendSessionMessage(parseSendSessionMessageArgs(rawArgs), exec.agent, exec.signal)
    },
  }
}

/**
 * @param {{ tools: { register(definition: DshToolDefinition): () => void } }} ctx
 * @param {SessionMeshRuntime} runtime
 */
export function registerSessionMeshTools(ctx, runtime) {
  ctx.tools.register(buildListSessionsTool(runtime))
  ctx.tools.register(buildCreateSessionTool(runtime))
  ctx.tools.register(buildSendSessionMessageTool(runtime))
}
