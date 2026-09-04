/// <reference path="../types/host.d.ts" />

import { SessionMeshRuntime } from './runtime.js'
import { registerSessionMeshTools } from './tools.js'

export const name = 'dsh-session-mesh'

/** @type {readonly ['tools', 'agents']} */
export const inject = ['tools', 'agents']

/** @param {SessionMeshHostContext} ctx */
export function apply(ctx) {
  const runtime = new SessionMeshRuntime(ctx)
  registerSessionMeshTools(ctx, runtime)
}
