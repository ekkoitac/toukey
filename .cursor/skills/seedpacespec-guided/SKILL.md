---
name: seedpacespec-guided
id: seedpacespec-guided
category: Workflow
description: >
  引导式变更规划——通过一问一答逐步收集技术决策，生成 Eval 风格的 proposal、design、TRD 和 tasks。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"引导模式"、"一步步来"、"guided"、"逐步规划"、"逐步设计"。
  SKIP: 用户有完整需求想一键生成全部产物（用 sdx-propose）；用户想改已有 TRD（用 sdx-update-task）；用户想直接写代码实现（用 sdx-apply）。
  requires: seedpacespec CLI 已安装；建议先有 architecture.md。
  output: seedpacespec/changes/active-change/<name>/ 下的 proposal.md、design.md、trds/<name>_trd.md、tasks.md。
  examples: "/sdx-guided 用户登录功能" → 触发；"一步步来规划这个功能" → 在 sdx 会话上下文中触发。
---

引导式变更规划——一问一答收集技术决策，逐步生成变更产物。

将创建包含以下产物的变更：
- proposal.md（**产物状态占位**——**仅引用 PRD 路径**；需求真相源在 `specs/*-prd.md`，不另写传统「提案」长文）
- design.md（技术决策 + 改动范围）
- TRD（Eval 风格，自由格式实现方案）
- tasks.md（实现步骤）

准备开始实现时，执行 `/sdx-apply`

**第一阶段硬性约束（无论如何不得违反）**

- **第一阶段**指：本工作流中执行 `/sdx-guided`、为完成变更产物（proposal / design / TRD / tasks）而进行的整段助手工作。
- **禁止代码生成**：在此阶段**不得**创建、修改或删除**业务仓库中的应用实现代码**（例如 `src/`、`app/`、`packages/` 等目录下的 `.ts`、`.tsx`、`.js`、`.vue`、`.go` 等源文件）；**即使**用户明确要求「顺手实现」「先写一版代码」，也必须拒绝并说明须使用 **`/sdx-apply`** 进入第二阶段。
- **允许**：仅写入或更新 **seedpacespec 变更目录**内约定产物（如 `seedpacespec/changes/active-change/<name>/` 下的 `.md`）、根目录 **`architecture.md`**、以及运行 **`seedpacespec` CLI** 创建变更目录。

