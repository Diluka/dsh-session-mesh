import type { JsonValue, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  CreateSessionArgs,
  ListSessionsArgs,
  ListSessionsResult,
  SendSessionMessageArgs,
  SendSessionMessageResult,
  SessionListOptions,
  SessionOrigin,
  SessionRow,
  SessionStatus,
} from './types.ts'
import { SessionMeshRuntime } from './runtime.ts'

const statusValues = ['running', 'idle', 'stopped'] as const
const originValues = ['user', 'subagent', 'unknown'] as const
const archiveValues = ['exclude', 'include', 'only'] as const
const sortKeyValues = ['createdAt', 'updatedAt', 'title', 'cwd', 'workspace'] as const
const sendModeValues = ['queue', 'steer'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(label)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === 'string') return value
  throw new Error(label)
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  throw new Error(label)
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(label)
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return [...value]
  throw new Error(label)
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T
  throw new Error(label)
}

function optionalEnumArray<T extends string>(value: unknown, values: readonly T[], label: string): T[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(label)
  return value.map((entry) => enumValue(entry, values, label))
}

export function parseSessionListOptions(value: unknown): SessionListOptions {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('list_sessions: sessions must be an object')
  const query = optionalString(value.query, 'list_sessions: sessions.query must be a string')
  const ids = optionalStringArray(value.ids, 'list_sessions: sessions.ids must be a string array')
  const workspaceIds = optionalStringArray(value.workspaceIds, 'list_sessions: sessions.workspaceIds must be a string array')
  const workspacePaths = optionalStringArray(value.workspacePaths, 'list_sessions: sessions.workspacePaths must be a string array')
  const cwd = optionalString(value.cwd, 'list_sessions: sessions.cwd must be a string')
  const title = optionalString(value.title, 'list_sessions: sessions.title must be a string')
  const statuses = optionalEnumArray<SessionStatus>(value.statuses, statusValues, 'list_sessions: sessions.statuses is invalid')
  const origins = optionalEnumArray<SessionOrigin>(value.origins, originValues, 'list_sessions: sessions.origins is invalid')
  const includeSelf = optionalBoolean(value.includeSelf, 'list_sessions: sessions.includeSelf must be a boolean')
  const limit = optionalNumber(value.limit, 'list_sessions: sessions.limit must be a finite number')
  const offset = optionalNumber(value.offset, 'list_sessions: sessions.offset must be a finite number')
  const sortValue = value.sort
  let sort: SessionListOptions['sort']
  if (sortValue !== undefined) {
    if (!isRecord(sortValue)) throw new Error('list_sessions: sessions.sort must be an object')
    sort = {
      by: enumValue(sortValue.by, sortKeyValues, 'list_sessions: sessions.sort.by is invalid'),
      ...(sortValue.order === undefined ? {} : { order: enumValue(sortValue.order, ['asc', 'desc'] as const, 'list_sessions: sessions.sort.order must be asc or desc') }),
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

function parseListSessionsArgs(args: unknown): ListSessionsArgs {
  if (args === undefined) return {}
  if (!isRecord(args)) throw new Error('list_sessions arguments must be an object')
  return { sessions: parseSessionListOptions(args.sessions) }
}

function parseCreateSessionArgs(args: unknown): CreateSessionArgs {
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

function parseSendSessionMessageArgs(args: unknown): SendSessionMessageArgs {
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

const sessionRowSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sessionId', 'status', 'origin', 'archived', 'self', 'createdAt'],
  properties: {
    sessionId: { type: 'string' as const },
    status: { type: 'string' as const, enum: statusSchemaValues },
    origin: { type: 'string' as const, enum: originSchemaValues },
    cwd: { type: 'string' as const },
    title: { type: 'string' as const },
    workspaceId: { type: 'string' as const },
    workspaceTitle: { type: 'string' as const },
    workspacePath: { type: 'string' as const },
    agentPreset: { type: 'string' as const },
    archived: { type: 'boolean' as const },
    self: { type: 'boolean' as const },
    createdAt: { type: 'number' as const },
    updatedAt: { type: 'number' as const },
  },
}

const senderSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string' as const },
    title: { type: 'string' as const },
    cwd: { type: 'string' as const },
    workspaceId: { type: 'string' as const },
    workspaceTitle: { type: 'string' as const },
    agentPreset: { type: 'string' as const },
  },
}

function renderSessionRow(row: SessionRow): string {
  const title = row.title === undefined || row.title === '' ? row.sessionId : row.title
  const cwd = row.cwd ?? '(no cwd)'
  const workspace = row.workspaceTitle ?? row.workspacePath ?? row.workspaceId
  const self = row.self ? ' self' : ''
  const archive = row.archived ? ' archived' : ''
  return workspace === undefined
    ? `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd}`
    : `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd} - ${workspace}`
}

export function buildListSessionsTool(runtime: SessionMeshRuntime): ToolDefinition {
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
      render: (_args: unknown, value: JsonValue) => {
        const result = value as unknown as ListSessionsResult
        const text = result.items.length === 0 ? '(no sessions)' : result.items.map(renderSessionRow).join('\n')
        return [{ type: 'text', text }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs: unknown, exec: ToolRunContext) {
      const args = parseListSessionsArgs(rawArgs)
      return runtime.listSessions(args.sessions, exec.agent, exec.signal)
    },
  }
}

export function buildGetCurrentSessionTool(runtime: SessionMeshRuntime): ToolDefinition {
  return {
    name: 'get_current_session',
    description: 'Return the current agent-owned DSH session identity as ordinary JSON.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['session'],
        properties: { session: sessionRowSchema },
      },
      render: (_args: unknown, value: JsonValue) => {
        const session = (value as unknown as { session: SessionRow }).session
        return [{ type: 'text', text: renderSessionRow(session) }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(_rawArgs: unknown, exec: ToolRunContext) {
      return { session: await runtime.currentSession(exec.agent, exec.signal) }
    },
  }
}

export function buildCreateSessionTool(runtime: SessionMeshRuntime): ToolDefinition {
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
      render: (_args: unknown, value: JsonValue) => {
        const result = value as unknown as { sessionId: string; status: string; cwd?: string; workspaceId?: string }
        const where = result.workspaceId ?? result.cwd ?? '(default cwd)'
        return [{ type: 'text', text: `created ${result.sessionId} [${result.status}] - ${where}` }]
      },
    },
    async execute(rawArgs: unknown, exec: ToolRunContext) {
      return runtime.createSession(parseCreateSessionArgs(rawArgs), exec.agent, exec.signal)
    },
  }
}

export function buildSendSessionMessageTool(runtime: SessionMeshRuntime): ToolDefinition {
  return {
    name: 'send_session_message',
    description: 'Send an agent relay message to an ordinary DSH sessionId. The relay envelope is generated by the plugin; this is not a human user instruction.',
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
      render: (_args: unknown, value: JsonValue) => {
        const result = value as unknown as SendSessionMessageResult
        return [{ type: 'text', text: `${result.messageId} delivered via ${result.deliveredVia} to ${result.to.sessionId}` }]
      },
    },
    async execute(rawArgs: unknown, exec: ToolRunContext) {
      return runtime.sendSessionMessage(parseSendSessionMessageArgs(rawArgs), exec.agent, exec.signal)
    },
  }
}

export function registerSessionMeshTools(ctx: { tools: { register(definition: ToolDefinition): () => void } }, runtime: SessionMeshRuntime): void {
  ctx.tools.register(buildListSessionsTool(runtime))
  ctx.tools.register(buildGetCurrentSessionTool(runtime))
  ctx.tools.register(buildCreateSessionTool(runtime))
  ctx.tools.register(buildSendSessionMessageTool(runtime))
}
