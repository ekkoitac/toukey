---
name: seedpacespec-apply-change
description: >
  写代码实现变更中的任务——逐条完成 tasks.md 里的实现步骤。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"开始写代码"、"实现这个"、"开始做"、"继续实现"、"做下一个任务"。
  SKIP: 用户只想改设计方案不写代码（用 sdx-update-task）；用户还没规划过需求（先用 sdx-propose 或 sdx-guided）。
  requires: seedpacespec/changes/active-change/<name>/ 下存在 tasks.md 和 TRD 文件。
  output: 业务代码实现（须对齐网络/API 等工程契约等）+ tasks.md 中对应任务标记完成。
  examples: "开始实现第3个任务" → 触发；"帮我写个排序函数" → 不触发（普通编码请求）。
license: MIT
compatibility: 需要 seedpacespec CLI
metadata:
  author: seedpacespec
  version: "1.4"
---

# seedpacespec-apply-change


## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.apply` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `after_context_digested` | 上下文消化完成后（步骤 4 之后） | hook | 可用于额外上下文校验、自定义摘要 |
| `before_each_task` | 每条任务开始实现前（步骤 7 中，循环内） | hook | 可用于预检、依赖检查、拉取最新代码 |
| `after_all_tasks_done` | 全部任务完成后（步骤 8 之前） | hook | 可用于自动化检查、通知、后处理 |
| `task_completion_check` | 每条任务完成确认逻辑（步骤 7 中） | content | 可替换默认的任务确认流程 |
| `ui_render` | UI 还原实现规范（步骤 7 中，检测到 UI 任务时） | content | 替换默认的 UI 还原规范 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配的 `skill: apply` + `slot: 名字` 条目 → 有则加载 `run` 指定的文件执行，完毕后回到主流程继续 → 无则跳过。对于 content slot，有匹配时用外部文件内容替换包裹的默认内容。

若无 `plugins` 配置 → 正常执行，无任何变化。

---

## Goal

**写代码**实现 seedpacespec 变更中的任务。本 skill 的核心是编码实现，不是改设计——改设计请用 `/sdx-update-task`。

**核心原则**：
- **TRD 是编码的第一优先级**：代码怎么写以 TRD 为准，不得凭自身知识另起炉灶
- **路径以已确认文件树为准**：`trd.md`、`design.md` 中的树状图是文件路径的唯一真源
- **工程契约与调用惯例须对齐仓库（重点）**：尤其 **网络 / API**（client 封装、baseURL、拦截器、错误与鉴权处理、请求响应包装）、与同路径既有代码一致的调用方式.——见下节
- **改动聚焦**：每条任务保持改动小而聚焦，不借单条 task 做全局重构

### 工程契约与仓库惯例（须遵守）

**TRD** 决定业务行为与对外接口。**architecture.md** 与邻居源码主要用于对齐 **可复现的工程约定**，强制力度高于「是否照搬某层目录名」：

| 优先级 | 内容 |
|--------|------|
| **高（须对齐）** | 网络请求方式：沿用项目既有 HTTP/WebSocket client、路径前缀、错误码/重试、loading 与鉴权头习惯；不自 invent 另一套请求栈（除非 TRD 明确要求替换）。DTO/序列化、日志与埋点若项目有统一模式，跟随同模块既有代码。 |
| **中（宜对齐）** | 命名、导入风格、状态管理/路由写法——与同目录既有文件一致。 |
| **低（参考即可）** | architecture 中的**分层、域划分、目录隐喻**——仅作背景；**文件落点与模块拆分**以 **TRD/design 文件树** + 合理工程判断为准，不必与 architecture 示意图逐条一致。 |

若 TRD 与 architecture 某段冲突 → **以 TRD 为准**。若无 `architecture.md` → **对齐本次改动路径旁既有代码**（尤其 API 调用链）。

---

## State Machine Gates

执行前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得进入后续步骤。**

