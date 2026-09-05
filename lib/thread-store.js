/// <reference path="../types/host.d.ts" />

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STORE_VERSION = 1
const DEFAULT_PAGE_SIZE = 25
const DEFAULT_READ_LIMIT = 50
const MAX_READ_LIMIT = 100
const MAX_SUMMARY_LENGTH = 200
const SAFE_RELAY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const RELAY_ID_DESCRIPTION = '1-128 characters: letters, digits, underscore, or hyphen, starting with a letter or digit'

/** @returns {string} */
export function mintThreadId() {
  return `agt-${randomUUID()}`
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {string}
 */
export function assertRelayIdentifier(value, label) {
  if (SAFE_RELAY_ID.test(value)) return value
  throw new Error(`${label} must be ${RELAY_ID_DESCRIPTION}`)
}

/** @returns {string} */
function defaultRoot() {
  const configured = process.env.DSH_SESSION_MESH_THREAD_DIR
  if (configured !== undefined && configured !== '') return configured
  const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(dshHome, 'session-mesh', 'threads-v1')
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is { code?: unknown }}
 */
function hasCode(value) {
  return typeof value === 'object' && value !== null && 'code' in value
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function positiveInteger(value, fallback, max) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return Math.min(value, max)
  return Math.min(fallback, max)
}

/**
 * @param {string | undefined} value
 * @param {number} max
 * @returns {{ text?: string, truncated?: true }}
 */
function clipOptional(value, max) {
  if (value === undefined) return {}
  if (value.length <= max) return { text: value }
  return { text: value.slice(0, max), truncated: true }
}

/**
 * @param {SenderIdentity} sender
 * @returns {SenderIdentity}
 */
function copySender(sender) {
  return {
    sessionId: sender.sessionId,
    ...(sender.title === undefined ? {} : { title: sender.title }),
    ...(sender.cwd === undefined ? {} : { cwd: sender.cwd }),
    ...(sender.workspaceId === undefined ? {} : { workspaceId: sender.workspaceId }),
    ...(sender.workspaceTitle === undefined ? {} : { workspaceTitle: sender.workspaceTitle }),
    ...(sender.agentPreset === undefined ? {} : { agentPreset: sender.agentPreset }),
  }
}

/**
 * @param {RelayThreadAppendInput} input
 * @param {number} seq
 * @returns {RelayThreadMessage}
 */
function threadMessage(input, seq) {
  const summary = clipOptional(input.summary, MAX_SUMMARY_LENGTH)
  return {
    seq,
    threadId: input.threadId,
    messageId: input.messageId,
    sentAt: input.sentAt,
    from: copySender(input.from),
    to: { sessionId: input.to.sessionId },
    mode: input.mode,
    deliveredVia: input.deliveredVia,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
    ...(input.expectReply === undefined ? {} : { expectReply: input.expectReply }),
    ...(summary.text === undefined ? {} : { summary: summary.text }),
  }
}

/**
 * @param {string} file
 * @returns {Promise<unknown | undefined>}
 */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (hasCode(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | undefined}
 */
function optionalRecordString(value, field) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new Error(`thread index record has invalid ${field}`)
}

/**
 * @param {unknown} value
 * @returns {SenderIdentity}
 */
function readSender(value) {
  if (!isRecord(value) || typeof value.sessionId !== 'string') throw new Error('thread index record has invalid from')
  return {
    sessionId: value.sessionId,
    ...(value.title === undefined ? {} : { title: optionalRecordString(value.title, 'from.title') ?? '' }),
    ...(value.cwd === undefined ? {} : { cwd: optionalRecordString(value.cwd, 'from.cwd') ?? '' }),
    ...(value.workspaceId === undefined ? {} : { workspaceId: optionalRecordString(value.workspaceId, 'from.workspaceId') ?? '' }),
    ...(value.workspaceTitle === undefined ? {} : { workspaceTitle: optionalRecordString(value.workspaceTitle, 'from.workspaceTitle') ?? '' }),
    ...(value.agentPreset === undefined ? {} : { agentPreset: optionalRecordString(value.agentPreset, 'from.agentPreset') ?? '' }),
  }
}

/**
 * @param {unknown} value
 * @param {string} threadId
 * @returns {RelayThreadMessage}
 */
function readThreadMessage(value, threadId) {
  if (!isRecord(value)) throw new Error('thread index page has invalid message')
  const seq = value.seq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) throw new Error('thread index record has invalid seq')
  if (value.threadId !== threadId) throw new Error('thread index record belongs to another thread')
  const messageId = value.messageId
  if (typeof messageId !== 'string') throw new Error('thread index record has invalid messageId')
  const sentAt = value.sentAt
  if (typeof sentAt !== 'string') throw new Error('thread index record has invalid sentAt')
  if (!isRecord(value.to) || typeof value.to.sessionId !== 'string') throw new Error('thread index record has invalid to')
  const toSessionId = value.to.sessionId
  const mode = value.mode
  if (mode !== 'queue' && mode !== 'steer') throw new Error('thread index record has invalid mode')
  const deliveredVia = value.deliveredVia
  if (deliveredVia !== 'followup' && deliveredVia !== 'steer' && deliveredVia !== 'resume-followup' && deliveredVia !== 'resume-steer') {
    throw new Error('thread index record has invalid deliveredVia')
  }
  const expectReply = value.expectReply
  if (expectReply !== undefined && typeof expectReply !== 'boolean') throw new Error('thread index record has invalid expectReply')
  return {
    seq,
    threadId,
    messageId,
    sentAt,
    from: readSender(value.from),
    to: { sessionId: toSessionId },
    mode,
    deliveredVia,
    ...(value.inReplyTo === undefined ? {} : { inReplyTo: optionalRecordString(value.inReplyTo, 'inReplyTo') ?? '' }),
    ...(expectReply === undefined ? {} : { expectReply }),
    ...(value.summary === undefined ? {} : { summary: optionalRecordString(value.summary, 'summary') ?? '' }),
  }
}

