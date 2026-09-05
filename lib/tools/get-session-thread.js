/// <reference path="../../types/host.d.ts" />

import { assertRelayIdentifier } from '../thread-store.js'
import { createSessionMeshTool, isRecord, optionalNumber, requiredString, senderSchema, sendModeSchemaValues } from './common.js'

/** @typedef {import('../runtime.js').SessionMeshRuntime} SessionMeshRuntime */

/** @type {Record<string, unknown>} */
const threadMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seq', 'threadId', 'messageId', 'sentAt', 'from', 'to', 'mode', 'deliveredVia'],
  properties: {
    seq: { type: 'number' },
    threadId: { type: 'string' },
    messageId: { type: 'string' },
    sentAt: { type: 'string' },
    from: senderSchema,
    to: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } },
    },
    mode: { type: 'string', enum: sendModeSchemaValues },
    deliveredVia: { type: 'string', enum: ['followup', 'steer', 'resume-followup', 'resume-steer'] },
    inReplyTo: { type: 'string' },
    expectReply: { type: 'boolean' },
    summary: { type: 'string' },
  },
}

/**
 * @param {unknown} args
 * @returns {GetSessionThreadArgs}
 */
function parseGetSessionThreadArgs(args) {
  if (!isRecord(args)) throw new Error('get_session_thread arguments must be an object')
  const threadId = assertRelayIdentifier(requiredString(args.threadId, 'get_session_thread: threadId must be a string'), 'get_session_thread: threadId')
  const limit = optionalNumber(args.limit, 'get_session_thread: limit must be a finite number')
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error('get_session_thread: limit must be a positive safe integer')
  }
  return {
    threadId,
    ...(limit === undefined ? {} : { limit }),
  }
}

/**
 * @param {RelayThreadMessage} message
 * @returns {string}
 */
function renderThreadMessage(message) {
  const reply = message.inReplyTo === undefined ? '' : ` replyTo ${message.inReplyTo}`
  const expectReply = message.expectReply === true ? ' expectReply' : ''
  const summary = message.summary === undefined || message.summary === '' ? '' : ` - ${message.summary}`
  return `#${message.seq} ${message.messageId}: ${message.from.sessionId} -> ${message.to.sessionId} via ${message.deliveredVia}${reply}${expectReply}${summary}`
}

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildGetSessionThreadTool(runtime) {
  return createSessionMeshTool({
    name: 'get_session_thread',
    description: 'Read the plugin-maintained relay thread index by threadId. This does not scan session logs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['threadId'],
      properties: {
        threadId: { type: 'string', description: 'Relay thread id returned by send_session_message.' },
        limit: { type: 'number', description: 'Maximum latest relay summaries to return. Defaults to 50 and is capped by the plugin.' },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['threadId', 'messages', 'count', 'total'],
      properties: {
        threadId: { type: 'string' },
        messages: { type: 'array', items: threadMessageSchema },
        count: { type: 'number' },
        total: { type: 'number' },
        latestSeq: { type: 'number' },
      },
    },
    render(_args, value) {
      const result = /** @type {GetSessionThreadResult} */ (/** @type {unknown} */ (value))
      const rendered = result.messages.slice(-5)
      const lines = [`${result.threadId}: ${result.count}/${result.total} indexed relay messages`]
      if (result.count > rendered.length) lines.push(`... ${result.count - rendered.length} earlier returned messages omitted from render`)
      for (const message of rendered) lines.push(renderThreadMessage(message))
      return [{ type: 'text', text: lines.join('\n') }]
    },
    parse: parseGetSessionThreadArgs,
    run(args) {
      return runtime.getSessionThread(args)
    },
  })
}
