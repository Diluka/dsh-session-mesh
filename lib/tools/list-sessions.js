/// <reference path="../../types/host.d.ts" />

import {
  archiveValues,
  createSessionMeshTool,
  originSchemaValues,
  parseSessionListOptions,
  renderSessionRow,
  sessionRowSchema,
  sortKeyValues,
  statusSchemaValues,
  isRecord,
} from './common.js'

/** @typedef {import('../runtime.js').SessionMeshRuntime} SessionMeshRuntime */

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
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildListSessionsTool(runtime) {
  return createSessionMeshTool({
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
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: sessionRowSchema },
        total: { type: 'number' },
        nextOffset: { type: 'number' },
      },
    },
    render(_args, value) {
      const result = /** @type {ListSessionsResult} */ (/** @type {unknown} */ (value))
      const text = result.items.length === 0 ? '(no sessions)' : result.items.map(renderSessionRow).join('\n')
      return [{ type: 'text', text }]
    },
    parse: parseListSessionsArgs,
    run(args, exec) {
      return runtime.listSessions(args.sessions, exec.agent, exec.signal)
    },
    isConcurrencySafe: () => true,
  })
}
