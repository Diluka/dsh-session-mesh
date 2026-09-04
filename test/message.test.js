import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRelayEnvelopeData, frameRelayMessage, relayEnvelope } from '../lib/message.js'

test('relay envelope carries generated sender identity for post-processing', () => {
  const from = {
    sessionId: 'session-source',
    title: 'Source Agent',
    cwd: '/tmp/source',
    workspaceId: 'workspace-1',
    workspaceTitle: 'Source Workspace',
    agentPreset: 'cordis',
  }
  const data = buildRelayEnvelopeData({
    messageId: 'agm-test',
    from,
    toSessionId: 'session-target',
    mode: 'queue',
    sentAt: '2026-01-02T03:04:05.000Z',
    inReplyTo: 'agm-parent',
  })

  assert.deepEqual(data.to, { sessionId: 'session-target' })
  assert.equal(data.inReplyTo, 'agm-parent')

  const envelope = relayEnvelope(data)
  assert.match(envelope, /dsh-relay:/)
  assert.match(envelope, /kind: "agent-message"/)
  assert.match(envelope, /messageId: "agm-test"/)
  assert.match(envelope, /fromSessionId: "session-source"/)
  assert.match(envelope, /mode: "queue"/)
  assert.doesNotMatch(envelope, /trust:/)
})

test('frameRelayMessage prefixes body with envelope', () => {
  const data = buildRelayEnvelopeData({
    messageId: 'agm-test',
    from: { sessionId: 'session-source' },
    toSessionId: 'session-target',
    mode: 'steer',
    sentAt: '2026-01-02T03:04:05.000Z',
  })

  const text = frameRelayMessage(data, 'Do the work.')

  assert.match(text, /^---\ndsh-relay:/)
  assert.equal(text.endsWith('\n\nDo the work.'), true)
  assert.equal((text.match(/^---$/gm) ?? []).length, 2)
})
