# dsh-session-mesh

`dsh-session-mesh` is a DSH Host plugin for ordinary durable session discovery, creation, and sessionId-addressed agent relay messaging.

It is intentionally separate from `dsh-crosstalk`: crosstalk handles live peer presence, while this plugin works with ordinary DSH sessions as the source of truth.

## Implemented Work Line

The current plugin registers three model tools:

- `list_sessions`: list durable DSH sessions visible to the current Host, with filters for ids, cwd, title, workspace, status, origin, archive state, pagination, and sorting.
- `create_session`: create an ordinary DSH session by `cwd` or `workspaceId` without sending an initial prompt.
- `send_session_message`: send an agent relay message to an ordinary DSH `sessionId`, using `queue` or `steer`, and resuming stopped sessions when needed. Sender identity is derived internally from the calling agent.

## Relay Format

Agent relay messages are delivered through the ordinary DSH session prompt carrier. The target agent receives one message whose first text block contains a generated YAML frontmatter envelope followed by the request body.

Every relay message includes:

- A generic DSH plugin message source for provenance only.
- A model-visible `dsh-relay` frontmatter envelope with sender session identity and delivery mode for post-processing.
- The caller-provided request body after the envelope, in the same text block and same delivered message.

Work-stage delivery rejects archived sessions, self-delivery, and non-ordinary session origins.

## Development

Install dependencies:

```bash
pnpm install
```

Run checks:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e:no-key
```

`pnpm test:e2e:no-key` expects a `dsh` CLI on `PATH`; the GitHub Actions workflow installs `@deepseek-ai/dsh@0.1.2-rc.1` for this step.

The plugin ships source directly from `lib/*.js`. TypeScript is used only for `checkJs`/JSDoc validation with `noEmit`; there is no build step or generated `lib/` output.

## DSH Bundle Patch

The package declares `dsh.bundle.patch` in `package.json`. Installing the bundle applies `cordis.patch.yml`, which inserts this plugin row:

```yaml
- insert:
    - id: session-mesh
      name: 'dsh-session-mesh'
```

## Design

The durable design artifact is `SESSION_MESH_DESIGN.md`. Implement Better-line items only after the Work-line behavior stays covered by tests and DSH runtime verification.
