# DSH Session Mesh 独立插件设计

## 目标

`dsh-session-mesh` 是一个面向普通 DSH 会话的独立插件。它让代理可以发现、创建并向任意可寻址 DSH 会话发送代理消息，而不是只能给父子关系里的 subagent 发消息，或只能给安装了 `dsh-crosstalk` 的在线 peer 发消息。

这里的“无限制交叉通信”指工具寻址模型足够开放：任意普通 sessionId 都可以成为目标，目标可以是 `running`、`idle` 或 `stopped`，通信不依赖父子层级、不依赖 crosstalk registry、不要求目标已经在线。实际执行仍遵守 DSH host、同一用户、当前会话权限、sandbox/approval、系统/开发者/用户指令边界。

核心产品目标：

- 代理能列出当前 DSH host 可见的普通 durable sessions。
- 代理能创建普通 DSH session，并拿到后续可寻址的 `sessionId`。
- 代理能按 `sessionId` 向任何普通 DSH session 投递消息。
- 接收方清楚知道消息来自哪个代理/会话。
- 代理消息不会伪装成人类用户消息，不会获得用户指令的权威级别。
- 插件能力按里程碑渐进：先完成可工作的最小闭环，再补产品化、安全治理和协作效率。

## 插件边界

建议新建独立仓库和独立插件，例如：

```text
dsh-session-mesh
```

不要把这些能力继续塞进 `dsh-crosstalk`。

`dsh-crosstalk` 的核心职责是本地 peer presence 与 inbox relay：安装了同一插件的在线会话发布心跳，互相按 peer name/ref 通信。`dsh-session-mesh` 的核心职责是普通 DSH session 生命周期与 sessionId 路由：列出 durable sessions、创建普通会话、恢复 stopped 会话并投递代理消息。

两者可以共存：

- `dsh-crosstalk` 保留 `list_agents({ scope: "peers" })` 和 peer name/ref 消息。
- `dsh-session-mesh` 提供独立工具 `list_sessions`、`create_session`、`send_session_message`。
- 原生 `list_agents` / `send_message` 语义保持稳定。
- 普通 session/workspace 系统是唯一权威状态源；插件不写第二套普通会话数据库。

## 设计原则

- **显式副作用**：创建会话、唤醒会话、打断运行中会话都必须在工具名或参数中表达清楚。
- **身份不可伪造**：发送者身份由插件从当前运行上下文读取，工具参数不能传入 `fromSessionId`、`source`、`sender` 之类字段。
- **通信与创建分离**：`create_session` 默认只创建，不自动发送初始消息；需要触发目标运行时再显式调用 `send_session_message`。
- **先普通 JSON**：工具返回普通 JSON 或可读文本，不把 DSH live object、service、event、fiber、snapshot 整体返回给模型。
- **先 Host 后 Client**：MVP 在 Host 侧完成真实能力；Client UI、消息卡片、session picker 放到 Better 阶段。
- **先可工作后治理**：Work 阶段建立闭环；Better 阶段增加 UI、权限策略、批量编排、线程化和观测。

## 状态模型

### Session row

`list_sessions` 返回普通 JSON 行。

```ts
type SessionStatus = "running" | "idle" | "stopped"
type SessionOrigin = "user" | "subagent" | "unknown"

type SessionRow = {
  sessionId: string
  status: SessionStatus
  origin: SessionOrigin
  cwd?: string
  title?: string
  workspaceId?: string
  workspaceTitle?: string
  workspacePath?: string
  agentPreset?: string
  archived: boolean
  self: boolean
  createdAt: number
  updatedAt?: number
}
```

说明：

- `status` 表示当前是否有 live agent，以及 live agent 是否正在运行。
- `origin` 描述会话来源，用于区分普通会话、subagent 会话和未知来源。
- `archived` 来自 DSH workspace/archive 状态。
- `self` 标记当前工具调用者所在 session。
- `updatedAt` 只有在轻量元数据来源能提供时才返回；不能为了列表默认展示去读取完整事件日志，排序取不到时回退到 `createdAt`。

### Sender identity

发送方身份由插件生成。

```ts
type SenderIdentity = {
  sessionId: string
  title?: string
  cwd?: string
  workspaceId?: string
  workspaceTitle?: string
  agentPreset?: string
}
```

