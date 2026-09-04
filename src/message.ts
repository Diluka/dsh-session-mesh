import { randomUUID } from 'node:crypto'
import type { RelayEnvelopeData, SendSessionMode, SenderIdentity } from './types.ts'

function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function mintRelayMessageId(): string {
  return `agm-${randomUUID()}`
}

export function buildRelayEnvelopeData(input: {
  messageId: string
  from: SenderIdentity
  toSessionId: string
  mode: SendSessionMode
  sentAt: string
  inReplyTo?: string
}): RelayEnvelopeData {
  return {
    transport: 'session.prompt',
    messageId: input.messageId,
    from: input.from,
    to: { sessionId: input.toSessionId },
    mode: input.mode,
    sentAt: input.sentAt,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
  }
}

export function relayEnvelope(data: RelayEnvelopeData): string {
  const lines = [
    '---',
    'dsh-relay:',
    '  kind: "agent-message"',
    `  messageId: ${yamlString(data.messageId)}`,
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

export function frameRelayMessage(data: RelayEnvelopeData, message: string): string {
  return `${relayEnvelope(data)}\n\n${message}`
}
