/// <reference path="../../types/host.d.ts" />

import {
  createSessionMeshTool,
  enumValue,
  isRecord,
  optionalBoolean,
  optionalString,
  requiredString,
  senderSchema,
  sendModeSchemaValues,
  sendModeValues,
  sessionRowSchema,
} from './common.js'

/** @typedef {import('../runtime.js').SessionMeshRuntime} SessionMeshRuntime */

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

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildSendSessionMessageTool(runtime) {
  return createSessionMeshTool({
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
    outputSchema: {
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
    render(_args, value) {
      const result = /** @type {SendSessionMessageResult} */ (/** @type {unknown} */ (value))
      return [{ type: 'text', text: `${result.messageId} delivered via ${result.deliveredVia} to ${result.to.sessionId}` }]
    },
    parse: parseSendSessionMessageArgs,
    run(args, exec) {
      return runtime.sendSessionMessage(args, exec.agent, exec.signal)
    },
  })
}
