export const name = 'dsh-session-mesh-e2e-probe'
export const inject = ['llm', 'tools', 'agents', 'agentLoop', 'appExit']

const provider = 'dsh-session-mesh-e2e'
const model = 'fake-model'
const senderSessionId = 'session-dsh-session-mesh-e2e-sender'
const meshToolNames = ['list_sessions', 'create_session', 'send_session_message', 'get_session_thread']

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

function renderedText(result) {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function parseRelayFrontmatter(text) {
  const lines = text.split('\n')
  if (lines[0] !== '---' || lines[1] !== 'dsh-relay:') fail('relay frontmatter header is not parseable: ' + JSON.stringify(text))
  const parsed = {}
  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '---') return parsed
    const match = /^  ([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(line)
    if (!match) fail('relay frontmatter line is not parseable: ' + line)
    parsed[match[1]] = JSON.parse(match[2])
  }
  fail('relay frontmatter terminator missing: ' + JSON.stringify(text))
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
    for (const expected of meshToolNames) {
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
        message: 'E2E relay payload body',
        summary: 'E2E relay summary',
        expectReply: true,
      }, sender.agent),
    )
    if (sent.accepted !== true || sent.threadIndexed !== true || typeof sent.threadId !== 'string' || sent.to?.sessionId !== created.sessionId || sent.from?.sessionId !== senderSessionId) {
      fail('send_session_message returned bad payload: ' + JSON.stringify(sent))
    }

    const target = ctx.agents.get(created.sessionId)
    if (!target) fail('target agent is not live after delivery')
    await target.whenIdle()
    const relayText = firstRelayText(target)
    if (!relayText?.startsWith('---\ndsh-relay:\n')) fail('relay frontmatter missing: ' + JSON.stringify(relayText))
    if (relayText.includes('\n  trust:')) fail('relay frontmatter must not contain trust: ' + relayText)
    const relayFrontmatter = parseRelayFrontmatter(relayText)
    if (relayFrontmatter.messageId !== sent.messageId) fail('relay message id missing: ' + JSON.stringify(relayFrontmatter))
    if (relayFrontmatter.threadId !== sent.threadId) fail('relay thread id missing: ' + JSON.stringify(relayFrontmatter))
    if (relayFrontmatter.fromSessionId !== senderSessionId) fail('relay sender id missing: ' + JSON.stringify(relayFrontmatter))
    if (relayFrontmatter.delivery !== 'session.prompt') fail('relay delivery missing: ' + JSON.stringify(relayFrontmatter))
    if (!relayText.endsWith('\n\nE2E relay payload body')) fail('relay payload missing after frontmatter: ' + relayText)

    const replied = assertToolResult(
      'send_session_message reply',
      await call('send_session_message', {
        sessionId: senderSessionId,
        message: 'E2E reply payload body',
        summary: 'E2E reply summary',
        threadId: sent.threadId,
        inReplyTo: sent.messageId,
      }, target),
    )
    if (replied.accepted !== true || replied.threadId !== sent.threadId || replied.threadIndexed !== true || replied.from?.sessionId !== created.sessionId) {
      fail('send_session_message reply returned bad payload: ' + JSON.stringify(replied))
    }
    await sender.agent.whenIdle()

    const threadResult = await call('get_session_thread', { threadId: sent.threadId, limit: 10 }, sender.agent)
    const thread = assertToolResult('get_session_thread', threadResult)
    const threadRendered = renderedText(threadResult)
    if (thread.total !== 2 || thread.count !== 2 || thread.messages?.[0]?.messageId !== sent.messageId || thread.messages?.[1]?.messageId !== replied.messageId) {
      fail('get_session_thread returned bad payload: ' + JSON.stringify(thread))
    }
    const threadJson = JSON.stringify(thread)
    if (threadJson.includes('E2E relay payload body') || threadJson.includes('E2E reply payload body')) {
      fail('get_session_thread must not expose message bodies: ' + threadJson)
    }
    if (!threadRendered.includes(sent.messageId) || !threadRendered.includes('E2E relay summary') || !threadRendered.includes('E2E reply summary')) {
      fail('get_session_thread render is not useful enough: ' + threadRendered)
    }
    if (threadRendered.includes('E2E relay payload body') || threadRendered.includes('E2E reply payload body')) {
      fail('get_session_thread render must not expose message bodies: ' + threadRendered)
    }
    if (thread.messages[1].inReplyTo !== sent.messageId || thread.messages[1].from?.sessionId !== created.sessionId || thread.messages[1].to?.sessionId !== senderSessionId) {
      fail('get_session_thread did not preserve reply metadata: ' + JSON.stringify(thread))
    }

    return {
      toolSchemas: schemas.filter((name) => meshToolNames.includes(name)),
      createdSessionId: created.sessionId,
      threadId: sent.threadId,
      threadCount: thread.count,
      deliveredVia: sent.deliveredVia,
      replyDeliveredVia: replied.deliveredVia,
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