目标消息记录把可解析来源拼接进正文开头：

- DSH message `source` 只使用普通插件 provenance，例如 `{ kind: "plugin", plugin: "dsh-session-mesh" }`。
- 代理来源、目标、messageId、投递方式等 agent-relay 信息只放在模型可见的 YAML frontmatter envelope 中，供目标模型和后处理器读取。

### Relay envelope data

正文 frontmatter 承载的数据形态：

```ts
type RelayEnvelopeData = {
  transport: "session.prompt"
  messageId: string
  from: SenderIdentity
  to: { sessionId: string }
  mode: "queue" | "steer"
  sentAt: string
  inReplyTo?: string
  threadId?: string
}
```

当前 DSH 传输层用 `role: "user"` 承载 `agent.followup()` / `session.prompt()`；`role` 是兼容传输字段，agent-relay 语义由正文 frontmatter 表达。

## Work 里程碑：先实现能工作的闭环

Work 阶段目标是打通最小但真实可用的代理横向通信闭环：能列、能建、能发、能恢复 stopped session，且接收端能看到来源和信任边界。

### W0：插件骨架与 Host 能力确认

目标：建立新仓库、新插件包、基础测试和真实 Host 接缝。

实现内容：

- 新仓库 `dsh-session-mesh`。
- Cordis Host 插件入口。
- 工具注册基础设施。
- 测试 harness：fake `sessionQuery`、`workspaceRegistry`、`agents`、`agentPresets`。
- 运行时能力探测：确认当前 DSH 版本可访问 `sessionQuery`、`workspaceRegistry`、`agents`、`agentPresets`。
- 明确普通 session 创建能力的来源：优先使用 Host 侧正式服务；如果只有 Web `session.create`，先补 Host service，而不是长期依赖 HTTP 网关 hack。

验收：

- 插件能加载并注册一个只读 smoke tool。
- 单测能覆盖工具注册和 Cordis lifecycle dispose。
- 文档记录当前 DSH 版本与可用 Host 服务。

### W1：`list_sessions`

只读列出当前 DSH host 可见的 durable sessions。

参数：

```ts
type ListSessionsArgs = {
  sessions?: {
    query?: string
    ids?: string[]
    workspaceIds?: string[]
    workspacePaths?: string[]
    cwd?: string
    title?: string
    statuses?: Array<"running" | "idle" | "stopped">
    origins?: Array<"user" | "subagent" | "unknown">
    archived?: "exclude" | "include" | "only"
    includeSelf?: boolean
    limit?: number
    offset?: number
    sort?: {
      by?: "createdAt" | "updatedAt" | "title" | "cwd" | "workspace"
      order?: "asc" | "desc"
    }
  }
}
```

返回：

```ts
type ListSessionsResult = {
  items: SessionRow[]
  total?: number
  nextOffset?: number
}
```

行为：

- 默认 `archived: "exclude"`。
- 默认 `includeSelf: true`。
- 默认 `limit: 20`，上限建议 100。
- `query` 在 `sessionId`、`title`、`cwd`、workspace 字段上做宽松匹配。
- `statuses` 区分 live agent 状态与 durable stopped 状态。
- `origins` 支持先列出 subagent-origin，但 Work 阶段只保证普通 session 可作为发送目标。

验收：

- 能列出当前会话、其它 live 会话、stopped durable 会话。
- 能按 `sessionId`、`cwd`、`status`、`archived` 过滤。
- 不返回 DSH 内部 live object。

### W2：当前 session 身份处理

公开 `get_current_session` 工具已从 Work 阶段移除。它的价值只是降低人工复制 `sessionId` 的摩擦，但会增加模型无谓调用面；如果实现走全局 session 查询，还可能在大量历史会话下触发过重的标题或事件日志读取。

Work 阶段保留的规则：

- `send_session_message` 的发送者身份必须由插件从当前 `ToolRunContext.agent` 内部派生。
- 发送者身份写入 relay frontmatter，供目标会话回复或后处理。
- 需要人工找当前会话时，用 `list_sessions` 的普通列表/过滤能力，不提供单独公开工具。

### W3：`create_session`

创建普通 DSH session。这个工具是写操作，但默认不触发模型运行。

参数：

```ts
type CreateSessionArgs = {
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
}
```

返回：