/**
 * @param {unknown} value
 * @param {string} threadId
 * @returns {RelayThreadManifest}
 */
function readManifestRecord(value, threadId) {
  if (!isRecord(value) || value.version !== STORE_VERSION || value.threadId !== threadId) throw new Error('thread index manifest is invalid')
  const pageSize = value.pageSize
  if (typeof pageSize !== 'number' || !Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('thread index manifest has invalid pageSize')
  const messageCount = value.messageCount
  if (typeof messageCount !== 'number' || !Number.isSafeInteger(messageCount) || messageCount < 0) throw new Error('thread index manifest has invalid messageCount')
  const createdAt = value.createdAt
  const updatedAt = value.updatedAt
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') throw new Error('thread index manifest has invalid timestamps')
  const rawLatestSeq = value.latestSeq
  const latestSeq = typeof rawLatestSeq === 'number' && Number.isSafeInteger(rawLatestSeq) ? rawLatestSeq : messageCount
  if (latestSeq < 0) throw new Error('thread index manifest has invalid latestSeq')
  return {
    version: STORE_VERSION,
    threadId,
    pageSize,
    messageCount,
    createdAt,
    updatedAt,
    latestSeq,
  }
}

/**
 * @param {unknown} value
 * @param {string} threadId
 * @param {number} page
 * @param {number} startSeq
 * @returns {RelayThreadPage}
 */
function readPageRecord(value, threadId, page, startSeq) {
  if (!isRecord(value) || value.version !== STORE_VERSION || value.threadId !== threadId || value.page !== page) {
    throw new Error('thread index page is invalid')
  }
  if (!Array.isArray(value.messages)) throw new Error('thread index page has invalid messages')
  const rawStartSeq = value.startSeq
  return {
    version: STORE_VERSION,
    threadId,
    page,
    startSeq: typeof rawStartSeq === 'number' && Number.isSafeInteger(rawStartSeq) ? rawStartSeq : startSeq,
    messages: value.messages.map((entry) => readThreadMessage(entry, threadId)),
  }
}

export class RelayThreadStore {
  /** @type {string} */
  root

  /** @type {number} */
  pageSize

  /** @type {number} */
  maxReadLimit

  /** @type {Map<string, Promise<void>>} */
  queues = new Map()

  /** @param {RelayThreadStoreOptions} [options] */
  constructor(options = {}) {
    this.root = options.root ?? defaultRoot()
    this.pageSize = positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE, 100)
    this.maxReadLimit = positiveInteger(options.maxReadLimit, MAX_READ_LIMIT, 500)
  }

  /**
   * @param {RelayThreadAppendInput} input
   * @returns {Promise<void>}
   */
  append(input) {
    assertRelayIdentifier(input.threadId, 'threadId')
    assertRelayIdentifier(input.messageId, 'messageId')
    if (input.inReplyTo !== undefined) assertRelayIdentifier(input.inReplyTo, 'inReplyTo')
    return this.enqueue(input.threadId, () => this.appendNow(input))
  }

  /**
   * @param {GetSessionThreadArgs} args
   * @returns {Promise<GetSessionThreadResult>}
   */
  async readThread(args) {
    const threadId = assertRelayIdentifier(args.threadId, 'threadId')
    const limit = positiveInteger(args.limit, DEFAULT_READ_LIMIT, this.maxReadLimit)
    const manifest = await this.readManifest(threadId)
    if (manifest === undefined) return { threadId, messages: [], count: 0, total: 0 }
    const total = manifest.messageCount
    if (total === 0) return { threadId, messages: [], count: 0, total: 0, latestSeq: manifest.latestSeq }
    const firstSeq = Math.max(1, total - limit + 1)
    const firstPage = Math.floor((firstSeq - 1) / manifest.pageSize)
    const lastPage = Math.floor((total - 1) / manifest.pageSize)
    /** @type {RelayThreadMessage[]} */
    const messages = []
    for (let page = firstPage; page <= lastPage; page += 1) {
      const startSeq = page * manifest.pageSize + 1
      const record = await this.readPage(threadId, page, startSeq)
      for (const message of record.messages) {
        if (message.seq >= firstSeq && message.seq <= total) messages.push(message)
      }
    }
    const selected = messages.slice(-limit)
    return { threadId, messages: selected, count: selected.length, total, latestSeq: manifest.latestSeq }
  }

  /**
   * @private
   * @param {string} threadId
   * @param {() => Promise<void>} task
   * @returns {Promise<void>}
   */
  enqueue(threadId, task) {
    const previous = this.queues.get(threadId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    const tracked = current.finally(() => {
      if (this.queues.get(threadId) === tracked) this.queues.delete(threadId)
    })
    this.queues.set(threadId, tracked)
    return current
  }

  /**
   * @private
   * @param {RelayThreadAppendInput} input
   * @returns {Promise<void>}
   */
  async appendNow(input) {
    const manifest = await this.readManifest(input.threadId)
    const pageSize = manifest?.pageSize ?? this.pageSize
    const seq = (manifest?.messageCount ?? 0) + 1
    const page = Math.floor((seq - 1) / pageSize)
    const startSeq = page * pageSize + 1
    const pageRecord = await this.readPage(input.threadId, page, startSeq)
    pageRecord.messages = pageRecord.messages.filter((message) => message.seq < seq)
    pageRecord.messages.push(threadMessage(input, seq))
    await writeJsonAtomic(this.pagePath(input.threadId, page), pageRecord)
    await writeJsonAtomic(this.manifestPath(input.threadId), {
      version: STORE_VERSION,
      threadId: input.threadId,
      pageSize,
      messageCount: seq,
      createdAt: manifest?.createdAt ?? input.sentAt,
      updatedAt: input.sentAt,
      latestSeq: seq,
    })
  }

  /**
   * @private
   * @param {string} threadId
   * @returns {Promise<RelayThreadManifest | undefined>}
   */
  async readManifest(threadId) {
    const value = await readJson(this.manifestPath(threadId))
    return value === undefined ? undefined : readManifestRecord(value, threadId)
  }

  /**
   * @private
   * @param {string} threadId
   * @param {number} page
   * @param {number} startSeq
   * @returns {Promise<RelayThreadPage>}
   */
  async readPage(threadId, page, startSeq) {
    const value = await readJson(this.pagePath(threadId, page))
    if (value === undefined) return { version: STORE_VERSION, threadId, page, startSeq, messages: [] }
    return readPageRecord(value, threadId, page, startSeq)
  }

  /**
   * @private
   * @param {string} threadId
   * @returns {string}
   */
  threadDir(threadId) {
    return join(this.root, threadId)
  }

  /**
   * @private
   * @param {string} threadId
   * @returns {string}
   */
  manifestPath(threadId) {
    return join(this.threadDir(threadId), 'manifest.json')
  }

  /**
   * @private
   * @param {string} threadId
   * @param {number} page
   * @returns {string}
   */
  pagePath(threadId, page) {
    return join(this.threadDir(threadId), 'pages', `page-${String(page).padStart(6, '0')}.json`)
  }
}