---

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.guided` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `after_prd_resolved` | PRD 就绪后（G3 之后） | hook | 可用于 PRD 校验 |
| `after_decisions_reviewed` | 决策回顾确认后（G6 之后） | hook | 可用于决策后处理 |
| `after_trd_generated` | TRD 生成后（G7 之后） | hook | 可用于 TRD 后处理 |

若无 `plugins` 配置 → 正常执行。

---

## State Machine Gates

执行前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得进入后续步骤。**

| # | 状态 | 完成条件 | 未完成时行为 |
|---|------|---------|-------------|
| G1 | `change_bound` | 用户已选择已有变更或新建变更，kebab-case 名称已确定 | AskQuestion 列出已有变更供选择 |
| G2 | `architecture_resolved` | architecture.md 存在，或用户选择跳过 | AskQuestion 询问是否补充 |
| G3 | `prd_resolved` | PRD 已就位（探测/生成/指定路径/跳过） | AskQuestion 收集 PRD 来源 |
| G4 | `context_loaded` | architecture.md + 记忆 + PRD + global-specs 已读取 | 执行上下文加载 |
| G4.5 | `scope_profile_resolved` | 用户已确认**需求体量画像**、**`sdx:design-mode`** 与 **Q&A 深度预设**（见 Step 4.5） | AskQuestion + 推断 |
| G5 | `decisions_collected` | 所有技术决策问题已回答（深度受 G4.5 约束） | 一问一答循环 |
| G6 | `decisions_reviewed` | 决策回顾展示，用户确认 | AskQuestion 展示决策表 |
| G7 | `artifacts_generated` | proposal.md + design.md + TRD 已写入 | 按依赖序生成产物 |
| G8 | `tasks_generated` | tasks.md 已基于确认的 TRD 创建 | 生成 tasks |

**状态推进单向** G1→G2→…→G4→**G4.5**→G5→G6→G7→G8，不得跳跃。

### 恢复协议（已有变更被选中时）

当步骤 1 确定的变更名对应的目录已存在时触发。

**强制 AskQuestion 询问意图**：

> 检测到变更 `<name>` 已存在。请选择你的意图：

| 选项 | 含义 | 后续行为 |
|------|------|---------|
| **A：从头开始** | 抛弃旧产物，从头走 G1→G8（含 G4.5） | 二次确认覆盖 → 全流程 |
| **B：断点恢复** | 上次中断了，从断点继续 | 扫描产物推断断点 gate |

> **📋 恢复协议 用户可见文案模板**：
> - question: "检测到变更「{name}」已存在，请选择你的意图："
> - option 1: label="从头开始" description="放弃已有产物，重新走完整流程（会覆盖已有文件）"
> - option 2: label="从上次中断处继续" description="检测已完成的步骤，从断点处恢复流程"

**🚫 禁止编造跳过理由**：AI 不得以任何自创名义跳过门禁。

---

**输入**：`/sdx-guided` 后的参数为变更名（kebab-case），**或**对要做内容的描述，**或**不提供参数。

**步骤**

## Step 1：选择或新建变更（→ G1）

与 sdx-propose 步骤 1 完全相同：

**1a. 若用户已提供明确的变更名（kebab-case）**：直接使用。

**1b. 若未提供输入**：运行 `seedpacespec list --json`（或扫描 `seedpacespec/changes/active-change/` 目录）获取已有变更列表。

使用 **AskQuestion** 询问：

> 请选择要推进的变更，或新建一个：

选项（动态生成）：
- 已有变更逐个列出
- 最后一个选项固定为：**新建变更**

用户选择「新建变更」→ AskQuestion 开放式提问「请描述你想构建的内容」→ 推导 kebab-case 名称 → AskQuestion 确认名称。

**1c. 变更名确定后**：检查 `seedpacespec/changes/active-change/<name>/` 是否已存在 → 已存在则触发恢复协议。

## Step 2：architecture.md（→ G2）

- 检查项目根目录是否存在 `architecture.md`。
- **不存在**：**AskQuestion**「是否要补充 architecture.md？」→ 是则执行 `/sdx-analyzer-project`；否则记录风险后继续。
- **已存在**：进入下一步。

## Step 3：PRD 就绪（→ G3）

与 sdx-propose 的 PRD 解析逻辑**完全相同**：

**探测顺序**（任一命中即 G3 通过）：
1. `seedpacespec/changes/active-change/<变更名>/specs/*-prd.md`
2. 变更目录根下 `*-prd.md` 等历史约定

**若未探测到 PRD**：**AskQuestion** 给出选项：

> **📋 PRD 来源 用户可见文案模板**：
> - question: "未找到 PRD 需求文档，请选择如何提供："
> - option 1: label="现在生成" description="根据你的描述，现场生成一份 PRD 需求文档"
> - option 2: label="已有文件，指定路径" description="PRD 已存在于其他位置，告诉我文件路径"
> - option 3: label="暂不提供" description="跳过 PRD，后续基于推断生成（会标注风险）"
> - option 4: label="还没有 PRD，先去 explore 澄清" description="执行 `/sdx-explore`：对话澄清需求并可选生成 PRD；意图与讨论性场景分流在 explore 内完成"

选项 A：走 figma-to-prd 或其它 PRD 生成流程。
选项 B：读取路径，复制到 `specs/`。
选项 C：记录风险后继续。
选项 D：**终止 guided**，输出指引——执行 **`/sdx-explore`**（建议带上当前变更名 **`{name}`**，便于 PRD 落入同一变更目录）；explore 完成并写入 PRD 后，再执行 **`/sdx-guided {name}`** 继续。不在此路径现场生成 PRD。

**PRD 需求编号检查（条件触发 · 进入 Step 4 之前）**

与 **sdx-propose 阶段 4** 一致：在 PRD 已就位且 **Read** 全文后（「暂不提供 PRD」跳过本节）：

1. 扫描：`R01` 样式 `\bR\d{2}\b`，以及常见写法 `\bR-\d{2}\b`（如 `R-01`）。  
   - **两种均无**：缺少可识别 R 编号 → **必须 AskQuestion**，不得静默进入 Step 4。  
   - **仅有 `R-01` 类**：**建议** AskQuestion 是否归一成正文 `R01`（非强制）。  
   - **已有 `R01`…**：可继续；编号混乱时**建议** `/sdx-prd-numbering`（非强制）。

2. **AskQuestion（`R\d{2}` 与 `R-\d{2}` 均未检出时强制）**：question 与选项同 propose —「现在归一化」/「保持原文记风险继续」/「稍后自行处理」。选「现在归一化」→ 执行 `.cursor/skills/seedpacespec-prd-numbering/SKILL.md` 后再进入 Step 4。

<!-- slot:after_prd_resolved -->

## Step 4：上下文加载（→ G4）

依次加载以下内容作为后续 Q&A 的上下文基础：

1. **architecture.md**（若存在）：提取分层结构、技术栈约束、编码约定
2. **反馈记忆**：按 `_shared/memory-protocol.md` 的"读取时机"执行——读取 `seedpacespec/config.yaml` 的 `memory.enabled`，为 `true` 时读取 `seedpacespec/memory/team-feedback.md` 和 `personal-feedback.md`（若存在），作为 Q&A 推荐的约束
3. **PRD**：提取 R-ID 列表和需求描述
4. **global-specs/**（若存在）：读取所有 `.md` 作为项目背景；**优先**打开文件名或路径中含 **`CHANGELOG`**、**`changelog`**、**变更记录**、**功能记录** 的文档（若存在），用于判断「能力是否已交付过、本次是否属域内迭代」——**仅作线索**，不替代 PRD。
5. **（可选，对话中提前收集）** 若用户已声明**参考代码路径**或 **归档变更名**，记录待下述 Step 4.5 纳入推断（不在 Step 4 强制 AskQuestion）。

**记忆是线索而非事实**——引用记忆中涉及具体路径、函数名、技术选型的条目时，必须先验证当前是否成立。

## Step 4.5：需求画像与设计模式 / 问答深度（→ G4.5）

⛔约束：**须先于 Step 5 执行**。推断次序与 **seedpacespec-propose §5.3** 一致：**步骤 1（仅 PRD）**定体量 → `design_mode` + `qa_depth`；**步骤 2（全局上下文 + 用户明示）**定落点与相对历史架构的关系 → `placement`、文件树与集成顺序。**禁止混用**：已知模块上大改版仍属步骤 2 的延续边界，**lite/full 与问答深度由步骤 1（PRD）决定**。用语与 propose 对齐：§5.3 正文称 **步骤 1 / 步骤 2**；§5.2「**5.3 轨道 A（体量）/ 轨道 B（落点与延续）**」与本节两步一一对应。

### 4.5.0 可选：补充参考输入（若 Step 4 尚未声明）

若用户尚未提供**参考代码路径**或**归档变更名**，可在此处 **AskQuestion** 一次（须含「跳过/无」选项）：「是否提供参考代码目录或 `seedpacespec/changes/archived/` 下变更名，便于 **步骤 2 落点**？」——答复纳入推断。**非强制**。

### 4.5.1 推断次序（模型自执行 · 两步 · 禁止混用）

**执行主体**：大模型在发起 **4.5.4** 汇总 AskQuestion 之前**自行完成**步骤 1、步骤 2——**不需要**用户填写「步骤 1 / 步骤 2」的单独表单。

**分工**：步骤 1 → **`design_mode`、`qa_depth` 建议**；步骤 2 → **`placement`**、design 中模块挂载、文件树与集成表述；步骤 2 **不得改写**步骤 1 对体量的判断。

| 步骤 | 判断什么 | **唯一或主要信息源** | 产出用途（guided） |
|------|----------|----------------------|----------------------|
| **步骤 1 — 体量** | 本次需求是否大到需要 **full** design 与偏 **deep** 的问答？ | **仅 PRD** | **`design_mode`、`qa_depth` 建议**、摘要中的「体量」句 |
| **步骤 2 — 落点与历史架构关系** | 落在已知模块内演化，还是单独新增一小块（新开目录或包），还是 PRD 要求脱离历史、重做或替换架构？ | **architecture.md**、`seedpacespec/global-specs/`（含变更记录）、Step 4 / 4.5.0 的参考代码与归档、用户明示 | **`placement`**、Step 5～7 集成顺序与文件树 —— **不参与** lite/full 与 `qa_depth` |

**补充规则（表中已列信息源与产出，此处只写增量约束）**

- **步骤 1**：拿不准体量时 **重读 PRD**（R 条数、场景复杂度、主链路、跨系统/合规/中间件等）；**新模块名 / 新目录 / 新入口** 若 PRD 仍描述为少量交互、局部能力，可判小体量 → 倾向 lite + compact/standard。**禁止**用步骤 2 的信号（global-specs、老模块、参考代码）推 lite/full。
- **步骤 2**：默认在已知模块或分层内 **在历史架构上演化**（既有目录与边界内拓展）；单独新功能块在文件树中单独标明。若 PRD/上下文要求 **新架构、替换栈、推翻边界**，允许与仓库历史不一致，**design 须显著说明**为何不沿用历史及取舍。在历史边界上演化、或同边界大改版时须写清沿用理由；**体量与 qa_depth 仍只由步骤 1 决定**。禁止用步骤 2 推「需求一定 lite」；「已有同类功能 / 优化」与参考代码 **仅用于落点**，不自动 lite。**历史模块上大改版**仍须在模块边界内延续设计，但 **deep/full** 由步骤 1 决定。

### 4.5.2 常见误判（必读）

| 误判 | 严谨说法 |
|------|----------|
| global-specs / changelog 显示域内迭代 → 一定 lite | **错误**。只说明落点（步骤 2）；体量看 PRD（步骤 1）。 |
| 有关联 / 老模块上改 → 一定 lite | **错误**。只说明可在既有模块上拓展；老模块上大改版体量仍可很大。 |
| PRD 落在内部仓库路径 → 问答一定 compact | **错误**。路径归属是步骤 2；**deep** 由 PRD 复杂度（步骤 1）决定。 |

### 4.5.3 会话内变量（经 4.5.4 锁定后供 Step 5～7）

- **进入 4.5.4 前**：根据 **步骤 1** 准备好 **`design_mode`、`qa_depth`** 的推荐（每条理由都能对应到 **PRD**）；根据 **步骤 2** 视需要记下 **`placement`**（示例：`extend_known_module` / `new_independent_feature` / `cross_module`）。
- **用户在 4.5.4 确认后**：锁定 **`design_mode_choice`、`qa_depth_choice`**；写 **design.md** 时文末 **`<!-- sdx:design-mode -->`** 与锁定值一致即可。

### 4.5.4 AskQuestion（一轮汇总确认）

**用户可见文案**（口语化亦可；须交代三件事：**需求复杂度**、**改动范围一句话**、**推荐的设计深度与问答轮数**）

- question: "需求复杂度：{一句话，可点名 Rxx}。改动范围：{改哪里——延续既有模块 / 单独新开一小块 / 跨模块；若不沿用旧架构，简述原因}。建议设计深度：**精简 / 完整**；问答轮数：**紧凑 / 标准 / 深入**。是否采纳？"
- option 1: label="采纳建议" description="按推荐的设计深度与问答轮数继续"
- option 2: label="调整设计深度" description="自行选择精简或完整（精简模式下技术方案会更简要）"
- option 3: label="调整问答轮数" description="选择紧凑（少问快推进）、标准或深入（多轮确认细节）"
- option 4: label="我手动说明" description="用一句话告诉我你期望的设计详细程度"

用户确认后锁定 **`design_mode_choice`** 与 **`qa_depth_choice`**，再进入 Step 5。

⛔约束: 未经 G4.5 不得进入 Step 5。

---

## Step 5：一问一答决策收集（→ G5）

⛔ 核心步骤: **本步骤是 sdx-guided 的核心差异点**。与 sdx-propose 一次性生成方案不同，此处通过逐个问题引导用户做出技术决策。**问题轮次与维度受 Step 4.5 的 `qa_depth_choice`（步骤 1）约束**；**落点与集成顺序**须对照 Step 4.5 **`placement`（步骤 2）**，优先问清「在既有模块边界内如何改」而非虚构新孤岛；若步骤 2 判定为**弃用历史架构**，问答须对齐 design 中已写明的**新架构理由**，勿强行套旧边界。

### 问题生成规则

1. **动态生成**：基于上下文（architecture.md 约束、记忆偏好、PRD 需求、已有决策）与 **`qa_depth_choice`** 动态推导下一个最关键的技术决策问题。**不使用预设问题列表**。
2. **每次一问**：每轮 AskQuestion **只包含 1 个问题**，等待用户回答后再生成下一个。
3. **附带推荐**：每个问题必须附带 AI 推荐选项及推荐理由（基于上下文推导，非随意猜测）。
4. **记录决策**：用户回答后，将决策以结构化形式记录：`{ question, answer, reasoning, alternatives_rejected }`。
5. **终止判断**：每个回答后，评估是否还有关键决策未覆盖。终止条件：
   - **compact**：已覆盖 PRD 必需的关键决策与集成点，无明显缺口即可结束（或用户喊停）。
   - **standard**：与原先一致——架构分层、状态管理、数据流、组件拆分、复用策略、错误处理等与 PRD 相关的维度均已决策（按实际栈裁剪）。
   - **deep**：在 standard 基础上，补充性能、兼容、降级、边界、观测、安全等维度中 PRD 涉及的项。
   - 或用户主动说"够了"/"差不多了"/"没其他问题了"

### 问题类型（动态生成，以下仅为示例方向）

- **技术选型**：状态管理方案、数据获取方式、缓存策略、认证方案等
- **架构模式**：组件拆分策略、分层方式、模块职责边界
- **复用决策**：新建 vs 复用现有模块/组件/工具函数
- **边界决策**：错误处理策略、降级方案、性能约束
- **集成决策**：与现有系统的对接方式、API 契约

### 问题文案规范

每个问题的 AskQuestion 格式：

> **📋 Q{N} 用户可见文案模板**：
> - question: "{自然语言问题描述}（推荐：{推荐选项}，原因：{一句话推荐理由}）"
> - option 1~N: 根据问题动态生成 2~4 个选项
> - 每个选项的 description 说明该选择的含义和影响

**示例**：

> - question: "本功能的状态管理方案？（推荐：Zustand，原因：项目已有使用且足够轻量）"
> - option 1: label="Zustand" description="轻量状态管理，项目中已有实践"
> - option 2: label="React Context" description="内置方案，无额外依赖，适合简单场景"
> - option 3: label="Redux Toolkit" description="功能完整的状态管理，适合复杂状态逻辑"

### 交互风格

- **好奇而非说教**：以了解用户意图为目标，而非展示 AI 知识
- **推荐但不强加**：给出推荐和理由，尊重用户选择
- **简洁直接**：每个问题聚焦一个决策点，不混合多个问题
- **上下文关联**：后续问题基于前序决策调整——例如用户选了 Zustand 后，不再问"是否需要全局状态管理"

## Step 6：决策回顾（→ G6）

约束:⛔ 必须等待确认

G5 中所有决策收集完毕后，输出决策回顾表：

```markdown
## 决策回顾

| # | 决策点 | 选择 | 推荐理由 | 否决选项 |
|---|--------|------|---------|---------|
| 1 | 状态管理 | Zustand | 轻量 + 项目一致性 | React Context, Redux |
| 2 | 数据获取 | TanStack Query | 缓存 + 自动重试 | SWR, 原生 fetch |
| ... | ... | ... | ... | ... |
```

**AskQuestion**（必须等待确认后才能继续）：

> **📋 决策回顾 用户可见文案模板**：
> - question: "以上是本次所有技术决策，请确认或指出需要修改的项："
> - option 1: label="确认，继续生成" description="所有决策无误，开始生成产物"
> - option 2: label="需要修改" description="有些决策需要调整，请告诉我要改哪些"

**若用户选择修改**：进入修改循环——用户指出哪些决策需要调整 → AI 更新决策记录 → 重新展示回顾表 → 再次确认。循环直到用户确认。

<!-- slot:after_decisions_reviewed -->

### 记忆收集（G6 确认后执行）

遵循 `_shared/memory-protocol.md` 执行以下分析：

1. **⚖️ 决策收集**（主要来源）：Q&A 过程中用户做出的技术选型——AI 给了推荐但用户选了别的，或用户主动解释了"为什么选 X 不选 Y" → 记录为决策偏好
2. **❌ 纠正收集**：AI 推荐被拒绝且指向一个可复用的决策倾向（如"总是选轻量方案"、"不用 enum 用 union type"） → 记录为纠正
3. **✅ 肯定收集**：用户对某个推荐给出明确正面信号（"对就该这样"、"这个选得好"）且包含取舍判断 → 记录为肯定

**写入规则**：
- 每次确认循环最多写入 1 条
- 只记录"判断偏好"——代码和文档推断不出的岔路口决策
- 默认写入 `team-feedback.md`；仅当用户说"这是我个人偏好"时写 `personal-feedback.md`
- 写入前简短告知用户，无需等待确认
- 写入前检查是否已有类似条目 → 有则更新而非重复添加

## Step 7：产物生成（→ G7）

基于决策回顾确认的内容，一次性生成所有产物。

### 7.1 proposal.md

为兼容 seedpacespec 产物规范而保留，用于**标记变更产物状态**；**不作为** OpenSpec 式长提案阅读。**需求内容一律以 PRD 为准**。

内容仅需与 **seedpacespec-propose** 同款占位——引用 PRD，不展开「做什么/为什么/影响范围」正文：

```markdown
# Proposal — <change-name>

> PRD: `specs/<prd-file>.md`
```

### 7.2 design.md（guided 模式）

**不使用** `design-template-lite.md` / `design-template.md` **全文**，始终以 **Q&A 决策**为核心组织正文；**末尾标记**由 **Step 4.5** 锁定的 **`design_mode_choice`**（`lite` / `full`）写入，供 TRD generator §4.5 联动。

**共用骨架**（lite / full 均输出）：

```markdown
# {变更名称} - Design

## 功能点与约束
{从 PRD 提取的功能点表 + 约束表}

## 技术决策
{从决策回顾表展开，每个决策点包含：}

### D{N}: {决策点}
- **选择**: {选中方案}
- **理由**: {为什么选这个}
- **否决**: {否决了什么，为什么}

## 改动范围
| 涉及模块 | 归属层（architecture.md） | 改动概述 |
|---------|------------------------|---------|

## 模块与文件结构（树状图）
{受影响的文件子树，标注新增/修改；须体现 Step 4.5 **步骤 2** 的结论——已知模块则挂在既有路径下拓展，单独新增一小块功能（新开路径）则单独标明；若弃用历史架构须已写明原因；**不以「挂在老模块」暗示体量小**}

## 风险
{改动风险，无则写"无显著风险"}
```

**若 Step 4.5 选定 `full`**：须在上述骨架中 **插入**章节 **「架构影响与模块关系」**（放在「技术决策」之后、「改动范围」之前），至少包含：与 **architecture.md** 对齐的分层/域说明、跨模块依赖或主链路一句话、若有跨子系统则列出接口边界。**不要求**照搬 `design-template.md` 全书。

**末尾标记（强制）**：与 **seedpacespec-propose** 一致——先 status，再 **与 Step 4.5 `design_mode_choice` 一致**：

```markdown
<!-- sdx:status=confirmed -->
<!-- sdx:design-mode=lite -->
```
或 `<!-- sdx:design-mode=full -->`。

⛔ **大需求但 Step 4.5 仍选 lite**：若用户为缩短文档刻意选 lite，可选在文末加注释说明已知晓 TRD 偏 Eval：`<!-- sdx:design-mode-note=prefers-lite-despite-scope -->`（非强制）。

> design 正文无需额外确认循环——决策已在 G5/G6 确认；**`sdx:design-mode` 已在 Step 4.5 锁定**，此处仅落盘。

### 7.3 TRD（Eval 风格）

写入 `trds/{变更名}_trd.md`。**不使用 trd-skeleton.md 模板**，按 Eval 输出模板生成：

参考 `templates/trd-eval-template.md` 格式。

核心原则：
- 每个 R-ID 逐文件列出改动内容、改动方式、改动意图
- 涉及 UI 变更时体现组件级改动
- 不要求完整的组件树/状态归属/逻辑单元设计等展开
- 风险点和依赖必须标注

```markdown
<!-- sdx:status=confirmed -->
```

> TRD 无需额外确认循环——所有技术决策已在 G5/G6 中确认，TRD 只是决策的结构化落地。

<!-- slot:after_trd_generated -->

## Step 8：生成 tasks（→ G8）

基于已确认的 TRD，生成 `tasks.md`。

**tasks.md 格式**必须与 sdx-apply 兼容：

```markdown
# {变更名} - Tasks

## R{id}: {需求简述}
- [ ] {任务描述} — {涉及文件}
- [ ] {任务描述} — {涉及文件}

## R{id}: {需求简述}
- [ ] {任务描述} — {涉及文件}
```

每个任务：
- 对应 TRD 中的一个改动点
- 描述足够明确，sdx-apply 可直接执行
- 标注涉及的文件路径

**生成后 AskQuestion 确认**：

> **📋 Tasks 确认 用户可见文案模板**：
> - question: "以上是生成的实现任务列表，确认后可执行 `/sdx-apply` 开始编码："
> - option 1: label="确认" description="任务无误，后续执行 /sdx-apply 开始实现"
> - option 2: label="需要调整" description="部分任务需要修改"

---

## Guardrails

| # | 断言 | 违反后果 |
|---|------|---------|
| 1 | 每次 AskQuestion 只包含 1 个技术决策问题（G5 阶段） | 违反一问一答核心约束 |
| 2 | 不得跳过 G6 决策回顾 | 用户失去最终确认机会 |
| 3 | 不得在 **G4.5**（需求画像与 design 标记 / 问答深度确认）完成前进入 Step 5；不得在 G6 完成前进入 Step 7 | 问答深度与标记未锁定即跑偏 |
| 4 | 不得生成业务代码 | 第一阶段硬性约束 |
| 5 | 记忆收集遵循 memory-protocol.md | 过度或不当记录 |
| 6 | tasks.md 格式必须与 sdx-apply 兼容 | 下游流程中断 |
| 7 | 门禁单向推进 G1→…→G4→**G4.5**→G5→G6→G7→G8 | 流程完整性 |
| 8 | PRD 全文既无 `\bR\d{2}\b` 也无 `\bR-\d{2}\b` 时须完成 Step 3「编号检查」AskQuestion（或归一化）后再进入 Step 4 | TRD/tasks 与 PRD 无法对齐 |