```ts
type CreateSessionResult = {
  sessionId: string
  status: "stopped" | "idle"
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
  created: true
}
```

行为：

- `cwd` 与 `workspaceId` 二选一。
- `cwd` 建议要求绝对路径。
- 未指定 `agentPreset` 时使用 DSH 默认 preset；如果实现选择继承当前 preset，必须在返回值中明确。
- `title` 存在时，创建后通过 DSH rename 能力设置标题。
- 创建后返回 `sessionId`，不自动发送初始消息。
- 创建失败必须明确区分路径无效、workspace 不存在、preset 不存在、Host create 服务不可用。

验收：

- 能在指定 `cwd` 创建普通 session。
- 能在指定 `workspaceId` 创建普通 session。
- 创建后 `list_sessions({ ids: [sessionId] })` 能看到它。
- 创建动作不会自动触发 agent turn。

### W4：`send_session_message`

向一个 DSH sessionId 投递代理消息。这个工具是真实副作用：可能唤醒 stopped/idle 会话，也可能按 `steer` 打断 running 会话。

参数：

```ts
type SendSessionMessageArgs = {
  sessionId: string
  message: string
  summary?: string
  mode?: "queue" | "steer"
  expectReply?: boolean
  inReplyTo?: string
}
```

返回：

```ts
type SendSessionMessageResult = {
  messageId: string
  accepted: true
  mode: "queue" | "steer"
  to: SessionRow
  from: SenderIdentity
  deliveredVia: "followup" | "steer" | "resume-followup" | "resume-steer"
}
```

行为：

- 默认 `mode: "queue"`。
- `queue`：目标 idle/stopped 时唤醒并追加一个 turn；目标 running 时排到当前 turn 后。
- `steer`：目标 running 时请求打断并插入消息；目标 idle/stopped 时等价于一次立即唤醒投递。
- stopped 目标通过 `agents.resume({ resumeSessionId })` 恢复，再投递消息。
- archived 目标在 Work 阶段拒绝投递。
- self-message 在 Work 阶段默认拒绝，减少自激循环。
- `summary` 用于 UI/工具卡展示，不参与身份认证。
- `expectReply` 只表达协作意图，插件不等待回复。
- `inReplyTo` 关联上游 relay message id。
- 工具调用者不能传入任何发送者身份字段。

失败码：

```ts
type SendSessionMessageErrorCode =
  | "session-not-found"
  | "archived-session"
  | "self-message"
  | "resume-failed"
  | "delivery-failed"
  | "unsupported-origin"
```

验收：

- 能向 live ordinary session 发送 `queue` 消息。
- 能恢复 stopped ordinary session 并发送 `queue` 消息。
- 能向 running ordinary session 发送 `steer` 消息。
- 返回值能说明实际走了 `followup`、`steer`、`resume-followup` 或 `resume-steer`。
- 目标模型上下文包含 agent relay envelope。

### W5：结构化来源 frontmatter

Work 阶段的目标会话需要收到一条普通代理消息，同时消息开头保留可后处理的结构化来源信息。

模型可见 envelope 由插件生成，并使用 YAML frontmatter 形式：

```yaml
---
dsh-relay:
  kind: "agent-message"
  messageId: "agm-..."
  fromSessionId: "session-..."
  fromTitle: "..."
  fromCwd: "/path/to/repo"
  sentAt: "2026-..."
  delivery: "session.prompt"
  mode: "queue"
---
```

正文跟在 envelope 后面。frontmatter 与正文必须在同一条 delivered message 的同一个 text block 内，方便目标 agent 正常处理请求，也方便后处理器按 `dsh-relay` 读取来源。

验收：

- 目标会话收到的文本包含 YAML frontmatter 形式的 `dsh-relay` envelope。
- frontmatter 和正文位于同一条消息的同一个 text block。
- envelope 不包含会让目标代理降权处理请求的 `trust` 字段。
- 工具调用者不能覆盖 envelope 的 `from*` 字段。

### W6：Work 阶段集成验证

Work 阶段最终要证明真实闭环可用。

建议验证脚本：

1. `list_sessions` 查到当前 session。
2. `create_session({ cwd })` 创建测试 ordinary session。
3. `list_sessions({ ids: [newSessionId] })` 查到新 session。
4. `send_session_message({ sessionId: newSessionId, message, mode: "queue" })` 唤醒目标。
5. 目标 session 看到 agent relay envelope 和发送者身份。
6. 目标通过 `send_session_message` 回复源 session。
7. `send_session_message({ sessionId: runningSessionId, mode: "steer" })` 走 steer 路径。
8. 插件 stop/update 后工具和提示词清理。

