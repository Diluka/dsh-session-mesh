import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const scriptDir = dirname(fileURLToPath(import.meta.url))
const probeModulePath = join(scriptDir, 'fixtures', 'e2e-no-key-probe.mjs')
const dsh = process.env.DSH_E2E_DSH_BIN ?? 'dsh'
const e2eProvider = 'dsh-session-mesh-e2e'
const e2eModel = 'fake-model'
const resultPrefix = 'DSH_SESSION_MESH_E2E_RESULT '

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
  writeFileSync(probePath, readFileSync(probeModulePath, 'utf8'))
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

  const packedFiles = run('tar', ['-tf', tarball])
  assert.doesNotMatch(packedFiles, /^package\/lib\/tools\.js$/m)
  for (const expected of [
    'package/lib/thread-store.js',
    'package/lib/tools/common.js',
    'package/lib/tools/create-session.js',
    'package/lib/tools/get-session-thread.js',
    'package/lib/tools/list-sessions.js',
    'package/lib/tools/send-session-message.js',
    'package/scripts/report-feedback-issue.mjs',
  ]) {
    assert.match(packedFiles, new RegExp('^' + expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'))
  }
  const packedToolSources = run('tar', ['-xOf', tarball,
    'package/lib/index.js',
    'package/lib/thread-store.js',
    'package/lib/tools/common.js',
    'package/lib/tools/create-session.js',
    'package/lib/tools/get-session-thread.js',
    'package/lib/tools/list-sessions.js',
    'package/lib/tools/send-session-message.js',
  ])
  assert.doesNotMatch(packedToolSources, /get_current_session/)

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
  assert.deepEqual(result.toolSchemas, ['list_sessions', 'create_session', 'send_session_message', 'get_session_thread'])
  assert.match(result.createdSessionId, /^session-/)
  assert.match(result.threadId, /^agt-/)
  assert.equal(result.threadCount, 2)
  assert.equal(result.deliveredVia, 'followup')
  assert.equal(result.replyDeliveredVia, 'followup')
  assert.equal(result.targetStatus, 'idle')
  assert.equal(result.relayFirstLine, '---')

  console.log(`no-key DSH headless tool E2E passed with ${dshVersion}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
