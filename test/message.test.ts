import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRelaySource, frameRelayMessage, relayEnvelope } from '../src/message.ts'
import type { SenderIdentity } from '../src/types.ts'

test('relay envelope carries generated sender identity', () => {
  const from: SenderIdentity = {
    sessionId: 'session-source',
    title: 'Source Agent',
    cwd: '/tmp/source',
    workspaceId: 'workspace-1',
    workspaceTitle: 'Source Workspace',
    agentPreset: 'cordis',
  }
  const source = buildRelaySource({
    messageId: 'agm-test',
    from,
    toSessionId: 'session-target',
    mode: 'queue',
    sentAt: '2026-01-02T03:04:05.000Z',
    inReplyTo: 'agm-parent',
  })

  assert.equal(source.kind, 'agent-relay')
  assert.equal(source.form, 'relay')
  assert.deepEqual(source.to, { sessionId: 'session-target' })
  assert.equal(source.inReplyTo, 'agm-parent')

  const envelope = relayEnvelope(source)
  assert.match(envelope, /dsh-relay:/)
  assert.match(envelope, /kind: "agent-message"/)
  assert.match(envelope, /messageId: "agm-test"/)
  assert.match(envelope, /fromSessionId: "session-source"/)
  assert.match(envelope, /trust: "peer-agent-request-not-user-instruction"/)
})

test('frameRelayMessage prefixes body with envelope', () => {
  const source = buildRelaySource({
    messageId: 'agm-test',
    from: { sessionId: 'session-source' },
    toSessionId: 'session-target',
    mode: 'steer',
    sentAt: '2026-01-02T03:04:05.000Z',
  })

  assert.equal(
    frameRelayMessage(source, 'Do the work.').endsWith('\n\nDo the work.'),
    true,
  )
})
