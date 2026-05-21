# SDK TRD 写作指南 — 公开 API 与内部模块设计

> 本文件为 SDK/库类项目的 TRD 写作提供参考标杆。
> 当 Step 8 条件 S1 命中时加载。
> 与前端的 `ui-component-guide.md` 对等，但术语和关注点完全不同。

---

## Part 1: 公开 API 设计

### 1.1 API 设计原则

TRD §4 中设计公开 API 时，每个接口的设计意图必须覆盖以下维度：

| 维度 | 说明 | TRD 中如何体现 |
|------|------|---------------|
| **最小暴露面** | 只暴露用户必须调用的接口；内部实现细节不泄露 | §4 标注每个导出符号的可见性级别（public/internal），解释为什么暴露 |
| **正交性** | 每个 API 做一件事，组合使用时无副作用冲突 | §4 说明接口间的组合关系和互斥约束 |
| **一致性** | 相似功能的命名、参数顺序、返回结构保持统一 | §4 列出命名规则表，标注与已有 API 的对齐关系 |
| **可发现性** | 用户能通过类型提示/自动补全找到正确方法 | §4 说明命名空间组织和类型导出策略 |

### 1.2 参数设计模式

TRD 中遇到参数设计时，必须说明选择依据：

| 模式 | 适用场景 | 设计意图写法要求 |
|------|---------|----------------|
| **Options Object** | 参数 ≥3 个，或有可选参数 | 说明为什么不用位置参数；列出必选/可选字段；说明默认值策略 |
| **Builder 模式** | 构建过程有步骤依赖或校验逻辑 | 说明构建步骤顺序约束；哪些是 required step；build() 时的校验规则 |
| **显式位置参数** | 参数 ≤2 个且全部必选 | 说明为什么不需要 Options（简单场景，无扩展预期） |
| **Fluent/链式** | 配置阶段和执行阶段明确分离 | 说明哪些方法返回 this（配置链）vs 返回结果（终结操作） |

### 1.3 返回值设计

| 模式 | 适用场景 | TRD 写法要求 |
|------|---------|-------------|
| **Result/Either** | 可预期的失败（网络超时、参数无效） | 定义成功/失败的类型签名；列举所有可能的错误变体 |
| **Promise/Future** | 异步操作 | 说明 resolve 的时机和值；reject 的条件和错误类型 |
| **回调** | 事件流、进度通知 | 定义回调签名；说明调用时机、调用线程、是否可多次触发 |
| **Void + 异常** | 不可恢复的错误（编程错误） | 列举抛出条件；说明调用者不应 catch 的设计意图 |

### 1.4 错误体系

TRD §4 中涉及错误设计时的结构要求：

```
**错误分层设计**:

| 层级 | 错误类型 | 语义 | 消费者处理方式 |
|------|---------|------|--------------|
| L1: 参数校验 | InvalidConfigError | 调用方传入了非法参数 | 修复调用代码 |
| L2: 运行时可恢复 | NetworkTimeoutError | 瞬态故障，重试可解决 | 重试策略 / fallback |
| L3: 运行时不可恢复 | AuthenticationFailedError | 凭证无效，无法自动恢复 | 提示用户 / 上报 |
| L4: 内部断言 | InternalError | SDK 内部 bug | 上报，用户无法处理 |

**设计意图**: 为什么分这几层？消费者如何区分？错误码编码规则？
```

### 1.5 版本兼容

TRD §4 涉及 API 变更时必须包含：

- **Breaking Change 判定**：本次变更是否破坏了已有调用方？判定标准是什么？
- **Deprecation 路径**：若废弃旧 API，过渡期策略（标注 deprecated → 保留 N 个大版本 → 移除）
- **Migration Guide 要点**：新旧 API 的映射关系（可在 TRD 中用表格呈现）
- **运行时兼容层**：是否需要 adapter/shim 兼容旧版调用？设计方案

### 1.6 命名约定

TRD §4 新增公开符号时，必须对齐项目已有的命名模式：