| # | 状态 | 完成条件 | 未完成时行为 |
|---|------|---------|-------------|
| G1 | `change_selected` | 变更已确定（用户在本回合明确指定，或通过 AskQuestion 选择） | `list --json` + AskQuestion 让用户选择 |
| G2 | `status_checked` | `seedpacespec status` 已执行并解析；若 `blocked`/`all_done` → 流程终止 | 执行 CLI 检查 |
| G3 | `context_digested` | 所有 contextFiles + TRD 已阅读；`architecture.md` 若存在则读（侧重契约），不存在则从改动路径相邻代码归纳 API 等惯例；R 编号已归一化 | 逐一读取并归一化 |
| G4 | `digest_shown` | 消化摘要已展示给用户（含 TRD 要点、模块路径、设计决策、技术栈约定） | 展示摘要 |
| G5 | `mode_selected` | 用户选定实现模式（A/B/C）；B→仅改 tasks 后结束；C→直接结束 | AskQuestion 询问模式 |
| G6 | `implementing` | 仅当 G5=A 时进入；按 TRD 逐条实现任务 | 实现循环 |

**状态推进单向** G1→G2→…→G6，不得跳跃。G2 判定为 blocked/all_done 时流程提前终止。G5 选择 B/C 时不进入 G6。

### 恢复协议（新对话续做）

**用途**：当新对话检测到已有实现进度时，本协议决定从哪个门禁恢复执行。下方"G1~G6"对应「State Machine Gates」表和「执行流程」章节中的步骤编号（如"G3 精简阅读"= 执行流程 → 步骤 3 阅读并消化上下文）。恢复协议**不是独立流程**——它只决定从哪里开始，进入后走的是正常执行流程。

当检测到以下**任一**信号时，判定为续做，启用快速恢复：
- 用户明确说"继续实现"/"接着上次"/"继续 apply"等含义的指令
- tasks.md 中已有部分 `- [x]` 完成项

**恢复流程**：
1. 执行 G1（选择变更）和 G2（status 检查）— 不可跳过
2. G3 启用**精简阅读**模式：
   - **必读**：TRD 全文 + tasks.md（定位未完成任务）+（若存在）`architecture.md`（侧重契约）；不存在则从改动路径读相邻代码归纳 API 惯例等;
   - **可跳过**：proposal.md、PRD（前置产物，对编码无直接影响）
   - **选读**：design.md 仅读「模块与文件结构（树状图）」章节
3. G4 正常执行，标注「续做模式，已跳过前置产物全量阅读」
4. G5 可由用户直接说"继续 A"跳过 AskQuestion
5. G6 从第一条未完成任务开始

**不适用恢复**：tasks.md 无任何完成项 → 视为首次，走完整 G1→G6。

⛔ 约束 [GL1]: 禁止编造跳过理由——AI 不得以任何自创名义（如恢复协议、追加模式、精简流程等）直接跳过门禁。所有门禁必须逐一通过并产出可验证输出。

### 高风险步骤强调

| 步骤 | 易犯错误 | 正确行为 |
|------|---------|---------|
| **G3 上下文消化** | 跳过 TRD 或未归纳 API 惯例即编码 | 必须 Read contextFiles + TRD 全文；有 `architecture.md` 则读（侧重契约），无则从邻居代码归纳请求惯例 |
| **G4 消化摘要** | 跳过摘要展示直接询问模式 | 必须向用户展示消化摘要证明已读 |
| **Phase C 确认模式** | 忽略 `apply.batchMode` 配置 | 必须先读取 config.yaml 决定确认行为 |
| **Phase C 确认本身** | 实现完就标 `[x]` 不等确认 | 必须通过 AskQuestion 获得用户确认 |
| **反馈处理判定** | AI 自行判定规模后直接改代码 | 必须先 AskQuestion 让用户确认改动规模 |
| **TRD 同步** | 轻量修改后只改代码不更新 TRD | 所有修改都必须同步更新对应的 TRD/design |

