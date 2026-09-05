import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RelayThreadStore } from '../lib/thread-store.js'

function appendInput(overrides = {}) {
  const seq = overrides.seq ?? 1
  return {
    threadId: 'agt-thread',
    messageId: `agm-${seq}`,
    sentAt: `2026-01-02T03:04:0${seq}.000Z`,
    from: { sessionId: seq % 2 === 0 ? 'session-b' : 'session-a' },
    to: { sessionId: seq % 2 === 0 ? 'session-a' : 'session-b' },
    mode: 'queue',
    deliveredVia: 'followup',
    message: `message body ${seq}`,
    ...overrides,
  }
}

test('RelayThreadStore reads only latest bounded thread summaries', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-session-mesh-store-'))
  try {
    const store = new RelayThreadStore({ root: temp, pageSize: 2, maxReadLimit: 3 })
    for (let seq = 1; seq <= 5; seq += 1) {
      await store.append(appendInput({ seq }))
    }

    const thread = await store.readThread({ threadId: 'agt-thread', limit: 10 })

    assert.equal(thread.total, 5)
    assert.equal(thread.count, 3)
    assert.deepEqual(thread.messages.map((message) => message.seq), [3, 4, 5])
    assert.deepEqual(thread.messages.map((message) => message.messageId), ['agm-3', 'agm-4', 'agm-5'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('RelayThreadStore stores bounded summaries and reply metadata without body previews', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-session-mesh-store-'))
  try {
    const store = new RelayThreadStore({ root: temp, pageSize: 2 })
    await store.append(appendInput({
      message: 'sensitive body must not be indexed',
      summary: 'summary',
      expectReply: true,
    }))
    await store.append(appendInput({
      seq: 2,
      inReplyTo: 'agm-1',
      message: 'reply',
      summary: 'y'.repeat(250),
    }))

    const thread = await store.readThread({ threadId: 'agt-thread' })

    assert.equal(thread.total, 2)
    assert.equal('messagePreview' in (thread.messages[0] ?? {}), false)
    assert.equal('messageTruncated' in (thread.messages[0] ?? {}), false)
    assert.equal(JSON.stringify(thread).includes('sensitive body must not be indexed'), false)
    assert.equal(thread.messages[0]?.summary, 'summary')
    assert.equal(thread.messages[0]?.expectReply, true)
    assert.equal(thread.messages[1]?.inReplyTo, 'agm-1')
    assert.equal(thread.messages[1]?.summary.length, 200)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('RelayThreadStore serializes concurrent appends per thread', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-session-mesh-store-'))
  try {
    const store = new RelayThreadStore({ root: temp, pageSize: 2 })
    await Promise.all([1, 2, 3].map((seq) => store.append(appendInput({ seq }))))

    const thread = await store.readThread({ threadId: 'agt-thread', limit: 3 })

    assert.equal(thread.total, 3)
    assert.deepEqual(thread.messages.map((message) => message.seq), [1, 2, 3])
    assert.deepEqual(thread.messages.map((message) => message.messageId), ['agm-1', 'agm-2', 'agm-3'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
