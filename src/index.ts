import type { Context } from '@deepseek-ai/cordis'
import { SessionMeshRuntime } from './runtime.ts'
import { registerSessionMeshTools } from './tools.ts'

export const name = 'dsh-session-mesh'

export const inject = ['tools', 'agents'] as const

export function apply(ctx: Context): void {
  const runtime = new SessionMeshRuntime(ctx)
  registerSessionMeshTools(ctx, runtime)
}