| 类别 | 约定示例 | TRD 中检查点 |
|------|---------|-------------|
| 类/接口 | `PascalCase`，名词短语 | 与同模块已有类名风格一致 |
| 方法 | `camelCase`/`snake_case`（跟语言） | 动词前缀（get/set/create/delete/on/off） |
| 事件 | `on` + 动词过去分词 | 与已有事件命名风格一致 |
| 配置键 | 与方法参数同风格 | 不引入新的命名风格 |

---

## Part 2: 内部模块架构设计

> 当 Q-depth 勾选了 `internal_module` 维度时，§4 中复杂内部模块须按本节要求展开。
> 深度对标 `seedpacespec-design-module` 的输出粒度。

### 2.1 SDK 典型架构分层

SDK 的 §4 子章节通常按以下分层组织（具体层名从 architecture.md 读取；以下为思考参考）：

```
┌─────────────────────────────────────┐
│  Public API Layer (用户直接调用)      │
│  - Client / SDK 入口类              │
│  - Builder / Options / Factory       │
├─────────────────────────────────────┤
│  Core Logic Layer (业务/领域逻辑)    │
│  - 状态机 / 调度器 / 编排器          │
│  - 策略 / 规则引擎                   │
├─────────────────────────────────────┤
│  Transport / IO Layer (通信/存储)    │
│  - HTTP Client / WebSocket / gRPC   │
│  - 重试 / 熔断 / 限流                │
├─────────────────────────────────────┤
│  Codec / Serialization (编解码)      │
│  - JSON / Protobuf / 自定义协议      │
│  - 版本协商                          │
├─────────────────────────────────────┤
│  Platform Abstraction (平台适配)     │
│  - 跨平台差异封装                    │
│  - 环境检测 / polyfill               │
└─────────────────────────────────────┘
```

### 2.2 复杂模块展开要求

当某个内部模块被判定为"复杂"时（如：有状态机、有并发控制、有多策略选择），§4 对应章节须包含以下内容：

#### a) 模块分层图 + 职责表

```markdown
**模块内部结构**:

| 子模块 | 职责 | 对外接口 | 依赖 |
|--------|------|---------|------|
| Scheduler | 任务排队与调度 | enqueue(), cancel() | Queue, Timer |
| Queue | FIFO/优先级队列实现 | push(), pop(), peek() | — |
| Timer | 延迟/定时执行 | setTimeout(), clear() | Platform.timer |
```

#### b) 状态机定义

```markdown
**状态机**:

| 状态 | 含义 | 允许的事件 | 转移目标 | 副作用 |
|------|------|-----------|---------|--------|
| idle | 空闲等待 | start, dispose | running, disposed | — |
| running | 执行中 | pause, error, complete | paused, error, idle | emit progress |
| paused | 暂停 | resume, cancel | running, idle | — |
| error | 出错 | retry, reset | running, idle | emit error event |
| disposed | 已销毁 | — | — | release resources |

**设计意图**: 为什么选择这些状态？状态转移的不变量是什么？非法转移如何处理？
```

#### c) 内部接口签名

模块间的契约接口（非公开 API），用项目真实语法定义：

```markdown
**内部接口**（模块间契约，不对外暴露）:

interface ITransport {
  send(request: Request): Promise<Response>
  abort(requestId: string): void
  onError(handler: (error: TransportError) => void): Disposable
}

**设计说明**: Transport 接口的抽象目的是解耦 Core Logic 与具体通信实现。
Core 只依赖 ITransport，不关心底层是 HTTP/WebSocket/Mock。
这允许：1) 单测时注入 MockTransport；2) 运行时按环境切换实现；3) 未来替换协议无需改 Core。
```

#### d) 协作序列图

复杂交互用 mermaid 序列图展示：

```markdown
**协作流程**（一次完整请求的模块间交互）:

sequenceDiagram
    participant User
    participant Client
    participant Core
    participant Transport
    participant Codec

    User->>Client: call(params)
    Client->>Core: dispatch(action)
    Core->>Codec: encode(payload)
    Codec-->>Core: bytes
    Core->>Transport: send(request)
    Transport-->>Core: response
    Core->>Codec: decode(bytes)
    Codec-->>Core: result
    Core-->>Client: emit(result)
    Client-->>User: return result
```