Work 完成定义：

- 三个核心能力 `list_sessions`、`create_session`、`send_session_message` 可用。
- 普通会话创建和消息投递在真实 DSH host 上跑通。
- stopped session resume 投递跑通。
- agent relay 反伪装语义在模型上下文中可见。
- 插件生命周期清理通过测试。

## Better 里程碑：再实现更好用、更安全、更产品化

Better 阶段建立在 Work 闭环之上。每个 Better 能力都应独立可交付，不阻塞 Work 发布。

### B1：Client 消息卡片与 session picker

目标：让人类用户和目标代理都更容易看懂代理消息来源。

能力：

- Client 侧 agent relay 消息卡片。
- 卡片标题显示 `fromTitle || fromSessionId` 和 `fromCwd`。
- 卡片区分 `queue` / `steer` / `resume`。
- session picker UI：按 workspace、cwd、title、status 搜索目标。
- 创建成功后提供“打开 session”或“复制 sessionId”的 UI 动作。

验收：

- relay 消息不显示成普通用户气泡。
- UI 中能一眼看到发送者和投递模式。
- 从 UI 选择 session 后，工具参数仍只传目标 identity，不允许覆盖 sender identity。

### B2：线程、回复和会话协作上下文

目标：让多代理交叉通信不会变成散乱 ping-pong。

工具增强：

```ts
type SendSessionMessageArgs = {
  sessionId: string
  message: string
  summary?: string
  mode?: "queue" | "steer"
  expectReply?: boolean
  inReplyTo?: string
  threadId?: string
  replyTo?: string
}
```

新增只读工具可选：

```ts
type GetSessionThreadArgs = {
  threadId: string
  limit?: number
}
```

行为：

- 每条 relay message 有 `messageId`。
- 回复携带 `inReplyTo`。
- 多轮协作携带 `threadId`。
- `expectReply` 可让 UI 标记“等待对方回复”，但插件不阻塞等待。

验收：

- A→B→A 往返能在 metadata 中关联。
- 多个 target 并行时能按 thread 区分。
- 目标 agent 可从 envelope 直接知道如何回复。

### B3：批量发送与 fanout

目标：支持协调者同时给多个普通会话派任务。

新增工具：

```ts
type BroadcastSessionMessageArgs = {
  targets: Array<{ sessionId: string }>
  message: string
  summary?: string
  mode?: "queue" | "steer"
  threadId?: string
  stopOnError?: boolean
}
```

返回：

```ts
type BroadcastSessionMessageResult = {
  threadId: string
  results: Array<{
    sessionId: string
    ok: boolean
    messageId?: string
    errorCode?: string
  }>
}
```

行为：

- 每个目标生成独立 `messageId`。
- 默认部分成功，返回每个目标的结果。
- `stopOnError` 用于严格流程。
- 批量 steer 要在工具说明中明确高副作用。

验收：

- 多目标 queue fanout 可用。
- 部分失败不会吞掉其它目标结果。
- 结果能用于后续逐个追踪回复。

### B4：显式 Worker 创建便利工具

Work 阶段把创建和发送分离。Better 阶段可以增加便利复合工具，但必须把两个副作用都写进名称和返回值。

新增工具：

```ts
type StartSessionTaskArgs = {
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
  message: string
  summary?: string
  threadId?: string
}
```

返回：

```ts
type StartSessionTaskResult = {
  session: CreateSessionResult
  delivery: SendSessionMessageResult
}
```

行为：

- 显式表示“创建 session 并发送任务”。
- 默认 `queue`，不支持隐式 `steer`。
- 失败时清晰报告卡在哪一步：创建失败或发送失败。
- 是否自动清理创建后发送失败的 session 需要产品决策；默认保留并返回 sessionId，避免悄悄删除用户可见对象。

验收：

- 单次工具调用能创建 worker session 并投递初始任务。
- 返回值包含创建和投递两个结果。
- 工具说明明确它会创建普通会话并触发 agent 运行。

### B5：结构化任务协议与结果收集

