/// <reference path="../../types/host.d.ts" />

/** @type {readonly SessionStatus[]} */
const statusValues = ['running', 'idle', 'stopped']
/** @type {readonly SessionOrigin[]} */
const originValues = ['user', 'subagent', 'unknown']
/** @type {readonly SessionArchiveFilter[]} */
export const archiveValues = ['exclude', 'include', 'only']
/** @type {readonly SessionSortKey[]} */
export const sortKeyValues = ['createdAt', 'updatedAt', 'title', 'cwd', 'workspace']
/** @type {readonly SendSessionMode[]} */
export const sendModeValues = ['queue', 'steer']
/** @type {readonly ('asc' | 'desc')[]} */
const sortOrderValues = ['asc', 'desc']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | undefined}
 */
export function optionalString(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function requiredString(value, label) {
  if (typeof value === 'string') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {boolean | undefined}
 */
export function optionalBoolean(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number | undefined}
 */
export function optionalNumber(value, label) {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(label)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string[] | undefined}
 */
export function optionalStringArray(value, label) {
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
export function enumValue(value, values, label) {
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
export function optionalEnumArray(value, values, label) {
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

export const statusSchemaValues = [...statusValues]
export const originSchemaValues = [...originValues]
export const sendModeSchemaValues = [...sendModeValues]

/** @type {Record<string, unknown>} */
export const sessionRowSchema = {
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
export const senderSchema = {
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
export function renderSessionRow(row) {
  const title = row.title === undefined || row.title === '' ? row.sessionId : row.title
  const cwd = row.cwd ?? '(no cwd)'
  const workspace = row.workspaceTitle ?? row.workspacePath ?? row.workspaceId
  const self = row.self ? ' self' : ''
  const archive = row.archived ? ' archived' : ''
  return workspace === undefined
    ? `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd}`
    : `${row.sessionId} [${row.status}${archive}${self}] - ${title} - ${cwd} - ${workspace}`
}
