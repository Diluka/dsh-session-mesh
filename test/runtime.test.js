import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { SessionMeshRuntime } from '../lib/runtime.js'
import { SessionMeshError } from '../lib/types.js'

function makeAgent(id, cwd, status = 'idle', agentPreset = 'cordis') {
  const delivered = []
  return {
    id,
    status,
    options: { provider: 'test-provider', model: 'test-model' },
    ctx: {},
    session: {
      header: { id, createdAt: 100, cwd, agentPreset },
      requestHeader: () => undefined,
    },
    followup(message) {
      delivered.push({ kind: 'followup', message })
    },
    steer(message) {
      delivered.push({ kind: 'steer', message })
    },
    delivered,
  }
}

function makeRuntime(records, liveAgents, extras = {}, options = {}) {
  const sessionQuery = {
    async listSessions() {
      return records.map((record) => ({
        header: {
          id: record.id,
          createdAt: record.createdAt,
          ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
          ...(record.origin === undefined ? {} : { origin: record.origin }),
          ...(record.agentPreset === undefined ? {} : { agentPreset: record.agentPreset }),
        },
        live: liveAgents.has(record.id),
        persisted: true,
      }))
    },
    async readTitleSnapshots(sessionIds) {
      return sessionIds.map((sessionId) => ({ status: 'fulfilled', value: { title: { title: `title:${sessionId}` } } }))
    },
  }
  const agents = {
    list: () => [...liveAgents.values()],
    get: (sessionId) => liveAgents.get(sessionId),
    currentInitiator: () => liveAgents.get('session-source'),
    async create(options) {
      const cwd = options.meta?.cwd ?? '/tmp/created'
      const agent = makeAgent(options.sessionId, cwd, 'idle', options.meta?.agentPreset ?? 'cordis')
      await options.setup?.(agent.ctx)
      liveAgents.set(options.sessionId, agent)
      return { agent }
    },
    async resume(options) {
      const record = records.find((entry) => entry.id === options.resumeSessionId)
      if (record === undefined) throw new Error('missing session')
      const agent = makeAgent(record.id, record.cwd ?? '/tmp/resumed', 'idle', record.agentPreset ?? 'cordis')
      await options.setup?.(agent.ctx)
      liveAgents.set(record.id, agent)
      return { agent }
    },
  }
  const services = new Map([
    ['sessionQuery', sessionQuery],
    ['agentDefaultModel', { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) }],
    ['agentPresets', {
      resolve: async (id) => ({ id: id ?? 'cordis' }),
      mount: async (_agentCtx, id) => ({ id: id ?? 'cordis' }),
      composedPreset: () => 'cordis',
    }],
    ['sessionTitle', { rename: (_session, title) => ({ title }) }],
    ...Object.entries(extras),
  ])
  const ctx = {
    agents,
    get: (name) => services.get(name),
  }
  return new SessionMeshRuntime(ctx, options)
}

test('plugin entry exposes only durable mesh tools', () => {
  const names = []
  apply({ tools: { register: (definition) => names.push(definition.name) }, agents: {}, get: () => undefined })

  assert.deepEqual(names, ['list_sessions', 'create_session', 'send_session_message', 'get_session_thread'])
})

test('listSessions returns ordinary JSON rows with filters', async () => {
  const source = makeAgent('session-source', '/tmp/source')
  const liveAgents = new Map([[source.id, source]])
  const runtime = makeRuntime([
    { id: 'session-source', cwd: '/tmp/source', createdAt: 100 },
    { id: 'session-target', cwd: '/tmp/target', createdAt: 200 },
    { id: 'session-archived', cwd: '/tmp/archive', createdAt: 50 },
  ], liveAgents, {
    workspaceRegistry: {
      archivedSessionIds: ['session-archived'],
      list: () => [{ id: 'workspace-1', title: 'Workspace', path: '/tmp/source', sessionIds: ['session-source', 'session-target'] }],
    },
  })

  const result = await runtime.listSessions({ archived: 'include', sort: { by: 'updatedAt', order: 'desc' } }, source)

  assert.equal(result.total, 3)
  assert.equal(result.items[0]?.sessionId, 'session-target')
  assert.equal(result.items.find((row) => row.sessionId === 'session-source')?.self, true)
  assert.equal(result.items.find((row) => row.sessionId === 'session-archived')?.archived, true)
  assert.equal(result.items.find((row) => row.sessionId === 'session-target')?.workspaceId, 'workspace-1')
})

test('listSessions folds titles only for the returned page by default', async () => {
  const titleReads = []
  const runtime = makeRuntime([], new Map(), {
    sessionQuery: {
      async listSessions() {
        return [
          { header: { id: 'session-new', createdAt: 300, cwd: '/tmp/new' }, live: false, persisted: true },
          { header: { id: 'session-old', createdAt: 100, cwd: '/tmp/old' }, live: false, persisted: true },
        ]
      },
      async readTitleSnapshots(sessionIds) {
        titleReads.push([...sessionIds])
        return sessionIds.map((sessionId) => ({ status: 'fulfilled', value: { title: { title: `title:${sessionId}` } } }))
      },
    },
  })

  const result = await runtime.listSessions({ limit: 1, sort: { by: 'createdAt', order: 'desc' } })

  assert.deepEqual(result.items.map((row) => row.sessionId), ['session-new'])
  assert.deepEqual(titleReads, [['session-new']])
})