目标：让代理间通信从自由文本升级为可追踪的任务协议，但不强迫 Work 阶段一开始就做复杂编排。

消息类型增强：

```ts
type AgentMessageKind = "request" | "reply" | "notice" | "task" | "result" | "handoff"

type SendSessionMessageArgs = {
  sessionId: string
  message: string
  summary?: string
  mode?: "queue" | "steer"
  kind?: AgentMessageKind
  expectReply?: boolean
  inReplyTo?: string
  threadId?: string
  replyTo?: string
  resultSchemaName?: string
}
```

新增只读工具可选：

```ts
type CollectSessionRepliesArgs = {
  threadId: string
  sinceMessageId?: string
  limit?: number
}
```

行为：

- `kind` 默认为 `request`。
- `task` 表示希望目标完成工作并回复结果。
- `result` 表示对某个 `task` 的完成回传。
- `handoff` 表示转交上下文或继续工作建议。
- `resultSchemaName` 只声明预期，不在 Work 阶段做强校验；后续可接入 JSON schema 或 tool-output parser。
- `collect_session_replies` 从 session log 或可重建索引读取 thread 下的回复摘要。

验收：

- A 发 `task` 给 B，B 回 `result`，metadata 能串起 `threadId` 和 `inReplyTo`。
- 自由文本消息仍然可用。
- 结果收集是只读，不阻塞等待模型运行。

### B6：普通会话生命周期工具

目标：支持代理创建出来的普通会话被命名、fork、归档和管理，避免 worker 会话越来越难识别。

可选工具：

```ts
type ForkSessionArgs = {
  sessionId: string
  title?: string
}

type RenameSessionArgs = {
  sessionId: string
  title: string
}

type ArchiveSessionArgs = {
  sessionId: string
  reason?: string
}
```

行为：

- `fork_session` 基于已有会话创建普通 fork，用于把一个上下文分叉成 worker。
- `rename_session` 给创建出来的 worker 设置可读标题。
- `archive_session` 是显式生命周期动作，不和消息投递混在一起。
- `delete_session` 不进入默认 Better 工具；如果后续需要，应作为高风险管理工具单独设计。

验收：

- fork 出来的 session 可被 `list_sessions` 看到并被 `send_session_message` 寻址。
- rename 后 `list_sessions` 显示新标题。
- archive 后默认不能继续投递，除非策略显式允许。

### B7：策略、权限和循环防护

目标：让“无限制交叉通信”可配置，同时避免自激循环、批量误发和不合适的打断。

配置建议：

```ts
type SessionMeshConfig = {
  allowCreateSession: boolean
  allowSendToStopped: boolean
  allowSteer: boolean
  allowArchived: boolean
  allowSelf: boolean
  targetPolicy: "same-user" | "workspace" | "allowlist"
  allowlist?: Array<{
    sessionId?: string
    workspaceId?: string
    cwdGlob?: string
  }>
  maxFanout?: number
  maxRelayHops?: number
}
```

消息 metadata 增强：

```ts
type RelayLoopFields = {
  traceId: string
  hopCount: number
  maxHops: number
}
```

行为：

- 默认 `same-user`，匹配 DSH 本地使用模型。
- `allowSteer` 可默认开启，但工具说明必须强调打断副作用。
- `allowArchived` 默认关闭。
- `allowSelf` 默认关闭。
- `maxFanout` 限制批量广播规模。
- `maxRelayHops` 限制代理之间自动转发的跳数，默认建议 4。
- 插件只限制 relay 自动转发链路；人类用户直接继续对话不受这个计数影响。

验收：

- 配置可限制创建、steer、stopped resume、archived 目标、自发消息。
- 批量发送超过 `maxFanout` 时拒绝。
- relay hop 超限时拒绝继续自动转发，并在错误里返回 `traceId`。
- 拒绝时返回明确错误码和原因。

### B8：收件箱、未读和通知

目标：让代理消息成为可管理的协作流，而不是只靠会话上下文滚动。

可能能力：

- `list_session_messages`：只读查看当前 session 收到的 agent relay 消息摘要。
- `mark_session_message`：标记已读、已处理、忽略。
- 浏览器通知或 sidebar badge。
- 消息卡片上的“回复此代理”按钮。

边界：

- Work 阶段不需要独立 inbox database。
- Better 阶段如果做 inbox index，应从 DSH session log 派生，避免成为第二套 source of truth。

