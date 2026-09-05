#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

const kindValues = new Set(['bug', 'friction', 'docs', 'idea'])
const severityValues = new Set(['low', 'medium', 'high'])

function usage() {
  return `Usage:
  node scripts/report-feedback-issue.mjs --title <title> --body <text> [options]
  node scripts/report-feedback-issue.mjs --title <title> --body-file <path|-> [options]

Options:
  --kind <bug|friction|docs|idea>       Feedback kind. Default: friction
  --severity <low|medium|high>          Impact level. Default: medium
  --tool <name>                         Related dsh-session-mesh tool
  --thread-id <id>                      Related relay thread id
  --message-id <id>                     Related relay message id
  --session-id <id>                     Reporting or affected DSH session id
  --repo <owner/name>                   GitHub repo. Default: detected origin
  --label <name>                        Add one issue label; repeatable
  --dry-run                             Print the issue payload without creating it
  --help                                Show this help

Example:
  node scripts/report-feedback-issue.mjs \\
    --kind friction \\
    --tool get_session_thread \\
    --title "Thread render lacks enough context" \\
    --body "get_session_thread only showed counts, so I had to inspect sidecar files."`
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean | string[]>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean | string[]>} */
  const parsed = { label: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') parsed.help = true
    else if (arg === '--dry-run') parsed.dryRun = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => String(letter).toUpperCase())
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      if (key === 'label') {
        const labels = /** @type {string[]} */ (parsed.label)
        labels.push(next)
      } else {
        parsed[key] = next
      }
    } else {
      throw new Error(`unexpected positional argument: ${arg}`)
    }
  }
  return parsed
}

/**
 * @param {Record<string, string | boolean | string[]>} args
 * @param {string} key
 * @returns {string | undefined}
 */
function stringArg(args, key) {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`--${key} must be a string`)
}

/**
 * @param {string | undefined} value
 * @param {string} name
 * @param {Set<string>} values
 * @param {string} fallback
 * @returns {string}
 */
function enumArg(value, name, values, fallback) {
  const selected = value ?? fallback
  if (values.has(selected)) return selected
  throw new Error(`--${name} must be one of: ${[...values].join(', ')}`)
}

/** @returns {string} */
function detectRepo() {
  const remote = execFileSync('git', ['-C', repoRoot, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)
  if (ssh) return ssh[1]
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)
  if (https) return https[1]
  throw new Error(`could not detect GitHub repo from origin remote: ${remote}`)
}

/**
 * @param {string} file
 * @returns {string}
 */
function readBodyFile(file) {
  if (file === '-') return readFileSync(0, 'utf8')
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) throw new Error(`body file does not exist: ${path}`)
  return readFileSync(path, 'utf8')
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function metadata(value) {
  return value === undefined || value.trim() === '' ? '_not provided_' : value.trim()
}

/**
 * @param {{ kind: string, severity: string, tool?: string, threadId?: string, messageId?: string, sessionId?: string, body: string }} input
 * @returns {string}
 */
function issueBody(input) {
  return [
    '## DSH Session Mesh Feedback',
    '',
    `- Kind: ${input.kind}`,
    `- Severity: ${input.severity}`,
    `- Tool: ${metadata(input.tool)}`,
    `- SessionId: ${metadata(input.sessionId)}`,
    `- ThreadId: ${metadata(input.threadId)}`,
    `- MessageId: ${metadata(input.messageId)}`,
    '',
    '## Report',
    '',
    input.body.trim(),
    '',
    '## Agent Guidance',
    '',
    'This issue was filed from a local DSH agent after using `dsh-session-mesh`. Keep reproduction details concrete and avoid pasting secrets, credentials, or full session logs.',
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true) {
    console.log(usage())
    return
  }

  const title = stringArg(args, 'title')?.trim()
  if (title === undefined || title === '') throw new Error('--title is required')

  const bodyInline = stringArg(args, 'body')
  const bodyFile = stringArg(args, 'bodyFile')
  if ((bodyInline === undefined || bodyInline === '') && (bodyFile === undefined || bodyFile === '')) {
    throw new Error('--body or --body-file is required')
  }
  if (bodyInline !== undefined && bodyFile !== undefined) throw new Error('use only one of --body or --body-file')

  const kind = enumArg(stringArg(args, 'kind'), 'kind', kindValues, 'friction')
  const severity = enumArg(stringArg(args, 'severity'), 'severity', severityValues, 'medium')
  const repo = stringArg(args, 'repo') ?? detectRepo()
  const body = bodyInline ?? readBodyFile(/** @type {string} */ (bodyFile))
  const labels = /** @type {string[]} */ (args.label)
  const fullTitle = `[session-mesh ${kind}] ${title}`
  const fullBody = issueBody({
    kind,
    severity,
    tool: stringArg(args, 'tool'),
    threadId: stringArg(args, 'threadId'),
    messageId: stringArg(args, 'messageId'),
    sessionId: stringArg(args, 'sessionId'),
    body,
  })

  if (args.dryRun === true) {
    console.log(JSON.stringify({ repo, title: fullTitle, labels, body: fullBody }, null, 2))
    return
  }

  const ghArgs = ['issue', 'create', '--repo', repo, '--title', fullTitle, '--body', fullBody]
  for (const label of labels) ghArgs.push('--label', label)
  const result = spawnSync('gh', ghArgs, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`gh issue create failed with exit code ${result.status}`)
  }
  process.stdout.write(result.stdout)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