test('createSession creates an idle ordinary session without prompt delivery', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-session-mesh-'))
  try {
    const source = makeAgent('session-source', temp)
    const liveAgents = new Map([[source.id, source]])
    const runtime = makeRuntime([{ id: 'session-source', cwd: temp, createdAt: 100 }], liveAgents)

    const result = await runtime.createSession({ cwd: temp, title: 'Worker' }, source)

    assert.equal(result.status, 'idle')
    assert.equal(result.created, true)
    assert.equal(result.cwd, temp)
    assert.equal(result.title, 'Worker')
    assert.equal(result.agentPreset, 'cordis')
    assert.equal(liveAgents.get(result.sessionId)?.delivered.length, 0)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('sendSessionMessage indexes a two-hop relay thread without reading session logs', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-session-mesh-thread-'))
  try {
    const source = makeAgent('session-source', '/tmp/source')
    const liveAgents = new Map([[source.id, source]])
    const mountedPresets = []
    const runtime = makeRuntime([
      { id: 'session-source', cwd: '/tmp/source', createdAt: 100 },
      {
        id: 'session-target',
        cwd: '/tmp/target',
        createdAt: 200,
        agentPreset: 'old-preset',
      },
    ], liveAgents, {
      agentPresets: {
        resolve: async (id) => ({ id: id ?? 'cordis' }),
        mount: async (_agentCtx, id) => {
          mountedPresets.push(id ?? 'cordis')
          return { id: id ?? 'cordis' }
        },
        composedPreset: () => 'cordis',
      },
      sessionQuery: {
        async listSessions() {
          return [
            { header: { id: 'session-source', createdAt: 100, cwd: '/tmp/source' }, live: true, persisted: true },
            { header: { id: 'session-target', createdAt: 200, cwd: '/tmp/target', agentPreset: 'old-preset' }, live: false, persisted: true },
          ]
        },
        async readSession() {
          throw new Error('sendSessionMessage must not read complete session logs for metadata')
        },
        async readTitleSnapshots() {
          throw new Error('sendSessionMessage must not fold title logs for metadata')
        },
      },
    }, { threadStoreOptions: { root: join(temp, 'threads'), pageSize: 2 } })

    const result = await runtime.sendSessionMessage({
      sessionId: 'session-target',
      message: 'Please inspect this.',
      summary: 'Initial inspection request',
      mode: 'queue',
      expectReply: true,
    }, source)
    const target = liveAgents.get('session-target')
    const delivered = target?.delivered[0]
    const message = delivered?.message
    const text = message?.content?.[0]?.text ?? ''

    assert.equal(result.accepted, true)
    assert.equal(result.threadIndexed, true)
    assert.match(result.threadId, /^agt-/)
    assert.equal(result.deliveredVia, 'resume-followup')
    assert.deepEqual(mountedPresets, ['old-preset'])
    assert.equal(delivered?.kind, 'followup')
    assert.equal(target?.delivered.length, 1)
    assert.equal(message.content.length, 1)
    assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-session-mesh' })
    assert.match(text, /^---\ndsh-relay:/)
    assert.match(text, new RegExp(`messageId: "${result.messageId}"`))
    assert.match(text, new RegExp(`threadId: "${result.threadId}"`))
    assert.match(text, /fromSessionId: "session-source"/)
    assert.match(text, /Please inspect this\./)
    assert.doesNotMatch(text, /trust:/)

    const reply = await runtime.sendSessionMessage({
      sessionId: 'session-source',
      message: 'I inspected it.',
      summary: 'Inspection reply',
      threadId: result.threadId,
      inReplyTo: result.messageId,
    }, target)

    assert.equal(reply.accepted, true)
    assert.equal(reply.threadId, result.threadId)
    assert.equal(reply.threadIndexed, true)
    assert.equal(reply.deliveredVia, 'followup')

    const thread = await runtime.getSessionThread({ threadId: result.threadId, limit: 10 })
    assert.equal(thread.total, 2)
    assert.equal(thread.count, 2)
    assert.deepEqual(thread.messages.map((entry) => entry.messageId), [result.messageId, reply.messageId])
    assert.equal(thread.messages[0]?.from.sessionId, 'session-source')
    assert.equal(thread.messages[0]?.to.sessionId, 'session-target')
    assert.equal(thread.messages[0]?.expectReply, true)
    assert.equal(thread.messages[0]?.summary, 'Initial inspection request')
    assert.equal(thread.messages[1]?.from.sessionId, 'session-target')
    assert.equal(thread.messages[1]?.to.sessionId, 'session-source')
    assert.equal(thread.messages[1]?.inReplyTo, result.messageId)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('sendSessionMessage reports index failure after successful delivery', async () => {
  const source = makeAgent('session-source', '/tmp/source')
  const target = makeAgent('session-target', '/tmp/target')
  const liveAgents = new Map([[source.id, source], [target.id, target]])
  const runtime = makeRuntime([
    { id: 'session-source', cwd: '/tmp/source', createdAt: 100 },
    { id: 'session-target', cwd: '/tmp/target', createdAt: 200 },
  ], liveAgents, {}, {
    threadStore: {
      async append() {
        throw new Error('disk full')
      },
      async readThread(args) {
        return { threadId: args.threadId, messages: [], count: 0, total: 0 }
      },
    },
  })

  const result = await runtime.sendSessionMessage({ sessionId: 'session-target', message: 'deliver once' }, source)

  assert.equal(result.accepted, true)
  assert.equal(result.threadIndexed, false)
  assert.equal(result.threadIndexError, 'disk full')
  assert.equal(target.delivered.length, 1)
})

test('sendSessionMessage rejects self delivery', async () => {
  const source = makeAgent('session-source', '/tmp/source')
  const runtime = makeRuntime([{ id: 'session-source', cwd: '/tmp/source', createdAt: 100 }], new Map([[source.id, source]]))

  await assert.rejects(
    runtime.sendSessionMessage({ sessionId: 'session-source', message: 'loop' }, source),
    (error) => error instanceof SessionMeshError && error.code === 'self-message',
  )
})
