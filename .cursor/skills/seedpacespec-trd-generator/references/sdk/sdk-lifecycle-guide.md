# SDK 生命周期管理 — TRD 写作指南

> 本文件为 SDK 项目涉及生命周期/资源管理的 TRD 章节提供参考。
> 当 Step 8 条件 S2 命中时加载。

---

## 1. 初始化模式

TRD §4 中设计 SDK 初始化时，必须说明选择了哪种模式及其依据：

### 1.1 Options Object 模式

```
const client = new Client({ baseUrl, apiKey, timeout })
```

**适用场景**：配置项 ≤10 个，无步骤依赖，所有配置可一次性提供。

**TRD 写法要求**：
- 列出所有配置项（必选/可选）、默认值、校验规则
- 说明配置何时校验（构造时 eager vs 首次使用时 lazy）
- 说明不合法配置的错误类型和消息

### 1.2 Builder 模式

```
const client = Client.builder()
  .withAuth(apiKey)
  .withTransport(httpTransport)
  .withRetry(exponential(3))
  .build()
```

**适用场景**：构建步骤有依赖顺序、有可选组件插拔、或 build 时需要做复杂校验。

**TRD 写法要求**：
- 列出 Builder 的所有方法及其是否必调
- 说明步骤间的依赖关系（如 `withAuth` 必须在 `withTransport` 之前）
- `build()` 的校验逻辑和可能的错误
- 为什么选 Builder 而非 Options（通常是因为有步骤依赖或需要类型安全地约束组合）

### 1.3 Factory / 静态方法

```
const client = await Client.create(options)  // 异步初始化
```

**适用场景**：初始化本身是异步的（如需要先获取配置/建立连接）。

**TRD 写法要求**：
- 说明为什么初始化必须是异步的
- 初始化失败时的行为（抛异常 vs 返回 Result）
- 是否支持重试初始化

---

## 2. 配置校验时机

| 策略 | 行为 | 适用场景 | TRD 中如何体现 |
|------|------|---------|---------------|
| **Eager（构造时）** | 所有配置在创建实例时立即校验 | 配置错误应 fail fast，不应延迟到运行时 | 列出校验规则表 + 所有可能的校验错误 |
| **Lazy（首次使用时）** | 仅在实际使用某配置项时校验 | 配置可选且大部分用户不会用到的高级选项 | 说明哪些是 lazy 校验 + 用户可能遇到的延迟错误 |
| **混合** | 必选项 eager，可选项 lazy | 大型 SDK，配置项多 | 分两组列出 |

---

## 3. 资源管理

### 3.1 需要管理的资源类型

TRD 中须明确列出 SDK 实例持有的资源：

| 资源类型 | 示例 | 生命周期 | 释放方式 |
|---------|------|---------|---------|
| 网络连接 | HTTP keep-alive / WebSocket | 随实例 | close connection |
| 连接池 | 数据库连接池 | 随实例 | drain + close all |
| 定时器 | 心跳 / 令牌刷新 | 随实例 | clearInterval |
| 缓存 | 内存缓存 / LRU | 随实例 | clear + 释放引用 |
| 事件监听 | DOM / EventEmitter | 随实例 | removeListener |
| 临时文件 | 下载缓存 | 按操作 | unlink on complete |

### 3.2 资源泄漏防护

TRD §4 中设计资源管理时须说明：

1. **引用跟踪**：如何追踪所有待释放资源（注册表 / WeakRef / Disposable 列表）
2. **泄漏检测**：debug 模式下是否有泄漏警告（如 GC finalizer 检测未 dispose 的实例）
3. **超时保护**：长时间未使用是否自动释放（idle timeout）

---

## 4. 销毁与清理

### 4.1 dispose/close/destroy 设计

TRD 中必须回答：

| 问题 | TRD 中如何体现 |
|------|---------------|
| 方法叫什么？（dispose / close / destroy / shutdown） | 与语言/生态惯例一致 |
| 同步还是异步？ | 若有异步资源（如 drain 连接池），应为 async |
| 能否重复调用？ | 幂等设计：第二次调用是 no-op 还是抛错？ |
| dispose 后调用其他方法？ | 抛 IllegalStateError + 明确的错误消息 |
| 有未完成的操作怎么办？ | 选项：等待完成(graceful) / 立即取消(force) / 可配置 |

### 4.2 优雅关闭流程

```markdown
**dispose 流程**（TRD 中须以此粒度说明）:

1. 标记状态为 disposing → 拒绝新请求（抛 DisposingError）
2. 等待进行中的请求完成（或超时后强制取消）
3. 释放所有定时器
4. 关闭所有连接
5. 清空缓存
6. 移除所有事件监听
7. 标记状态为 disposed

**超时策略**: graceful shutdown timeout = 5s，超时后 force cancel 剩余请求
```

---

## 5. 多实例 vs 单例

TRD §4 中须明确说明 SDK 的实例化策略：

| 策略 | 适用场景 | TRD 中的设计意图写法 |
|------|---------|-------------------|
| **多实例** | 不同配置连不同服务 / 测试隔离 | 说明实例间是否有共享状态；如何处理全局资源（如单一事件总线） |
| **单例** | 全局唯一资源（如设备 SDK） | 说明如何获取实例（getInstance / init 一次）；并发安全；重新初始化策略 |
| **Scoped** | 按作用域创建（per-request / per-session） | 说明作用域边界；父子实例的资源继承/共享关系 |

---

## 6. TRD 中生命周期章节的检查清单

写完 §4 生命周期相关章节后，自检：

- [ ] 创建实例的完整代码路径（从 new/create 到可用状态）是否清晰？
- [ ] 所有资源是否都有对应的释放步骤？
- [ ] dispose 后的状态是否明确定义？
- [ ] 异常流程（初始化失败、dispose 失败）是否有兜底？
- [ ] 是否说明了与 GC/ARC 的交互（prevent GC hold / weak reference）？
- [ ] 消费者是否清楚"什么时候该调 dispose"？
