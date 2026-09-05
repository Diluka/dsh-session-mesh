# dsh-session-mesh

`dsh-session-mesh` is a DSH Host plugin for ordinary durable session discovery, creation, and sessionId-addressed agent relay messaging.

The plugin works with ordinary DSH sessions as the source of truth and keeps relay metadata visible in the delivered message body.

## Implemented Scope

The current plugin registers four model tools:

- `list_sessions`: list durable DSH sessions visible to the current Host, with filters for ids, cwd, title, workspace, status, origin, archive state, pagination, and sorting.
- `create_session`: create an ordinary DSH session by `cwd` or `workspaceId` without sending an initial prompt.
- `send_session_message`: send an agent relay message to an ordinary DSH `sessionId`, using `queue` or `steer`, and resuming stopped sessions when needed. Sender identity is derived internally from the calling agent; each send returns a `messageId` and `threadId`.
- `get_session_thread`: read this plugin's persisted relay-thread index by `threadId` without scanning session logs.

## Relay Format

Agent relay messages are delivered through the ordinary DSH session prompt carrier. The target agent receives one message whose first text block contains a generated YAML frontmatter envelope followed by the request body.

Every relay message includes:

- A generic DSH plugin message source for provenance only.
- A model-visible `dsh-relay` frontmatter envelope with `messageId`, `threadId`, sender session identity, and delivery mode for post-processing.
- The caller-provided request body after the envelope, in the same text block and same delivered message.

Work-stage delivery rejects archived sessions, self-delivery, and non-ordinary session origins.

## Replying To A Relay

A target agent can reply using only the received frontmatter:

```yaml
dsh-relay:
  messageId: "agm-parent"
  threadId: "agt-thread"
  fromSessionId: "session-sender"
```

Call `send_session_message` with this mapping:

```json
{
  "sessionId": "session-sender",
  "threadId": "agt-thread",
  "inReplyTo": "agm-parent",
  "message": "Reply body",
  "summary": "Short reply summary"
}
```

Use `summary` as the semantic thread breadcrumb. `get_session_thread` stores and renders receipt metadata plus bounded summaries, not message bodies.

## Relay Thread Index

`send_session_message` writes a small sidecar index for relay receipts under `${DSH_HOME:-~/.dsh}/session-mesh/threads-v1` by default. The index is organized by exact `threadId` with fixed-size pages, so `get_session_thread` reads only the target thread manifest and the pages needed for the requested latest summaries. The index stores relay metadata and bounded caller-provided `summary` values; it does not copy message bodies or DSH session logs.

Delivery and indexing are reported separately: a message can be accepted by the target session while `threadIndexed` is `false` if the sidecar write fails. The current sidecar assumes one DSH Host process writes a given thread at a time.

## Feedback Issues

Local agents can file actionable bugs or friction reports against this repository with:

```bash
pnpm issue:feedback -- --kind friction --tool get_session_thread --title "Short title" --body "What happened, expected behavior, and reproduction notes."
```

Use `--dry-run` first when checking formatting. The script uses `gh issue create`, detects the GitHub repo from `origin`, and adds metadata fields for `tool`, `sessionId`, `threadId`, and `messageId` when provided.

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

`pnpm test:e2e:no-key` expects a `dsh` CLI on `PATH`; the GitHub Actions workflow installs `@deepseek-ai/dsh@0.1.2-rc.1` for this step. It packs the plugin, installs the tarball into a temporary headless profile, starts DSH with a fake LLM adapter, and executes the real `list_sessions`, `create_session`, `send_session_message`, and `get_session_thread` tools through the Host `tools` service.

The plugin ships source directly from `lib/**/*.js`. TypeScript is used only for `checkJs`/JSDoc validation with `noEmit`; there is no build step or generated `lib/` output.

## DSH Bundle Patch

The package declares `dsh.bundle.patch` in `package.json`. Installing the bundle applies `cordis.patch.yml`, which inserts this plugin row:

```yaml
- insert:
    - id: session-mesh
      name: 'dsh-session-mesh'
```

## Design

The durable design artifact is `SESSION_MESH_DESIGN.md`. Implement Better-line items only after the Work-line behavior stays covered by tests and DSH runtime verification.
