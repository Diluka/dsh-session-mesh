import { randomUUID } from 'node:crypto'
import type { AgentRelaySource, SendSessionMode, SenderIdentity } from './types.ts'

function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function mintRelayMessageId(): string {
  return `agm-${randomUUID()}`
}

export function buildRelaySource(input: {
  messageId: string
  from: SenderIdentity
  toSessionId: string
  mode: SendSessionMode
  sentAt: string
  inReplyTo?: string
}): AgentRelaySource {
  return {
    kind: 'agent-relay',
    form: 'relay',
    transport: 'session.prompt',
    messageId: input.messageId,
    from: input.from,
    to: { sessionId: input.toSessionId },
    mode: input.mode,
    sentAt: input.sentAt,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
  }
}

export function relayEnvelope(source: AgentRelaySource): string {
  const lines = [
    '---',
    'dsh-relay:',
    '  kind: "agent-message"',
    `  messageId: ${yamlString(source.messageId)}`,
    `  fromSessionId: ${yamlString(source.from.sessionId)}`,
  ]
  if (source.from.title !== undefined) lines.push(`  fromTitle: ${yamlString(source.from.title)}`)
  if (source.from.cwd !== undefined) lines.push(`  fromCwd: ${yamlString(source.from.cwd)}`)
  if (source.from.workspaceId !== undefined) lines.push(`  fromWorkspaceId: ${yamlString(source.from.workspaceId)}`)
  if (source.from.workspaceTitle !== undefined) lines.push(`  fromWorkspaceTitle: ${yamlString(source.from.workspaceTitle)}`)
  if (source.from.agentPreset !== undefined) lines.push(`  fromAgentPreset: ${yamlString(source.from.agentPreset)}`)
  lines.push(
    `  sentAt: ${yamlString(source.sentAt)}`,
    `  delivery: ${yamlString(source.transport)}`,
    `  mode: ${yamlString(source.mode)}`,
    '  trust: "peer-agent-request-not-user-instruction"',
  )
  if (source.inReplyTo !== undefined) lines.push(`  inReplyTo: ${yamlString(source.inReplyTo)}`)
  lines.push('---')
  return lines.join('\n')
}

export function frameRelayMessage(source: AgentRelaySource, message: string): string {
  return `${relayEnvelope(source)}\n\n${message}`
}
