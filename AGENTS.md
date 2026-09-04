# AGENTS.md

## Project Overview

`dsh-session-mesh` is a DSH Host plugin for ordinary durable session discovery, creation, and sessionId-addressed agent relay messaging. It targets DSH `0.1.1-rc.2`, Node `>=22`, pnpm, TypeScript, and Cordis Host services.

The Work line is the current implemented scope:

- List durable sessions with ordinary JSON rows.
- Return the current caller session identity.
- Create ordinary DSH sessions without sending a prompt.
- Send peer-agent relay messages to ordinary `sessionId` targets with generated provenance frontmatter.

Use `SESSION_MESH_DESIGN.md` as the product/design authority. Do not implement Better-line items unless the task explicitly asks for them.

## Setup Commands

- Install dependencies: `pnpm install`
- Typecheck source: `pnpm typecheck`
- Run tests: `pnpm test`
- Build package output: `pnpm build`

`lib/` is generated build output and is ignored by Git.

## Source Layout

- `src/index.ts`: Cordis plugin entry and tool registration.
- `src/runtime.ts`: Host service integration for sessions, agents, workspaces, creation, resume, and delivery.
- `src/tools.ts`: model tool schemas, argument parsing, output rendering.
- `src/message.ts`: model-visible `dsh-relay` envelope generation.
- `src/types.ts`: JSON contracts for tools and relay envelope data.
- `test/*.test.ts`: Node test runner coverage for message framing and fake Host runtime flows.

## Runtime Boundaries

- This is a Host plugin only. Add Client UI only for an explicitly requested Better-line task.
- Prefer `ctx.get('serviceName')` for optional DSH services and handle absence with clear errors.
- Use `ctx.agents.create` for ordinary session creation and `ctx.agents.resume` for stopped-session delivery.
- Use `sessionQuery` and `workspaceRegistry` as the session/workspace source of truth. Do not create a second session database.
- Sender identity must come from the caller `ToolRunContext.agent`; tool args must not accept `fromSessionId`, `sender`, `source`, or equivalent fields.
- Relay text must keep the generated `dsh-relay` envelope visible to the receiving model.

## Testing Instructions

Run the full local suite before committing:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Add or update tests when changing parser behavior, output JSON contracts, session filtering, creation semantics, resume behavior, delivery mode selection, or relay envelope/source shape.

## Code Style

- Keep TypeScript modules small and focused by runtime boundary.
- Return only lossless JSON from tools; never expose DSH live objects.
- Keep comments rare and use them only for non-obvious lifecycle or trust-boundary logic.
- Do not add dependencies unless the current behavior or tests require them.

## Git Workflow

Use staged, logical commits. Conventional commit examples:

- `feat: add session relay messaging`
- `test: cover stopped session relay delivery`
- `docs: document session mesh usage`

Never rewrite history or remove user changes unless explicitly requested.
