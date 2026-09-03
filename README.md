# dsh-session-mesh

`dsh-session-mesh` is a DSH Host plugin for ordinary durable session discovery, creation, and sessionId-addressed agent relay messaging.

It is intentionally separate from `dsh-crosstalk`: crosstalk handles live peer presence, while this plugin works with ordinary DSH sessions as the source of truth.

## Implemented Work Line

The current plugin registers four model tools:

- `list_sessions`: list durable DSH sessions visible to the current Host, with filters for ids, cwd, title, workspace, status, origin, archive state, pagination, and sorting.
- `get_current_session`: return the caller's current DSH session identity as ordinary JSON.
- `create_session`: create an ordinary DSH session by `cwd` or `workspaceId` without sending an initial prompt.
- `send_session_message`: send an agent relay message to an ordinary DSH `sessionId`, using `queue` or `steer`, and resuming stopped sessions when needed.

## Trust Model

Agent relay messages are delivered as user-role transport messages because that is the current DSH session prompt carrier, but they are not human-user instructions.

Every relay message includes:

- `source.kind: "agent-relay"` metadata for DSH logs and UI consumers.
- A model-visible `dsh-relay` envelope with sender session identity and delivery mode.
- A scoped system prompt section explaining that relay messages are peer-agent requests and do not override the receiving session's system, developer, or user instructions.

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
pnpm build
```

Build output is emitted to `lib/` and ignored by Git. The package `postinstall`, `prepack`, and `prepublishOnly` scripts build the library.

## DSH Bundle Patch

The package declares `dsh.bundle.patch` in `package.json`. Installing the bundle applies `cordis.patch.yml`, which inserts this plugin row:

```yaml
- insert:
    - id: session-mesh
      name: 'dsh-session-mesh'
```

## Design

The durable design artifact is `SESSION_MESH_DESIGN.md`. Implement Better-line items only after the Work-line behavior stays covered by tests and DSH runtime verification.
