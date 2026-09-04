import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const dsh = process.env.DSH_E2E_DSH_BIN ?? 'dsh'

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
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
  const dshVersion = run(dsh, ['--version']).trim()
  assert.match(dshVersion, /^0\.1\.2-rc\.1$/, 'E2E expects DSH 0.1.2-rc.1')

  const packOutput = run('pnpm', ['pack', '--pack-destination', packDir])
  const tarball = packOutput.trim().split(/\r?\n/).find((line) => line.endsWith('.tgz'))
  assert.ok(tarball, `pnpm pack did not report a tarball path:\n${packOutput}`)
  assert.ok(existsSync(tarball), `packed tarball is missing: ${tarball}`)

  const env = { DSH_HOME: dshHome }
  run(dsh, ['plugin', '--profile', 'web', 'add', tarball], { env })
  const profilePackagePath = join(dshHome, 'profiles', 'web', 'package.json')
  const profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8'))
  assert.equal(profilePackage.dependencies?.['dsh-session-mesh'], `file:${tarball}`)
  assert.ok(profilePackage.dsh?.profile?.bundles?.includes('dsh-session-mesh'))

  const packedTools = run('tar', ['-xOf', tarball, 'package/lib/tools.js'])
  assert.doesNotMatch(packedTools, /get_current_session/)

  const config = run(dsh, ['--profile', 'web', '--dump-config'], { env })
  assert.match(config, /# == dsh-session-mesh/)
  assert.match(config, /- id: session-mesh\n\s+name: dsh-session-mesh/)

  console.log(`no-key DSH profile install smoke passed with ${dshVersion}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