---

## 执行流程

**输入**：可选指定变更名。若用户未明确写出变更名，**必须**运行 `seedpacespec list --json` 并用 AskQuestion 让用户选择，禁止仅凭对话历史推断。

### 步骤 1: 选择变更（→ G1）

若用户在本回合消息中明确写出变更名则使用。否则：
- 运行 `seedpacespec list --json` 获取所有 active 变更
- 若仅有一个：展示并 **AskQuestion** 确认
- 若有多个：**AskQuestion** 让用户选择
- **禁止**仅凭对话历史自动推断选定变更

### 步骤 2: 查看状态（→ G2）

```bash
seedpacespec status --change "<name>" --json
```

解析 JSON，了解 `schemaName` 和任务位置。

```bash
seedpacespec instructions apply --change "<name>" --json
```

**处理状态**：
- `state: "blocked"` → 展示说明，建议 `/sdx-continue`。**流程终止于 G2。**
- `state: "all_done"` → 祝贺并建议归档。**流程终止于 G2。**
- 否则 → 继续推进 G3→G6

**跨变更冲突检测（G2 通过后）**：读取其他 active 变更的 design.md 文件树，比对路径交叉。发现冲突 → AskQuestion 确认是否继续。

### 步骤 3: 阅读并消化上下文（→ G3）

⛔ 约束 [GL2]: G3 未完成 → 不得进入 G5/G6（实现模式选择或编码）。

读取 `contextFiles` 列出的文件，**额外必读**：
- **`trds/` 下的 TRD 文件（最高优先级）** — 编码的第一依据
- **项目根目录 `architecture.md`**（若存在）— **必读侧重**：**§6 编码约定**及文中与 **网络 / API、请求封装** 相关的描述
- **`seedpacespec/global-specs/`**（若存在）— 项目背景
- **`design.md` 的文件树章节** — 路径真源

若项目根**不存在** `architecture.md`：仍须浏览本次任务将改动的路径旁既有源码，归纳 **网络/API 调用与错误处理** 惯例（不可替代为「凭记忆写请求」）。

⛔ 约束 [GL5]: 若 design.md 文件树**完全缺失**，必须暂停并 AskQuestion。

<!-- slot:after_context_digested -->

**消化验证（必做）**：提取 TRD 技术方案要点、模块路径、设计决策、编码约定。

**R 编号归一化（必做）**：`R1/R01/R-01/R 01` → 统一 normalizedKey。

### 步骤 4: 展示消化摘要（→ G4）

⛔ 约束 [GL1]: 不得跳过摘要展示。

展示：schema、进度、剩余任务、**上下文消化摘要**（TRD 要点、模块路径、设计决策、编码约定、R 编号映射）。

### 步骤 5: 实现模式选择（→ G5）

> **📋 实现模式 用户可见文案模板**：
> - question: "请选择代码实现方式："
> - option 1: label="全量实现所有任务" description="为所有任务生成完整的业务代码"
> - option 2: label="仅生成模块骨架" description="只生成模块结构和伪代码，不写具体实现"
> - option 3: label="暂不实现" description="先不写代码，我再想想"

- **选 A** → 进入步骤 6 实现循环
- **选 B** → 重规划 tasks.md（拆为骨架阶段+实现阶段），不编写业务代码，完成后提示再次执行 `/sdx-apply`
- **选 C** → 不改动仓库，流程结束

**选项 B 规则**：
- 仅重写 tasks.md，不写业务代码
- 保留所有 `[x]` 条目不动
- 须与 design.md/TRD 文件树一致

**模块结构规范（选 A 或 B 后适用）**：

若 design.md/TRD 中已有确认的文件树，新建路径以该树为最高优先级；树未列出的按仓库既有习惯补全。

### 步骤 6: 实现任务（→ G6，循环直至完成或阻塞）

