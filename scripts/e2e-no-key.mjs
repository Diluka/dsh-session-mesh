import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const dsh = process.env.DSH_E2E_DSH_BIN ?? 'dsh'
const e2eProvider = 'dsh-session-mesh-e2e'
const e2eModel = 'fake-model'
const resultPrefix = 'DSH_SESSION_MESH_E2E_RESULT '

const probeModule = String.raw`
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
`

const overlayPatch = `
- id: headless-runner
  disabled: true
- id: agent-default-model
  config:
    provider: ${e2eProvider}
    model: ${e2eModel}
- insert:
    - id: session-mesh-e2e-probe
      name: ./probe.mjs
`.trimStart()

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, timeout?: number }} [options]
 * @returns {string}
 */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 120000,
      env: { ...process.env, ...options.env },
    })
  } catch (error) {
    if (error && typeof error === 'object') {
      const stdout = 'stdout' in error ? error.stdout : undefined
      const stderr = 'stderr' in error ? error.stderr : undefined
      if (stdout) process.stdout.write(String(stdout))
      if (stderr) process.stderr.write(String(stderr))
    }
    throw error
  }
}

const temp = mkdtempSync(join(tmpdir(), 'dsh-session-mesh-e2e-'))
try {
  const packDir = join(temp, 'pack')
  const dshHome = join(temp, 'dsh-home')
  const probePath = join(temp, 'probe.mjs')
  const patchPath = join(temp, 'patch.yml')
  const dshVersion = run(dsh, ['--version']).trim()
  assert.match(dshVersion, /^0\.1\.2-rc\.1$/, 'E2E expects DSH 0.1.2-rc.1')

  mkdirSync(packDir, { recursive: true })
  writeFileSync(probePath, probeModule)
  writeFileSync(patchPath, overlayPatch)

  const packOutput = run('pnpm', ['pack', '--pack-destination', packDir])
  const tarball = packOutput.trim().split(/\r?\n/).find((line) => line.endsWith('.tgz'))
  assert.ok(tarball, `pnpm pack did not report a tarball path:\n${packOutput}`)
  assert.ok(existsSync(tarball), `packed tarball is missing: ${tarball}`)

  const env = {
    DSH_HOME: dshHome,
    DEEPSEEK_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    GOOGLE_API_KEY: '',
  }
  run(dsh, ['plugin', '--profile', 'headless', 'add', tarball], { env })
  const profilePackagePath = join(dshHome, 'profiles', 'headless', 'package.json')
  const profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8'))
  assert.equal(profilePackage.dependencies?.['dsh-session-mesh'], `file:${tarball}`)
  assert.ok(profilePackage.dsh?.profile?.bundles?.includes('dsh-session-mesh'))

  const packedTools = run('tar', ['-xOf', tarball, 'package/lib/tools.js'])
  assert.doesNotMatch(packedTools, /get_current_session/)

  const config = run(dsh, ['--profile', 'headless', '--dump-config'], { env })
  assert.match(config, /# == dsh-session-mesh/)
  assert.match(config, /- id: session-mesh\n\s+name: dsh-session-mesh/)

  const headlessOutput = run(dsh, ['--profile', 'headless', '--patch', patchPath, 'e2e'], {
    timeout: 120000,
    env: {
      ...env,
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TOOLS_MODE: 'native',
    },
  })
  const resultLine = headlessOutput.split(/\r?\n/).find((line) => line.startsWith(resultPrefix))
  assert.ok(resultLine, `headless E2E did not report a result marker:\n${headlessOutput}`)
  const result = JSON.parse(resultLine.slice(resultPrefix.length))
  assert.deepEqual(result.toolSchemas, ['list_sessions', 'create_session', 'send_session_message'])
  assert.match(result.createdSessionId, /^session-/)
  assert.equal(result.deliveredVia, 'followup')
  assert.equal(result.targetStatus, 'idle')
  assert.equal(result.relayFirstLine, '---')

  console.log(`no-key DSH headless tool E2E passed with ${dshVersion}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
