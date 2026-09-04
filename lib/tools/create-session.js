/// <reference path="../../types/host.d.ts" />

import { isRecord, optionalString } from './common.js'

/** @typedef {import('../runtime.js').SessionMeshRuntime} SessionMeshRuntime */

/**
 * @param {unknown} args
 * @returns {CreateSessionArgs}
 */
function parseCreateSessionArgs(args) {
  if (args === undefined) return {}
  if (!isRecord(args)) throw new Error('create_session arguments must be an object')
  const cwd = optionalString(args.cwd, 'create_session: cwd must be a string')
  const workspaceId = optionalString(args.workspaceId, 'create_session: workspaceId must be a string')
  const title = optionalString(args.title, 'create_session: title must be a string')
  const agentPreset = optionalString(args.agentPreset, 'create_session: agentPreset must be a string')
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(title === undefined ? {} : { title }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
  }
}

/**
 * @param {SessionMeshRuntime} runtime
 * @returns {DshToolDefinition}
 */
export function buildCreateSessionTool(runtime) {
  return {
    name: 'create_session',
    description: 'Create an ordinary DSH session without sending a prompt. Use cwd or workspaceId, not both.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'Absolute working directory for the new session.' },
        workspaceId: { type: 'string', description: 'Workspace to create the session in.' },
        title: { type: 'string', description: 'Optional title to set after creation.' },
        agentPreset: { type: 'string', description: 'Optional preset id; omitted uses the DSH default preset.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId', 'status', 'created'],
        properties: {
          sessionId: { type: 'string' },
          status: { type: 'string', enum: ['stopped', 'idle'] },
          cwd: { type: 'string' },
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          agentPreset: { type: 'string' },
          created: { type: 'boolean' },
        },
      },
      /**
       * @param {unknown} _args
       * @param {DshJsonValue} value
       */
      render(_args, value) {
        const result = /** @type {{ sessionId: string, status: string, cwd?: string, workspaceId?: string }} */ (/** @type {unknown} */ (value))
        const where = result.workspaceId ?? result.cwd ?? '(default cwd)'
        return [{ type: 'text', text: `created ${result.sessionId} [${result.status}] - ${where}` }]
      },
    },
    /**
     * @param {unknown} rawArgs
     * @param {DshToolRunContext} exec
     */
    async execute(rawArgs, exec) {
      return runtime.createSession(parseCreateSessionArgs(rawArgs), exec.agent, exec.signal)
    },
  }
}