⛔ 约束 [GL2]: 仅在 G5=A 后进入。G3/G4 未完成 → 禁止编码。

#### 6.0 并行执行策略（可选加速）

分析剩余任务依赖关系，判断是否可并行：
- **独立性判定**：文件集合无交集 + 无顺序依赖 + 不共享状态文件
- ≥2 个独立任务 → AskQuestion 展示并行方案，用户选择并行或串行
- 不适用并行：所有任务有依赖 / 仅剩 1 个 / 涉及全局配置

#### 6.1 Phase A：编码实现

<!-- slot:before_each_task -->

⛔ 约束 [GL3]: 严格按照 TRD 中定义的组件分层、状态归属、逻辑归类、接口契约进行编码——TRD 怎么设计的就怎么实现，不得自行发挥。

- 标明正在处理哪条任务
- 定位 TRD 对应章节（第一优先级）
- 文件路径须与已确认树状图一致
- **工程契约**：新增接口调用须沿用仓库既有 **API client、拦截器、错误处理、URL 组织**；与同路径既有代码同一调用形态，禁止为省事另起一套请求写法（除非 TRD 明确要求）
- **惯例**：命名与导入风格与项目编码约定一致
- 若 TRD 未覆盖当前任务 → 暂停说明，建议先更新 TRD

**UI render 任务检测**：当任务含 UI/视图/页面/组件/样式关键词，或修改 `.jsx`/`.tsx`/`.vue`/`.svelte`/`.dart` 文件时，触发 `ui_render` slot。

<!-- slot:ui_render -->
**UI 视觉还原规范**：
- 有 style-context JSON + 截图：执行 `seedpacespec-render-ui` 规范
- 无素材：依据 TRD + architecture.md UI 约定编码
- ⛔ 约束 [GL6]: 不得据 Figma 修改 TRD 已确认组件树
<!-- /slot:ui_render -->

#### 6.2 Phase B：自检与优化

**architecture.md 风险热点防护**：

| 命中信号 | 防护动作 |
|----------|----------|
| 大文件（§9.1） | 只改目标区域，禁止顺手重构 |
| 耦合热点（§9.2） | grep 所有引用方，确认兼容 |
| 平台差异（§9.3） | 确保修改只作用于目标环境 |
| 交叉风险 ≥2（§9.5） | 综合防护 + Phase C 额外说明 |

**性能微调**：不扩大任务范围前提下优化明显低效点；若改变对外行为 → AskQuestion 确认。

⛔ 约束 [GL4]: 禁止借单条 task 做全局大重构。

#### 6.3 Phase C：确认（⛔ 禁止跳过）

<!-- slot:task_completion_check -->

**前置：读取确认模式** — `seedpacespec/config.yaml` → `apply.batchMode`（默认 `true`）

**连续模式（`batchMode: true`）**：
- 所有任务连续执行，每条完成后自动勾选 `[x]`
- 全部完成后输出汇总清单，AskQuestion 统一确认
- 选 B → 指出需修改的任务，改回 `[ ]`，进入 §6.4

**逐条模式（`batchMode: false`）**：
- 每条/每组完成后 AskQuestion 确认
- 选 A → 勾选 `[x]` 继续
- 选 B → 进入 §6.4

**反悔机制（通用）**：用户对已确认任务表示不满 → 改回 `[ ]` → 进入 §6.4
<!-- /slot:task_completion_check -->

#### 6.4 用户反馈处理

⛔ 约束 [GL7]: 所有修改（含轻量修改）都必须同步更新对应的 TRD/design。

⛔ 约束 [GL8]: 必须先 AskQuestion 让用户确认改动规模，不允许 AI 自行判定后直接修改。

