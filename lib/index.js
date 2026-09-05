/// <reference path="../types/host.d.ts" />

import { SessionMeshRuntime } from './runtime.js'
import { buildCreateSessionTool } from './tools/create-session.js'
import { buildGetSessionThreadTool } from './tools/get-session-thread.js'
import { buildListSessionsTool } from './tools/list-sessions.js'
import { buildSendSessionMessageTool } from './tools/send-session-message.js'

export const name = 'dsh-session-mesh'

/** @type {readonly ['tools', 'agents']} */
export const inject = ['tools', 'agents']

/** @param {SessionMeshHostContext} ctx */
export function apply(ctx) {
  const runtime = new SessionMeshRuntime(ctx)
  ctx.tools.register(buildListSessionsTool(runtime))
  ctx.tools.register(buildCreateSessionTool(runtime))
  ctx.tools.register(buildSendSessionMessageTool(runtime))
  ctx.tools.register(buildGetSessionThreadTool(runtime))
}
