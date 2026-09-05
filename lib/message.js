/// <reference path="../types/host.d.ts" />

import { randomUUID } from 'node:crypto'

/**
 * @param {string} value
 * @returns {string}
 */
function yamlString(value) {
  return JSON.stringify(value)
}

/** @returns {string} */
export function mintRelayMessageId() {
  return `agm-${randomUUID()}`
}

/**
 * @param {{
 *   messageId: string,
 *   from: SenderIdentity,
 *   toSessionId: string,
 *   mode: SendSessionMode,
 *   sentAt: string,
 *   threadId: string,
 *   inReplyTo?: string,
 * }} input
 * @returns {RelayEnvelopeData}
 */
export function buildRelayEnvelopeData(input) {
  return {
    transport: 'session.prompt',
    messageId: input.messageId,
    threadId: input.threadId,
    from: input.from,
    to: { sessionId: input.toSessionId },
    mode: input.mode,
    sentAt: input.sentAt,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
  }
}

/**
 * @param {RelayEnvelopeData} data
 * @returns {string}
 */
export function relayEnvelope(data) {
  const lines = [
    '---',
    'dsh-relay:',
    '  kind: "agent-message"',
    `  messageId: ${yamlString(data.messageId)}`,
    `  threadId: ${yamlString(data.threadId)}`,
    `  fromSessionId: ${yamlString(data.from.sessionId)}`,
  ]
  if (data.from.title !== undefined) lines.push(`  fromTitle: ${yamlString(data.from.title)}`)
  if (data.from.cwd !== undefined) lines.push(`  fromCwd: ${yamlString(data.from.cwd)}`)
  if (data.from.workspaceId !== undefined) lines.push(`  fromWorkspaceId: ${yamlString(data.from.workspaceId)}`)
  if (data.from.workspaceTitle !== undefined) lines.push(`  fromWorkspaceTitle: ${yamlString(data.from.workspaceTitle)}`)
  if (data.from.agentPreset !== undefined) lines.push(`  fromAgentPreset: ${yamlString(data.from.agentPreset)}`)
  lines.push(
    `  sentAt: ${yamlString(data.sentAt)}`,
    `  delivery: ${yamlString(data.transport)}`,
    `  mode: ${yamlString(data.mode)}`,
  )
  if (data.inReplyTo !== undefined) lines.push(`  inReplyTo: ${yamlString(data.inReplyTo)}`)
  lines.push('---')
  return lines.join('\n')
}

/**
 * @param {RelayEnvelopeData} data
 * @param {string} message
 * @returns {string}
 */
export function frameRelayMessage(data, message) {
  return `${relayEnvelope(data)}\n\n${message}`
}