| 规模 | 判断标准 | 处理方式 |
|------|---------|---------|
| **轻量修改** | 同时满足：①单章节局部 ②不改文件树 ③不波及已完成任务 | AskQuestion 确认后在 apply 内直接处理 |
| **重大修改** | 任一：①≥2 章节 ②改文件树 ③波及已完成任务 ④改架构策略 | 引导 `/sdx-update-task` |
| **无法确定** | 不能明确归入上述 | AskQuestion 让用户选择 |

**轻量修改流程**：
1. 说明影响范围 → AskQuestion 确认
2. 修改代码 + 同步更新 TRD/design
3. 若影响已完成 tasks → 重置 `[x]` 为 `[ ]`
4. AskQuestion 确认完成 → 继续

#### 6.5 暂停条件

- 任务不清晰 → 请求澄清
- 遇到错误或阻塞 → 报告并等待指示
- 用户打断

<!-- slot:after_all_tasks_done -->

### 步骤 7: 完成或暂停时展示状态

展示本会话完成的任务、总体进度。若全部完成建议归档；若暂停说明原因。

---

## Guardrails

⛔ 以下为全局红线，部分已在执行流程中内联重申。红线编号（GL1~GL10）与流程中的内联 ⛔ 约束双向索引。

- ⛔ **GL1** 状态机门禁（G1→G6）是 ASSERTION：任何状态未完成 → 只能 AskQuestion，不得跳入后续状态。禁止跳过、合并或替用户做决定。禁止编造跳过理由。→ 见 State Machine Gates
- ⛔ **GL2** G3 未完成 → 禁止编码：TRD、design.md（文件树）为必读；`architecture.md` 若存在则必读（侧重契约），不存在则须从邻居代码归纳网络/API 惯例等。→ 见步骤 3
- ⛔ **GL3** TRD 是编码的第一优先级：代码怎么写以 TRD 为准，不得凭自身知识另起炉灶。组件分层、状态归属、逻辑归类、接口契约严格按 TRD 实现。→ 见步骤 6.1
- ⛔ **GL4** 禁止借单条 task 做全局大重构：优化与风险处理须落在任务边界内，或经用户确认。→ 见步骤 6.2
- ⛔ **GL5** 路径以已确认文件树为第一约束：`trd.md`、`design.md` 树状图是文件路径唯一真源。文件树缺失时必须 AskQuestion。→ 见步骤 3
- ⛔ **GL6** UI render 禁止自推断设计参考：必须 AskQuestion 确认截图/JSON 是否存在；不得据 Figma 修改 TRD 已确认组件树。→ 见步骤 6.1
- ⛔ **GL7** 所有修改必须同步设计产物：轻量修改在 apply 内完成（含 TRD/design 更新）；重大修改引导 `/sdx-update-task`。→ 见步骤 6.4
- ⛔ **GL8** 设计修改必须先 AskQuestion 确认规模：用户说"要改"或 AI 发现问题时，一律先展示影响范围让用户选择。拿不准时一律 AskQuestion。→ 见步骤 6.4
- ⛔ **GL9** R 编号必须先归一化再匹配：`R1/R01/R-01/R 01` 视为同一需求键，在 G3 内完成。→ 见步骤 3
- ⛔ **GL10** 编码约定强制遵守：`architecture.md` 已记录的命名、状态/路由/API 习惯 → **必须**落实；TRD 未写明的风格细节 → 仍以 architecture编码约定 + 同模块既有代码为准，**禁止**用个人熟悉的「通用最佳实践」覆盖仓库惯例。无 `architecture.md` 时须对齐项目已有文件。→ 见 Goal「编码约定（强制）」、步骤 3、步骤 6.1

---

## 引用

- `.cursor/skills/_shared/memory-protocol.md` — 反馈记忆读取/收集协议
- `.cursor/skills/seedpacespec-render-ui/SKILL.md` — UI 视觉还原规范（ui_render slot 默认实现）
- `.cursor/skills/seedpacespec-update-task/SKILL.md` — 重大修改时的设计产物更新流程
