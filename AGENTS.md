# AGENTS.md

## Project Overview

`dsh-session-mesh` is a DSH Host plugin for ordinary durable session discovery, creation, and sessionId-addressed agent relay messaging. It targets DSH `0.1.2-rc.1`, Node `>=22`, pnpm, JavaScript with JSDoc checked by TypeScript, and Cordis Host services.

The Work line is the current implemented scope:

- List durable sessions with ordinary JSON rows.
- Return the current caller session identity.
- Create ordinary DSH sessions without sending a prompt.
- Send peer-agent relay messages to ordinary `sessionId` targets with generated provenance frontmatter.

Use `SESSION_MESH_DESIGN.md` as the product/design authority. Do not implement Better-line items unless the task explicitly asks for them.

## Setup Commands

- Install dependencies: `pnpm install`
- Verify JSDoc/checkJs types: `pnpm typecheck`
- Run tests: `pnpm test`

`lib/` is the shipped JavaScript source. TypeScript only validates JS/JSDoc with `noEmit`; do not add a compile/build step.

## Source Layout

- `lib/index.js`: Cordis plugin entry and tool registration.
- `lib/runtime.js`: Host service integration for sessions, agents, workspaces, creation, resume, and delivery.
- `lib/tools.js`: model tool schemas, argument parsing, output rendering.
- `lib/message.js`: model-visible `dsh-relay` envelope generation.
- `lib/types.js`: runtime error class.
- `types/host.d.ts`: shared JSDoc/checkJs contracts for Host services, tool data, and relay envelope models.
- `test/*.test.js`: Node test runner coverage for message framing and fake Host runtime flows.

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
```

Add or update tests when changing parser behavior, output JSON contracts, session filtering, creation semantics, resume behavior, delivery mode selection, or relay envelope/source shape.

## Code Style

- Keep JavaScript modules small and focused by runtime boundary; put shared contracts in `types/host.d.ts` and file-local types in JSDoc.
- Return only lossless JSON from tools; never expose DSH live objects.
- Keep comments rare and use them only for non-obvious lifecycle or trust-boundary logic.
- Do not add dependencies unless the current behavior or tests require them.

## Git Workflow

Use staged, logical commits. Conventional commit examples:

- `feat: add session relay messaging`
- `test: cover stopped session relay delivery`
- `docs: document session mesh usage`

Never rewrite history or remove user changes unless explicitly requested.
