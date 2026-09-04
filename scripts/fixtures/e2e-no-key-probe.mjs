export const name = 'dsh-session-mesh-e2e-probe'
export const inject = ['llm', 'tools', 'agents', 'agentLoop', 'appExit']

const provider = 'dsh-session-mesh-e2e'
const model = 'fake-model'
const senderSessionId = 'session-dsh-session-mesh-e2e-sender'

const fakeAdapter = {
  providerInfo(route) {
    return { id: route, name: 'DSH Session Mesh E2E Fake' }
  },
  providerRetryPolicy() {
    return undefined
  },
  listModels(route) {
    return Promise.resolve([{ provider: route, id: model, name: model }])
  },
  resolveModel(route, requestedModel) {
    return Promise.resolve({ provider: route, id: requestedModel, name: requestedModel, inputModalities: ['text'] })
  },
  async prepareCall(route, requestedModel) {
    return {
      model: await this.resolveModel(route, requestedModel),
      stream: async function * () {
        const text = 'dsh-session-mesh e2e fake response'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  },
}

function fail(message) {
  throw new Error(message)
}

function assertToolResult(name, result) {
  if (!result || result.isError) {
    throw new Error(name + ' failed: ' + JSON.stringify(result))
  }
  return result.value
}

function firstRelayText(agent) {
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'plugin' || event.data.source.plugin !== 'dsh-session-mesh') continue
    const block = event.data.content?.find((entry) => entry.type === 'text')
    if (typeof block?.text === 'string') return block.text
  }
  return undefined
}

async function run(ctx) {
  ctx.llm.registerAdapter([provider], fakeAdapter)
  const cwd = process.cwd()
  const sender = await ctx.agents.create({
    sessionId: senderSessionId,
    meta: { cwd },
    agentOptions: { provider, model },
  })
  try {
    const call = (name, args, agent) => ctx.tools.execute({
      callId: 'call-' + name + '-' + Math.random().toString(16).slice(2),
      name,
      arguments: args,
      ...(agent ? { agent } : {}),
      signal: AbortSignal.timeout(20000),
    })
    const schemas = ctx.tools.schemas(sender.agent).map((schema) => schema.name)
    for (const expected of ['list_sessions', 'create_session', 'send_session_message']) {
      if (!schemas.includes(expected)) fail('missing tool schema ' + expected + ' in ' + schemas.join(','))
    }
    if (schemas.includes('get_current_session')) fail('removed tool get_current_session is still visible')

    const listed = assertToolResult(
      'list_sessions',
      await call('list_sessions', { sessions: { ids: [senderSessionId] } }, sender.agent),
    )
    if (!listed.items?.some((row) => row.sessionId === senderSessionId && row.self === true)) {
      fail('list_sessions did not return the sender self row: ' + JSON.stringify(listed))
    }

    const created = assertToolResult(
      'create_session',
      await call('create_session', { cwd, title: 'session mesh e2e target' }, sender.agent),
    )
    if (!created.sessionId || created.created !== true || created.cwd !== cwd) {
      fail('create_session returned bad payload: ' + JSON.stringify(created))
    }

    const sent = assertToolResult(
      'send_session_message',
      await call('send_session_message', {
        sessionId: created.sessionId,
        message: 'E2E relay payload',
        summary: 'E2E relay payload',
        expectReply: false,
      }, sender.agent),
    )
    if (sent.accepted !== true || sent.to?.sessionId !== created.sessionId || sent.from?.sessionId !== senderSessionId) {
      fail('send_session_message returned bad payload: ' + JSON.stringify(sent))
    }

    const target = ctx.agents.get(created.sessionId)
    if (!target) fail('target agent is not live after delivery')
    await target.whenIdle()
    const relayText = firstRelayText(target)
    if (!relayText?.startsWith('---\ndsh-relay:\n')) fail('relay frontmatter missing: ' + JSON.stringify(relayText))
    if (relayText.includes('\n  trust:')) fail('relay frontmatter must not contain trust: ' + relayText)
    if (!relayText.includes('\n  fromSessionId: "' + senderSessionId + '"')) fail('relay sender id missing: ' + relayText)
    if (!relayText.endsWith('\n\nE2E relay payload')) fail('relay payload missing after frontmatter: ' + relayText)

    return {
      toolSchemas: schemas.filter((name) => name === 'list_sessions' || name === 'create_session' || name === 'send_session_message'),
      createdSessionId: created.sessionId,
      deliveredVia: sent.deliveredVia,
      targetStatus: target.status,
      relayFirstLine: relayText.split('\n')[0],
    }
  } finally {
    await sender.dispose()
  }
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  run(ctx).then(
    (result) => {
      console.log('DSH_SESSION_MESH_E2E_RESULT ' + JSON.stringify(result))
      exit(0)
    },
    (error) => {
      console.error('DSH_SESSION_MESH_E2E_ERROR ' + (error && error.stack ? error.stack : String(error)))
      exit(1)
    },
  )
}