#### e) 并发/线程安全策略

```markdown
**并发策略**:

| 场景 | 策略 | 实现方式 | 设计依据 |
|------|------|---------|---------|
| 多线程并发调用 | 无锁队列 + 单消费者 | ConcurrentQueue | 避免锁竞争，SDK 调用频率高 |
| 资源竞争 | 引用计数 + 惰性释放 | RefCountedPool | 连接复用但不阻塞创建 |
| 取消操作 | CancellationToken 传递 | 协作式取消 | 不强制中断，让各层自行清理 |
```

#### f) 边界与异常兜底

```markdown
**边界处理**:

| 边界场景 | 触发条件 | 兜底策略 | 对用户的表现 |
|---------|---------|---------|------------|
| 网络中断 | Transport.send 超时 | 指数退避重试 3 次 | 抛 NetworkError（附重试次数） |
| 内存溢出 | 队列积压 > 阈值 | 丢弃最老任务 + 警告 | 触发 onWarning 回调 |
| 非法状态转移 | disposed 后调用 API | 抛 IllegalStateError | 明确错误信息指导修复 |
```

### 2.3 与 design-module 的关系

- 若变更的 `design.md` 已按 `seedpacespec-design-module` 粒度展开了某内部模块（有类图、模式选型、协作流程）→ **TRD 直接引用 design 中的设计，只补充**：
  - 接口签名的真实语法定义
  - 伪代码 + 设计解读
  - 边界场景的具体兜底实现
  - 测试要点

- 若 design.md 未展开或不存在 → **TRD 自行按 2.2 的深度完整展开**，等同于 design-module 的输出粒度在 TRD 内部完成。

---

## Part 3: TRD §4 写法示例

> 以下展示 SDK 项目 TRD §4 的写法样例。对标前端的 `high-quality-trd.md`，但使用 SDK 术语。

### 示例：§4.1 公开 API 层

```markdown
### 4.1 公开 API 层 — Client 入口

> **层角色**：用户直接交互的唯一入口，封装所有内部复杂度，暴露简洁一致的调用接口。

**覆盖**: R-01, R-02 | **来源**: D01(单入口 Client 类，因为多入口会导致使用者困惑)

**设计意图**:

本层的核心问题是：如何让消费者用最少代码完成最常见操作，同时保留高级配置的灵活性。

备选方案：
1. 纯函数式 API（每个操作一个独立函数，通过参数传 context）
2. 类实例 API（单个 Client 实例，方法调用共享配置和连接）
3. 混合式（高频操作用顶层函数，复杂场景用 Client 实例）

选择方案 2（类实例 API），因为：
- SDK 需要维持内部状态（连接池、认证令牌、缓存），函数式每次调用都要重建太浪费
- 实例方法天然带类型提示，IDE 补全友好
- 连接/资源的生命周期绑定在实例上，dispose 时统一释放，不会泄漏

不采用此方案的风险：若用函数式，每个调用都要传 config + 重建连接 → 性能差 + 用户代码冗余。

**类型定义**:

interface ClientOptions {
  baseUrl: string
  apiKey: string
  timeout?: number          // 默认 30000ms
  retryPolicy?: RetryPolicy // 默认 exponential(3)
  logger?: Logger           // 默认 noop
}

class MySDKClient {
  constructor(options: ClientOptions)
  
  // 核心操作
  async query(params: QueryParams): Promise<Result<QueryResponse, SDKError>>
  async mutate(params: MutateParams): Promise<Result<MutateResponse, SDKError>>
  
  // 生命周期
  dispose(): void
  
  // 事件
  on(event: 'error', handler: ErrorHandler): Disposable
  on(event: 'warning', handler: WarningHandler): Disposable
}

**关键逻辑**（伪代码）:

function Client.query(params):
  validate params against schema       // L1 参数校验，fail fast
  token = await this.auth.getToken()   // 复用缓存令牌或刷新
  request = this.codec.encode(params, token)
  response = await this.transport.send(request)  // 含重试逻辑
  return this.codec.decode(response)

**设计解读**: query 的编排遵循"校验 → 认证 → 编码 → 传输 → 解码"五阶段流水线。
每个阶段职责单一且失败语义明确：校验失败 = 调用方问题（不重试），认证失败 = 凭证问题（不重试但提示刷新），传输失败 = 瞬态问题（按 retryPolicy 重试）。
这种分层让错误处理精准——不同阶段的失败走不同恢复路径，避免"一刀切重试"导致的副作用（如重复提交 mutate）。
```

