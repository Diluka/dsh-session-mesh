import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

function makeRuntime(records, liveAgents, extras = {}) {
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
    async readSession(sessionId) {
      const record = records.find((entry) => entry.id === sessionId)
      if (record === undefined) throw new Error('missing session')
      return {
        session: {
          id: record.id,
          createdAt: record.createdAt,
          ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
          ...(record.origin === undefined ? {} : { origin: record.origin }),
          ...(record.agentPreset === undefined ? {} : { agentPreset: record.agentPreset }),
        },
        events: record.events ?? [],
      }
    },
    async readTitleSnapshots(sessionIds) {
      return sessionIds.map((sessionId) => ({ status: 'fulfilled', value: { title: { title: `title:${sessionId}` } } }))
    },
    async listEvents(sessionId) {
      return [{ time: sessionId === 'session-target' ? 500 : 300 }]
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
  return new SessionMeshRuntime(ctx)
}

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

test('sendSessionMessage resumes a stopped session and injects relay envelope', async () => {
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
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'mesh-preset' } }],
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
  })

  const result = await runtime.sendSessionMessage({ sessionId: 'session-target', message: 'Please inspect this.', mode: 'queue' }, source)
  const target = liveAgents.get('session-target')
  const delivered = target?.delivered[0]
  const message = delivered?.message
  const text = message?.content?.[0]?.text ?? ''

  assert.equal(result.accepted, true)
  assert.equal(result.deliveredVia, 'resume-followup')
  assert.deepEqual(mountedPresets, ['mesh-preset'])
  assert.equal(delivered?.kind, 'followup')
  assert.equal(target?.delivered.length, 1)
  assert.equal(message.content.length, 1)
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-session-mesh' })
  assert.match(text, /^---\ndsh-relay:/)
  assert.match(text, new RegExp(`messageId: "${result.messageId}"`))
  assert.match(text, /fromSessionId: "session-source"/)
  assert.match(text, /Please inspect this\./)
  assert.doesNotMatch(text, /trust:/)
})

test('sendSessionMessage rejects self delivery', async () => {
  const source = makeAgent('session-source', '/tmp/source')
  const runtime = makeRuntime([{ id: 'session-source', cwd: '/tmp/source', createdAt: 100 }], new Map([[source.id, source]]))

  await assert.rejects(
    runtime.sendSessionMessage({ sessionId: 'session-source', message: 'loop' }, source),
    (error) => error instanceof SessionMeshError && error.code === 'self-message',
  )
})
