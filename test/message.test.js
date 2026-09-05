import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRelayEnvelopeData, frameRelayMessage, relayEnvelope } from '../lib/message.js'

function parseRelayFrontmatter(text) {
  const lines = text.split('\n')
  assert.equal(lines[0], '---')
  assert.equal(lines[1], 'dsh-relay:')
  const result = {}
  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '---') return result
    const match = /^  ([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(line)
    assert.ok(match, `frontmatter line is not parseable: ${line}`)
    result[match[1]] = JSON.parse(match[2])
  }
  assert.fail('frontmatter terminator missing')
}

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
    threadId: 'agt-thread',
    inReplyTo: 'agm-parent',
  })

  assert.deepEqual(data.to, { sessionId: 'session-target' })
  assert.equal(data.threadId, 'agt-thread')
  assert.equal(data.inReplyTo, 'agm-parent')

  const envelope = relayEnvelope(data)
  const parsed = parseRelayFrontmatter(envelope)
  assert.deepEqual(parsed, {
    kind: 'agent-message',
    messageId: 'agm-test',
    threadId: 'agt-thread',
    fromSessionId: 'session-source',
    fromTitle: 'Source Agent',
    fromCwd: '/tmp/source',
    fromWorkspaceId: 'workspace-1',
    fromWorkspaceTitle: 'Source Workspace',
    fromAgentPreset: 'cordis',
    sentAt: '2026-01-02T03:04:05.000Z',
    delivery: 'session.prompt',
    mode: 'queue',
    inReplyTo: 'agm-parent',
  })
  assert.doesNotMatch(envelope, /trust:/)
})

test('frameRelayMessage prefixes body with envelope', () => {
  const data = buildRelayEnvelopeData({
    messageId: 'agm-test',
    from: { sessionId: 'session-source' },
    toSessionId: 'session-target',
    mode: 'steer',
    sentAt: '2026-01-02T03:04:05.000Z',
    threadId: 'agt-thread',
  })

  const text = frameRelayMessage(data, 'Do the work.')

  assert.match(text, /^---\ndsh-relay:/)
  assert.equal(text.endsWith('\n\nDo the work.'), true)
  assert.equal((text.match(/^---$/gm) ?? []).length, 2)
})