### 示例：§4.2 Core Logic 层（复杂模块）

```markdown
### 4.2 Core Logic 层 — 请求调度器

> **层角色**：管理并发请求的排队、限流、优先级调度，确保不超过服务端限制。

**覆盖**: R-03, R-04 | **来源**: D02(引入调度器而非简单排队，因为需要优先级和取消能力)

**设计意图**:

核心问题：SDK 支持并发调用，但服务端有 rate limit（100 req/s）。如何在不阻塞调用者的前提下确保不触发限流？

备选方案：
1. 简单信号量（semaphore）限制并发数
2. Token Bucket 限流器
3. 优先级调度器 + 令牌桶组合

选择方案 3，因为：
- 纯信号量无法区分请求优先级（query vs healthcheck 应有不同优先级）
- 纯令牌桶无法取消排队中的请求（用户调 cancel 时仍占位）
- 组合方案：令牌桶控速率 + 优先级队列控顺序 + CancellationToken 控取消

不采用的后果：方案 1 会导致低优先级 healthcheck 挤占高优先级 query 的配额。

**状态机**:

| 状态 | 含义 | 事件 | 目标 | 副作用 |
|------|------|------|------|--------|
| queued | 等待令牌 | token_available | executing | 从队列出列 |
| queued | 等待中 | cancel | cancelled | 释放队列位 |
| executing | 发送中 | response | done | 归还令牌 |
| executing | 发送中 | timeout | retry_or_fail | 归还令牌 |
| cancelled | 已取消 | — | — | — |
| done | 已完成 | — | — | — |

**内部接口**:

interface IScheduler {
  submit<T>(task: ScheduledTask<T>, priority: Priority): CancellablePromise<T>
  getQueueDepth(): number
  drain(): Promise<void>  // 等待所有排队任务完成（用于 dispose）
}

interface ScheduledTask<T> {
  execute(signal: AbortSignal): Promise<T>
  priority: Priority
  createdAt: number
}

**协作流程**:

sequenceDiagram
    participant Caller
    participant Scheduler
    participant TokenBucket
    participant PriorityQueue
    participant Transport

    Caller->>Scheduler: submit(task, HIGH)
    Scheduler->>PriorityQueue: enqueue(task)
    Scheduler->>TokenBucket: waitForToken()
    TokenBucket-->>Scheduler: token granted
    Scheduler->>PriorityQueue: dequeue highest
    PriorityQueue-->>Scheduler: task
    Scheduler->>Transport: task.execute(signal)
    Transport-->>Scheduler: result
    Scheduler->>TokenBucket: returnToken()
    Scheduler-->>Caller: resolve(result)

**并发策略**:

| 场景 | 策略 | 依据 |
|------|------|------|
| 多调用者并发 submit | 锁-free 优先级队列 | 避免调用者线程互相阻塞 |
| 令牌桶刷新 | 定时器 + 原子计数器 | 精确控速不超 rate limit |
| cancel 时任务已在执行 | AbortSignal 协作取消 | 不强制中断 Transport，让其优雅关闭连接 |

**边界处理**:

| 场景 | 条件 | 兜底 | 用户感知 |
|------|------|------|---------|
| 队列满 | depth > maxQueueSize | reject 新请求 + emit warning | 抛 QueueFullError |
| 令牌耗尽超时 | 等待 > queueTimeout | 取消该任务 | 抛 TimeoutError |
| dispose 时队列非空 | drain timeout > 5s | 强制 cancel 所有 | emit warning |
```