验收：

- UI 能显示未处理 agent relay 消息。
- 标记状态不会改变原始 session log。
- 代理可以基于 messageId 回复或关闭协作线程。

### B9：观测、审计和故障恢复

目标：让跨会话消息可追踪。

能力：

- 每次投递记录 `messageId`、from、to、mode、deliveredVia、sentAt、traceId。
- 工具输出包含足够定位失败的 error code。
- 可选 debug tool：`diagnose_session_mesh`，只读检查服务可用性、当前配置、可寻址 session 数量。
- 对 create、resume、followup、steer、policy、schema、source rendering 失败做可读提示。

验收：

- 失败能定位到 create、resume、followup、steer、policy 哪一层。
- 测试覆盖常见失败码。
- 插件 stop/update 后没有悬挂 watcher、handler 或工具注册。

### B10：跨 profile / 远程传输预研

目标：为未来跨 DSH profile、跨机器或云端 session 做预研。

方向：

- 继续使用 sessionId 作为逻辑目标，但引入 transport adapter。
- 本地 Host transport：当前 Work 阶段能力。
- Crosstalk transport：桥接现有 `dsh-crosstalk` peer registry。
- Remote transport：需要认证、加密、presence、队列和冲突处理。

边界：

- 远程传输不是 Work 阶段目标。
- 网络传输必须重新设计身份、权限、授权和消息真实性。

验收：

- 输出一份 transport adapter 设计。
- 本地 transport 不因远程预研变复杂。

## 工具总览

Work 阶段工具：

| Tool | 阶段 | 副作用 | 用途 |
| --- | --- | --- | --- |
| `list_sessions` | W1 | 只读 | 找到可寻址普通 DSH sessions |
| `create_session` | W3 | 创建普通会话 | 创建可寻址 worker/session |
| `send_session_message` | W4 | 唤醒、排队或打断目标 | 给 sessionId 投递代理消息；发送者身份由插件内部派生 |

Better 阶段工具：

| Tool | 阶段 | 副作用 | 用途 |
| --- | --- | --- | --- |
| `get_session_thread` | B2 | 只读 | 查看 relay 线程摘要 |
| `broadcast_session_message` | B3 | 批量投递、可选批量打断 | fanout 给多个 sessions |
| `start_session_task` | B4 | 创建会话并发送初始任务 | 显式便利复合操作 |
| `collect_session_replies` | B5 | 只读 | 汇总一个 thread 下的回复/结果 |
| `fork_session` | B6 | 创建 fork 会话 | 从已有会话分叉 worker |
| `rename_session` | B6 | 修改标题 | 给 worker 设置可读名称 |
| `archive_session` | B6 | 归档会话 | 管理已完成 worker 生命周期 |
| `list_session_messages` | B8 | 只读 | 查看 agent relay 收件摘要 |
| `mark_session_message` | B8 | 标记状态 | 管理未读/已处理状态 |
| `diagnose_session_mesh` | B9 | 只读 | 调试插件服务和策略状态 |

## Host 架构

Host 插件负责真实能力：

- 读取 `sessionQuery` 获取 durable sessions。
- 读取 `workspaceRegistry` 拼接 workspace、archived、title 信息。
- 读取 `agents` 获取 live session 状态。
- 对 stopped session 执行 `agents.resume({ resumeSessionId })`。
- 读取 `agentPresets`，在恢复 stopped session 时挂载原 preset。
- 注册 Work/Better 工具。
- 生成 sender identity、messageId 和正文 frontmatter envelope。

`create_session` 的实现应优先使用 DSH Host 侧正式会话创建服务。如果当前 DSH 版本只在 Web typert 网关暴露 `session.create`，正式方案应先在 Host composition 中补一个稳定 service，例如：

```ts
type SessionLifecycleService = {
  create(input: { cwd?: string; workspaceId?: string; agentPreset?: string }): Promise<CreateSessionResult>
  rename(input: { sessionId: string; title: string }): Promise<{ title: string }>
}
```

插件消费这个 Host service，而不是长期在插件里直接调用 Web HTTP API。

## Client 架构

Work 阶段可以没有 Client。Better 阶段建议增加 Client 能力：

