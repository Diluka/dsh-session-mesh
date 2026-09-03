import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-session-mesh'

export const inject = ['tools'] as const

const smokeTool: ToolDefinition = {
  name: 'session_mesh_smoke',
  description: 'Check that the dsh-session-mesh plugin is loaded.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'plugin'],
      properties: {
        ok: { type: 'boolean' },
        plugin: { type: 'string' },
      },
    },
    render: () => [{ type: 'text', text: 'dsh-session-mesh is loaded' }],
  },
  execute: async () => ({ ok: true, plugin: name }),
}

export function apply(ctx: Context): void {
  ctx.tools.register(smokeTool)
}