- agent relay 消息卡片。
- session picker。
- 创建成功后的打开/复制操作。
- 收件提醒和未处理消息 badge。
- 线程化回复按钮。

Client 只负责展示和交互，不成为普通 session 状态源。

## 持久化设计

插件不写普通会话 shadow database。

权威数据源：

- 普通 session、workspace、archive 状态来自 DSH 自己的持久化。
- agent relay 消息作为目标会话事件进入 DSH session log。
- thread/message index 如果 Better 阶段需要，应从 session log 派生或作为可重建索引。

短期状态：

- message counter 可以在内存中维护。
- 持久 message id 建议使用 `senderSessionId + timestamp + random` 或 DSH event id 派生。
- policy config 来自插件配置，不写入 per-message 状态。

## 与现有能力的关系

### `subagent` / `subagent_fork`

这些工具仍适合当前会话内的父子协作。`dsh-session-mesh` 适合横向普通会话协作，尤其是多个普通 DSH sessions 之间互相委派、通知、恢复和回复。

### `dsh-crosstalk`

`dsh-crosstalk` 解决安装同一插件的在线 peer 之间的轻量 inbox 通信。`dsh-session-mesh` 解决 DSH durable session 的全局寻址和生命周期操作。两者可以共用 envelope 思路和 UI 卡片风格，但状态源分离。

### `dsh-session-ref`

session ref 是只读上下文引用。`dsh-session-mesh` 是可写通信和创建能力。两者可以组合：消息正文可引用 `dsh-session:<id>`，但投递本身由 `send_session_message` 完成。

### 原生 `send_message`

原生 `send_message` 保持父子 subagent 和 crosstalk peer 语义。`dsh-session-mesh` 使用独立工具名，避免未知字符串被偷偷解释成普通 sessionId。

## 当前已验证事实

本设计基于当前实验结论：

- `sessionQuery + workspaceRegistry + agents.list()` 可以列出 durable sessions，并拼接 live/stopped/archived 状态。
- `agents.resume({ resumeSessionId })` 可恢复 stopped session。
- 恢复或 live agent 可通过 `followup` / `steer` 接收消息。
- `session.prompt` 的模式是 `"queue" | "steer"`。
- 动态 Cordis tool 能热加载验证只读 `list_sessions` 原型。
- 动态 Cordis tool schema 需要避免根 `parameters.additionalProperties: false`，并对嵌套 object schema 显式声明 `additionalProperties`。

## 总体路线图

### Work 发布线

1. W0：插件骨架与 Host 能力确认。
2. W1：`list_sessions`。
3. W2：当前 session 身份由发送工具内部派生，不暴露独立 tool。
4. W3：`create_session`。
5. W4：`send_session_message`。
6. W5：agent relay envelope 与系统提示词。
7. W6：真实 DSH 双会话闭环验证。

Work 发布线完成后，插件已经能解决核心需求：代理可创建普通会话，可向任意 sessionId 发消息，接收方能识别代理消息来源。

### Better 发布线

1. B1：Client 消息卡片与 session picker。
2. B2：线程、回复和协作上下文。
3. B3：批量发送与 fanout。
4. B4：显式 Worker 创建便利工具。
5. B5：结构化任务协议与结果收集。
6. B6：普通会话生命周期工具。
7. B7：策略、权限和循环防护。
8. B8：收件箱、未读和通知。
9. B9：观测、审计和故障恢复。
10. B10：跨 profile / 远程传输预研。

Better 发布线按实际使用痛点逐项推进，不阻塞 Work 闭环发布。

## 待确认实现点

- Host 侧是否已有稳定的普通 session create service 可供插件直接消费；如果没有，应先补 `SessionLifecycleService`。
- Work 阶段是否完全排除 subagent-origin 目标，还是只读列出但发送拒绝。
- archived session 是否需要 Better 阶段提供显式 unarchive-and-send 流程。
- Client relay 卡片应如何解析并展示正文中的 `dsh-relay` frontmatter。
- 批量 fanout 的默认上限取值。
- relay 自动转发的默认 `maxRelayHops` 取值。
- `allowSteer` 默认是否开启，取决于最终产品对打断运行中会话的风险偏好。
- `delete_session` 是否需要进入管理工具；建议等 `archive_session` 足够成熟后再决定。
- 结构化结果是否需要强 JSON schema 校验，还是先保持自由文本 + metadata。
