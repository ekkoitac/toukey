---
name: seedpacespec-propose
id: seedpacespec-propose
category: Workflow
description: >
  提议新变更——从需求出发，一步生成 proposal、design、TRD、tasks 全部产物。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"做个新功能"、"我要加个XX"、"开始规划"、"新需求"、"创建变更"。
  SKIP: 用户想改已有设计方案（用 sdx-update-task）；用户想直接写代码实现（用 sdx-apply）；用户只是想聊想法还没确定（用 sdx-explore）。
  requires: seedpacespec CLI 已安装；建议先有 architecture.md。
  output: seedpacespec/changes/active-change/<name>/ 下的 proposal.md、design.md、tasks.md、*_trd.md。
  examples: "/sdx-propose 用户登录功能" → 触发；"我想加个登录" → 仅在 sdx 会话上下文中触发。
---

# seedpacespec-propose

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.propose` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名                   | 位置                                       | 说明                             |
|--------------------------|--------------------------------------------|----------------------------------|
| `after_prd_resolved`     | PRD 就绪后（阶段 4 之后）                  | PRD 校验、额外文档生成           |
| `after_design_confirmed` | design.md 文件树确认后，TRD 生成前（阶段 5.3 之后） | 额外评审、架构图生成   |
| `after_trd_confirmed`    | TRD 确认后，生成 tasks 前（阶段 5.5 之后） | SOP 生成、TRD 后处理             |
| `after_tasks_created`    | tasks 生成后（阶段 5.6 之后）              | 任务后处理、通知                 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配条目 → 有则加载执行，完毕后回到主流程 → 无则跳过。若无 `plugins` 配置 → 正常执行。

---

## Goal

提议一个新变更——创建变更目录并一步生成所有产物：

- proposal.md（做什么与为什么）
- design.md（怎么做）
- TRD（实现方案，精确到代码实体）
- tasks.md（实现步骤）

准备开始实现时，执行 `/sdx-apply`。

**输入**：`/sdx-propose` 后的参数为变更名（kebab-case），或对要做内容的描述，或不提供参数。

---

## State Machine Gates

⛔ 约束 [GL2]: 任何门禁未完成 → 只能 AskQuestion，不得进入后续步骤。状态推进单向 G1→G9，不得跳跃。

| #  | 状态                    | 完成条件                                                                 | 未完成时行为                     |
|----|-------------------------|--------------------------------------------------------------------------|----------------------------------|
| G1 | `input_understood`      | 用户已选择已有变更或新建变更，kebab-case 名称已确定                      | AskQuestion 列出变更或询问新建   |
| G2 | `architecture_resolved` | architecture.md 存在，或用户选择补充/跳过                                | AskQuestion 询问是否补充         |
| G3 | `change_created`        | `seedpacespec new change` 已执行，变更目录存在                           | 执行 CLI 创建目录                |
| G4 | `prd_resolved`          | PRD 已落在变更目录 `specs/`，或用户确认现场生成/已提供路径/明确跳过并记风险 | AskQuestion 收集 PRD 来源        |
| G5 | `design_mode_selected`  | 用户已通过 AskQuestion 确认 design.md 使用完整模式或精简模式             | AskQuestion 推荐并让用户选择     |
| G6 | `schema_artifacts_done` | proposal + design（含已确认文件树）已创建                                | 按依赖序生成产物                 |
| G7 | `trd_confirmed`         | TRD 已生成且用户确认不需修改（确认循环通过）                             | AskQuestion 确认循环             |
| G8 | `tasks_created`         | tasks.md 已基于确认的 TRD 创建                                          | 生成 tasks                       |
| G9 | `summary_output`        | 产物总结已输出给用户                                                     | 输出产物总结                     |

⛔ 约束: 禁止编造跳过理由——不得以任何自创名义（恢复协议、追加模式、精简流程、复用已有产物等）跳过门禁。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。

---

## 恢复协议

**用途**：当执行流程阶段 1 确定的变更目录已存在时，本协议决定从执行流程的哪个阶段开始执行。下方"恢复起点"列中的阶段编号对应「执行流程」章节中的阶段编号（如"阶段 5.4"= 执行流程 → 阶段 5 → 5.4 TRD 生成）。

⛔ 约束 [GL5]: 恢复协议不可跳过。当变更目录已存在时，必须 AskQuestion 询问意图，不得自行推断或替用户决定。

**触发条件**：`seedpacespec/changes/active-change/<name>/` 已存在。

**用户可见文案**：
- question: "检测到变更「{name}」已存在，请选择你的意图："
- option 1: label="从头开始" description="放弃已有产物，重新走完整流程（会覆盖已有文件）"
- option 2: label="追加新模块" description="保留已有内容，仅为新模块生成技术方案和任务"
- option 3: label="从上次中断处继续" description="检测已完成的步骤，从断点处恢复流程"

### 选项 A：从头开始

- 二次确认后，从阶段 3 开始正常执行全流程
- 已有产物会被覆盖

### 选项 B：追加新模块

- 跳过阶段 3~5.3（变更目录、PRD、proposal、design 均复用）
- 精简阅读上下文：PRD + design.md（文件树）+ 已有 TRD 列表 + 现有 tasks.md
- 进入阶段 5.4：调用 **TRD generator skill**（推荐模式 C 或 D），生成新 R 的 TRD
  - ⛔ 约束: **“TRD 生成模式”专指 `@.cursor/skills/seedpacespec-trd-generator` 的 Step 4 §4.1（Q3）里让用户选择的生成模式（A/B/C/D）**，必须由 trd-generator 发起 AskQuestion 让用户选定；`seedpacespec-propose` 禁止替用户代选/推断模式
  - 新 TRD 文件写入 `trds/` 目录，不覆盖已有 TRD 文件
  - 若用户要更新已有 TRD → 使用 **TRD generator** 的 B 模式增量更新
- 进入阶段 5.6：增量追加 tasks（保留已有 R section 及状态不变，在末尾追加新 R section）

### 选项 C：断点恢复

扫描变更目录中的产物文件 → 推断已通过的 gate：

| 已存在的产物                                              | 推断状态         | 恢复起点                         |
|----------------------------------------------------------|------------------|----------------------------------|
| 目录存在，无产物                                          | G3 已过          | 阶段 4（PRD）                    |
| proposal.md 存在                                          | G5 进行中        | 阶段 5（继续 design）            |
| proposal + design 存在（`<!-- sdx:status=draft -->`）     | design 未经确认  | 阶段 5（重新进入 design 确认循环）|
| proposal + design 存在（`<!-- sdx:status=confirmed -->`） | G5 已过          | 阶段 5.4（TRD）                  |
| proposal + design + TRD 存在（`<!-- sdx:status=draft -->`）| TRD 未经确认    | 阶段 5.5（重新进入 TRD 确认循环）|
| proposal + design + TRD 存在（`<!-- sdx:status=confirmed -->`）| G6 已确认  | 阶段 5.6（生成 tasks）           |
| proposal + design + TRD + tasks 存在                      | G7 已过          | 展示完成状态，提示是否选 B       |

> **状态标记**：design.md 和 TRD 文件末尾的 `<!-- sdx:status=draft|confirmed -->` 用于区分"生成到一半被中断"和"已经用户确认"。若文件存在但无标记，视为 `confirmed`（兼容旧版本）。  
> **设计模式标记**：design.md 另须包含 `<!-- sdx:design-mode=lite -->` 或 `<!-- sdx:design-mode=full -->`（与 propose 完整/精简模板一致）；缺省时 TRD 不按 lite 偏好推断。

⛔ 约束: 推断出断点 gate 后，必须 AskQuestion 展示推断结果并确认：「检测到已有产物 [列表]，推断从 G<N> 继续。是否从此处恢复？」禁止静默跳跃。

---

## 执行流程

### 阶段 1：选择或新建变更（→ G1）

**1a. 若用户已提供明确的变更名（kebab-case）**：直接使用该名称，跳到 1c。

**1b. 若未提供输入**：运行 `seedpacespec list --json`（或扫描 `seedpacespec/changes/active-change/` 目录）获取已有变更列表。

使用 **AskQuestion** 询问：

> 请选择要推进的变更，或新建一个：

选项（动态生成）：
- 已有变更逐个列出，每个选项显示：`<kebab-case 名称>`（附带简要状态：已有哪些产物）
- 最后一个选项固定为：**新建变更**

- 用户选择已有变更 → 使用该名称，进入 1c
- 用户选择「新建变更」→ AskQuestion 开放式提问「请描述你想构建或修复的内容」→ 推导 kebab-case 名称 → **AskQuestion 确认**名称

**1c. 变更名确定后**：检查 `seedpacespec/changes/active-change/<name>/` 是否已存在。
- **不存在** → 新建流程，进入阶段 2
- **已存在** → 触发恢复协议（见「恢复协议」章节）

⛔ 约束: 在尚未确定变更名和意图之前，不要继续往下执行。

---

### 阶段 2：architecture.md 检查（→ G2）

- 检查项目根目录是否存在 `architecture.md`
- **已存在**：进入下一步
- **不存在，但项目已有代码**：AskQuestion「是否要补充 architecture.md？」→ 选是则执行 `/sdx-analyzer-project`；选否则记录风险后继续
- **不存在，且为全新项目（无已有代码或仅有脚手架）**：AskQuestion 让用户选择：
  - option 1: label="指定技术栈" description="告诉我使用的技术栈（如 React+TS、Spring Boot、Flutter 等），我基于标准分层架构确定通用层"
  - option 2: label="直接开始" description="后续在 design.md 中根据需求推导分层，暂不预设"
  - 选"指定技术栈"→ 记录用户声明的技术栈，后续 design.md 和 TRD 基于该技术栈的标准通用层组织模块
  - 选"直接开始"→ 记录风险后继续，design.md 生成时由 AI 根据 PRD 需求推导合适的通用层

---

### 阶段 3：前置准备（→ G3）

**3.1 加载反馈记忆**

按 `.cursor/skills/_shared/memory-protocol.md` 的"读取时机"执行：读取 `seedpacespec/config.yaml` 的 `memory.enabled`，为 `true` 时读取记忆文件作为后续生成约束。

**3.2 加载全局规格上下文**

扫描 `seedpacespec/global-specs/` 目录（若存在）：读取所有 `.md` 文件作为项目背景知识。若无 `global-specs/` → 继续执行，不阻断。

**3.3 创建变更目录**

**恢复协议选项 B/C**：本步跳过——变更目录已存在。

**正常执行**：
```bash
seedpacespec new change "<name>"
```

---

### 阶段 4：PRD 就绪（→ G4）

**探测顺序**（任一路径命中即视为已有 PRD，G4 通过）：
1. `seedpacespec/changes/active-change/<变更名>/specs/*-prd.md`
2. 变更目录根下 `*-prd.md`、`<功能名>_prd.md` 等历史约定（若存在则建议迁移到 `specs/`）

**若未探测到 PRD**：AskQuestion 一次性给出选项：

**用户可见文案**：
- question: "未找到 PRD 需求文档，请选择如何提供："
- option 1: label="现在生成" description="根据你的描述，现场生成一份 PRD 需求文档"
- option 2: label="已有文件，指定路径" description="PRD 已存在于其他位置，告诉我文件路径"
- option 3: label="暂不提供" description="跳过 PRD，后续基于推断生成（会标注风险）"
- option 4: label="还没有 PRD，先去 explore 澄清" description="执行 `/sdx-explore`：对话澄清需求并可选生成 PRD；意图与讨论性场景分流在 explore 内完成"

**选项 D（先去 explore）的执行**：

1. **终止本 skill**，不进入阶段 5，不在此路径现场生成 PRD（避免与 explore 重复）。
2. 输出下一步指引（示例）：
   - 执行 **`/sdx-explore`**；若当前已有变更名 **`{name}`**（阶段 1 已确定且阶段 3 可能已创建目录），建议在指令或首轮对话中带上该名称，便于 PRD 落入 `seedpacespec/changes/active-change/{name}/specs/`。
   - explore 完成澄清并写入 PRD 后，再执行 **`/sdx-propose {name}`**（或用户改用 guided）继续生成 design/TRD/tasks。
3. ⛔ 约束：不得以「在这里顺手生成一版 PRD」代替用户选择去 explore。

**选项 B（已有文件）的执行**：
1. 确认文件存在且为文本 Markdown
2. 确保 `specs/` 目录存在
3. **复制**到 `specs/`（不删除源文件）
4. 复制完成后再次探测确认 G4 已通过

**若 PRD 已在变更目录但不在 `specs/`**：整理进 `specs/` 并统一命名。

**PRD 需求编号检查（条件触发 · 进入阶段 5 之前）**

在 PRD 文件已落入 `specs/` 且可用 **Read** 读取全文后（「暂不提供 PRD」跳过本节）：

1. **快速检测**（Read 全文后执行）：  
   - **标准形态**：`\bR\d{2}\b`（如 `R01`、`R09`）。  
   - **常见非标准但仍算「有 ID」**：`\bR-\d{2}\b`（如 `R-01`，下游归一化时会等价处理）。  
   - **两者皆无**：视为 **缺少可识别的 R 需求编号**，**必须 AskQuestion**，不得静默进入阶段 5。  
   - **仅有 `R-01` 类而无 `R01` 类**：**建议** AskQuestion 是否执行 `/sdx-prd-numbering` 统一为 `R01` 正文写法（非强制）。  
   - **已有多处 `R01`/`R02`…**：可进入阶段 5；若明显缺号、跳号或与小节无法对应，**建议** AskQuestion 是否归一化（非强制）。

2. **AskQuestion（在「标准形态与非标准形态均未检出」时强制）**  
   - question: "当前 PRD 中未检测到标准的 `R01` / `R02` … 需求编号。下游 TRD、tasks 通常依赖该编号对齐。请选择："  
   - option 1: label="现在归一化" description="执行 `/sdx-prd-numbering`，按 seedpacespec-prd-numbering skill 补齐编号（写回或另存）"  
   - option 2: label="保持原文，标注风险继续" description="不改编 PRD；在后续产物或备注中记录「PRD 无 R 编号」风险"  
   - option 3: label="稍后自行处理" description="中断本流程，你先改完 PRD 再继续"

3. 用户选「现在归一化」→ **必须**加载并遵循 `.cursor/skills/seedpacespec-prd-numbering/SKILL.md` 全文执行，完成后再回到阶段 5。

<!-- slot:after_prd_resolved -->

---

### 阶段 5：创建产物（→ G5/G6/G7）

**5.1 创建 proposal.md**

为兼容 seedpacespec 产物规范而保留，用于标记产物状态。内容仅需一句话引用 PRD：

```markdown
# Proposal — <change-name>

> PRD: `specs/<prd-file>.md`
```

**若经恢复协议选项 B 进入**：跳过——已存在并复用。

**5.2 参考资料收集（design 生成前，必做）**

⛔ 约束: 收集参考资料是必须行为。本节素材主要用于 **5.3 轨道 B（落点与延续）**——帮助判断变更挂在哪个模块、是否延续既有架构；**不用于**替代 PRD 判断需求体量（体量仅 **5.3 轨道 A**）。

使用 AskQuestion 询问用户是否有参考输入：

**用户可见文案**：
- question: "生成设计方案前，是否有参考资料？"
- option 1: label="有参考代码" description="项目中已有类似实现可以参考"
- option 2: label="有已归档的变更" description="之前完成的变更中有可参考的设计"
- option 3: label="有外部参考" description="有外部文档、链接或其他参考资料"
- option 4: label="没有，直接生成" description="基于 PRD 和项目架构直接生成设计方案"
- option 5: label="已有同类功能，本次是优化/调整" description="能力已在项目或过往迭代里落地，本轮主要是增强、改版或局部调整"

可多选（option 5 可与 1~4 组合）。若同时勾选 **「没有，直接生成」** 与 **「已有同类功能，本次是优化/调整」** 等明显矛盾项，**先一句对话澄清**再继续。根据用户回复：
- **参考代码**：读取用户指定的文件/目录，提取关键接口、模式、约定
- **归档 specs**：读取 `seedpacespec/changes/archived/` 中用户指定的变更产物
- **外部参考**：读取用户提供的文档/链接内容
- **无参考**：基于 PRD + architecture.md 生成，标注「无参考基线，设计纯由 PRD 驱动」
- **已有同类功能，本次优化/调整**：将本轮视为「在既有能力上的迭代」

**降级标注**：无参考覆盖的模块在 design.md 中标注 `<!-- new-module: no-reference -->`。

**5.3 创建 design.md（→ G5/G6）**

**若经恢复协议选项 B 进入本步**：跳过——已存在并复用。

⛔ 约束: design.md 是软件设计文档——回答"大方向怎么走、系统拆成哪几块、每块为什么这样设计"；不是实现文档（那是 TRD 的事）。

⛔ 约束: **生成模式选择**（生成前必须执行）

#### 推断次序（模型自执行 · 两步 · 禁止混用）

**执行主体**：由**大模型在给出模式推荐之前自行完成**下列两步推断——**不需要**用户填写「步骤 1 / 步骤 2」的单独表单；对用户仍只发起 **一次**文末「精简 / 完整」AskQuestion。

**分工（务必牢记）**：**步骤 1 的结论 → 仅用于推荐精简/完整模式**；**步骤 2 的结论 → 仅用于指导 design 如何相对历史架构落笔**（演化、新开路径或推倒重来）。步骤 2 **不得改写**步骤 1 对体量的判断。

| 步骤 | 判断什么 | **唯一或主要信息源** | 产出用途 |
|------|----------|----------------------|----------|
| **步骤 1 — 体量** | 本次需求**本身**是否大到需要 **design 完整模板**（架构层展开、选型对比、多模块契约等）？ | **仅 PRD** | **仅用于**推荐精简/完整、`sdx:design-mode`、推荐理由里的「体量」句 |
| **步骤 2 — 落点与历史架构关系** | 变更主要落在**已知模块内演化**，还是**单独新增一小块功能（新开目录或包）**，还是 PRD 要求 **脱离历史、重做或替换架构**？ | **architecture.md**、`seedpacespec/global-specs/`（含变更记录）、**5.2** 参考代码与归档、用户明示 | **仅用于**生成 design 时模块怎么挂、树怎么画、与既有分层/边界的关系 —— **不参与**精简/完整判定 |

**步骤 1（体量）——补充规则**

- **新目录 / 新包 ≠ 大体量**；PRD 若为「新入口 + 少量交互」等，即使实现上要新开路径，仍可 **倾向精简**，除非 PRD 同时要求架构级决策或长链路编排。
- **禁止**用步骤 2 的任何信号（global-specs、是否历史模块、参考代码是否在域内）作为步骤 1 的主要依据；拿不准体量时 **重读 PRD**。
- PRD 体现多 R、长流程、跨系统、架构级/合规/中间件等 → **倾向完整**；否则 **倾向精简**。

**步骤 2（落点 / 历史架构演化）——写 design 时必须遵守**

- **默认**：若判定为在**已知模块**或既有分层内交付，**优先**视为在 **历史架构上演化**——在既有目录与边界内做拓展或修改；单独新增一小块功能（新开路径）时在文件树中单独标明。
- **不压制新架构**：若 PRD 或上下文明确要求 **全新架构、替换旧栈、推翻模块边界、与历史彻底切割**，**允许**产出与当前仓库历史不一致的分层或模块划分 —— **不得**为「延续」而强行捆死旧结构。此类情况须在 design **显著位置写清**：**为何不沿用历史架构**、新方案与取舍（迁移/兼容/风险）。
- **在历史架构上修改或延伸时**：须在 design 中写明 **为何在该历史边界上演化**（例如复用约定、调用链对齐、风险可控）；**大型改版但仍沿用同一模块边界**时，同样说明 **沿用该边界的原因**；体量大小仍只由 **步骤 1（PRD）** 决定。
- 「已有同类功能，本次优化/调整」或参考代码指向既有模块：仅用于步骤 2 的落点判断，**不自动**推出精简模式。

**合并进用户可见推理**：发起模式 AskQuestion 前，推荐理由须含 **各一句**——**步骤 1（体量，依据 PRD）**、**步骤 2（落点与是否在历史架构上演化，或为何弃用历史架构）**。

**⛔ 推断约束**

- 「出现新目录或新包」**不等于**完整模式；完整模式须来自 **步骤 1（PRD）** 的决策复杂度与展开必要性。
- 若你认为需完整模式但 PRD 表面篇幅不长，须在推荐理由中点名 **具体 PRD 条目或约束**。
- 仅以「新/旧模块名」「global-specs 有关系」「有参考代码」「出现了新目录」为由推荐完整或精简模式（上述属 **步骤 2** 或表面结构，只辅助落点）；体量须回到 **步骤 1（PRD）**。

按 **步骤 1** 汇总**模式推荐**（**不得以步骤 2 替代步骤 1**）：
⛔ 约束：不可替用户自行推测决定

| 信号（均须能在 PRD 中指认） | 推荐模式 |
|-----------------------------|----------|
| **完整模式**：PRD 要求或隐含 **架构级** 决策（新技术栈、中间件、跨业务域编排、安全/合规基座、长链路多系统契约等） | **完整模式** |
| **精简模式**：PRD 体现为 **小范围功能**（含「新入口 + 少量交互」、且交付边界仍属局部）、**无**上述架构级展开必要 | **精简模式** |
| **边界**：新增模块名但 PRD 体量小、无架构级新决策 → **倾向精简**，理由写明依据 **PRD 哪几条**；若仍推荐完整，须写明 **PRD 依据** |

给出**推荐模式**及**简短推荐理由**（含上述推断要点），然后 **AskQuestion** 让用户最终决定（用户可不采纳推荐）：


**用户可见文案**：
- question: "根据需求复杂度，建议使用「{推荐模式}」生成设计文档。理由：{体量判断一句} + {落点说明一句}。你可以选择不同模式："
- option 1: label="完整模式" description="需求涉及架构决策、技术选型或多模块协作时选用，会生成完整的设计方案"
- option 2: label="精简模式" description="需求范围较小、边界清晰时选用，生成轻量设计文档，快速进入实现"


⛔ 约束: 无论用户选择哪种模式，必须严格按对应模板文件的结构和注释要求输出：
- **blockquote（`>` 开头的段落）是强制生成约束，不是占位注释**，必须逐条遵守
- 完整模式 → 按 `templates/design-template.md` 的章节结构和要求生成
- 精简模式 → 按 `templates/design-template-lite.md` 的章节结构和要求生成

**design.md 末尾机器标记（强制）**：首次写入 `design.md`（draft）及用户最终确认时，文件**末尾**除状态注释外，必须包含与设计模式一致的一行 HTML 注释（供下游 **TRD generator §4.5** 推断深度偏好）：

- 用户选定 **精简模式**：`<!-- sdx:design-mode=lite -->`
- 用户选定 **完整模式**：`<!-- sdx:design-mode=full -->`

与 `<!-- sdx:status=draft|confirmed -->` 一并写在文档最后（推荐两行相邻：`status` 在上，`design-mode` 在下）。若用户在评审中从完整改精简或反之，须同步改写 `design-mode` 后再确认。

精简模式跳过：技术选型与决策、模块总览 ASCII 图、核心模块设计四要素、优缺点自审、复杂模块深化。


**完整模式关键要求**：
1.**撰写 design 正文时（落实步骤 2）**：**模块划分与文件树**须体现步骤 2 的结论——落在已知模块则 **延续既有目录与分层边界** 做拓展/修改；若为**单独新增的一小块功能**（新开路径），须在树中单独标明；若 **弃用历史架构**，须已写明原因（见步骤 2「不压制新架构」）。**精简/完整模板档位仅反映步骤 1（PRD 体量）**，不因「挂在老模块」自动降级篇幅。

2. **技术选型与决策**：用 `[架构级]` / `[模块级]` 标签区分。架构级必须用对比表；模块级可一段话带过。编号 D01~Dnn，后续 TRD 直接引用。
3. **模块总览**：ASCII 图 + 职责表（职责/输入/输出/与周边关系/扩展点）。分层来源规则：
   - architecture.md 已有分层 → 引用并标注每个模块归属的通用层
   - architecture.md 不存在，但项目已有代码 → 基于代码目录结构和职责分布推导通用层，简述依据
   - 全新项目无已有代码 → 基于阶段 2 确定的技术栈标准通用层组织模块（若阶段 2 未指定技术栈，由 AI 根据 PRD 需求推导合适的通用层并在此说明）
   - 无论哪种情况，职责表的"归属通用层"列必须填写软件设计理论中的通用层名（如表现层、服务层、数据层等），确保 TRD §4 可直接按此分层展开
4. **核心模块设计**：每个模块回答"为什么存在/边界/协作/取舍"四要素。不写代码，只讲设计推理。
5. **复杂模块自动深化**：用工程判断识别真正复杂的模块 → 按 `seedpacespec-design-module` Step 3 的粒度深化（到"协作流程 + 边界策略"，伪代码留给 TRD）。不复杂的 → 四要素即可。不要对每个模块都机械深化。
6. **功能点、非功能点与约束**：三张独立表格；非功能点必须有"设计上如何满足"列。
7. **本设计的优缺点**：自我审视。简单变更可写一句话，但不能删除章节。
8. **模块与文件结构（树状图）**：ASCII tree 细化到文件名，与模块总览分层一致。

**评审流程（两轮，完整/精简模式均执行）**：

1. **文件树确认**：写入树状图后 AskQuestion「以上为拟定的模块与文件结构，是否确认？」确认后标注「（已与用户确认）」
2. **整体设计确认**：AskQuestion「当前设计方案是否认可？」
   - 选 **认可** → 立即将末尾 `<!-- sdx:status=draft -->` 替换为 `<!-- sdx:status=confirmed -->`，并确保存在与当前模板一致的 `<!-- sdx:design-mode=lite -->` 或 `<!-- sdx:design-mode=full -->` → 填写评审记录
   - 选 **需要修改** → 修改后重新确认（可反复直到满意）

⛔ 约束 [GL4]: design.md 文件树未经用户确认，不得视为最终结构。

<!-- slot:after_design_confirmed -->

**5.4 TRD 生成（→ G7）**

⛔ 约束: 必须在 proposal + design 创建完成后执行。

**若经恢复协议选项 B 进入本步**：按恢复协议「选项 B：追加新模块」的规则执行——此处的“TRD 生成模式”指 `seedpacespec-trd-generator` 的 Step 4 §4.1（Q3）生成模式选择；由 trd-generator 负责 AskQuestion 让用户选定，新 TRD 写入 `trds/` 不覆盖已有文件。

**正常执行（新变更）**：使用 **TRD generator skill** 生成，输入：PRD、proposal、design、architecture.md。

**5.5 TRD 确认与记忆收集**

> 若 5.4 使用了 trd-generator skill 生成 TRD：trd-generator 已完成确认循环，此处直接跳到 5.6。
> 仅当 TRD 未经 trd-generator 生成时（如手动编写、恢复协议选项 B 中直接编辑），才执行以下流程：

AskQuestion 确认 TRD 是否需要修改：
- 选**不需要修改** →
  1. 立即将 `<!-- sdx:status=draft -->` 替换为 `<!-- sdx:status=confirmed -->`
  2. 执行反馈记忆收集（按 `_shared/memory-protocol.md` 的"收集时机"）
- 选**需要修改** → 通过对话更新 TRD，每次更新后循环重复本步骤

⛔ 约束 [GL5]: TRD 每次更新后必须重新询问用户确认，直到用户明确表示不需修改。

<!-- slot:after_trd_confirmed -->

**5.6 创建 tasks.md（→ G8）**

根据已确认的 TRD 生成任务列表。

⛔ 约束: 只写"做什么、验什么"，不写"怎么实现"——实现方案已在 TRD 中，tasks 只做索引。任务中的路径、模块划分须与 design.md 已确认的文件树对齐。

**若经恢复协议选项 B 进入本步（增量追加）**：
- 读取现有 `tasks.md` 全文，保留已有 R section 及 `[x]`/`[ ]` 状态不变
- 在文件末尾追加本轮新 R 的 task section
- 更新文件头部 `> TRD:` 行和 `> 生成时间:`
- ⛔ 约束: 禁止重写、重排序或删除已有 R section

**正常执行**：按下方格式规范全量生成。

**格式规范**：

```markdown
# Tasks — <change-name>

> PRD: `specs/<prd-file>.md`
> TRD: `trds/<trd-file-1>.md`、`trds/<trd-file-2>.md`
> 生成时间: YYYY-MM-DD

## R01 <PRD 需求标题>

- [ ] **<任务名>** — TRD §x.x
  - [ ] <验收项 1>
  - [ ] <验收项 2>

- [ ] **<任务名>** — TRD §x.x
  - [ ] <验收项 1>
  - [ ] <验收项 2>
  - [ ] <验收项 3>

## R02 <PRD 需求标题>

- [ ] **<任务名>** — TRD §x.x
  - [ ] <验收项 1>
  - [ ] <验收项 2>
```

**生成规则**：
- 按 PRD 需求编号（R01, R02 …）分组，每组标注需求标题
- 每条任务一行 `- [ ] **任务名** — TRD §章节号`，任务名来自 TRD 对应章节的功能描述
- 每条任务下缩进 checklist（`- [ ]` 验收项），是该任务的可验证完成条件，简短一句话
- 不写实现步骤、代码结构、技术方案——这些在 TRD 中已有
- 不写文件路径——路径在 design.md 文件树中已有
- 若 TRD 中某章节覆盖多个功能点，拆为多条任务；若覆盖单一功能，一条即可
- checklist 数量 2~5 条，聚焦关键验收点
- 增量追加时：新 R section 的 TRD §引用指向本轮新生成的 TRD 文件中的章节号

**示例**：

```markdown
## R01 封面与课程初始化

- [ ] **封面 UI 展示** — TRD §4.1
  - [ ] 黑板区域正确展示课程名称
  - [ ] AI 老师正面站位并播报欢迎话术

- [ ] **课件预加载** — TRD §4.3
  - [ ] 三路课件并行拉取
  - [ ] 预加载失败不阻塞跳转

- [ ] **课程目标请求与跳转** — TRD §4.5
  - [ ] 目标数据就绪后自动跳转至"我的目标"
  - [ ] 目标请求超时有兜底处理
```

<!-- slot:after_tasks_created -->

**5.7 产物完成确认**

```bash
seedpacespec status --change "<name>"
```

确认所有产物文件已存在后，展示产物总结。

---

### 产物总结（→ G9，完成后输出）

⛔ 约束: 完成全部产物后，必须输出产物总结。读取 `seedpacespec/config.yaml` 的 `propose.reviewGuide`：为 `true`（默认）时输出完整版（含 📖 review 指南）；为 `false` 时仅输出产物清单和下一步。

**完整版**（`reviewGuide: true` 或未配置时）：

```
✅ 变更 "{name}" 全部产物已创建！

📁 产物目录: seedpacespec/changes/active-change/{name}/

📋 产物清单:

| 产物 | 文件 | 用途 |
|------|------|------|
| proposal | proposal.md | 产物状态占位——引用 PRD，标记变更状态 |
| PRD | specs/*.md | 需求的唯一真相源——看 R 编号和 WHEN/THEN 场景 |
| design | design.md | 软件设计——大方向怎么走、系统怎么拆、为什么这样设计 |
| TRD | trds/*.md | 实现方案——精确到代码实体、接口签名、伪代码 |
| tasks | tasks.md | 实现步骤——带 checkbox，每条关联 TRD 章节号 |

📖 design.md 各章节在回答什么问题（完整模式）:

| 章节 | 回答的问题 | 用途 |
|------|-----------|------|
| 功能点/非功能点/约束 | PRD 需求映射到哪些模块、有哪些硬性限制 | TRD 方案章节的输入约束 |
| 技术选型与决策 (D01~Dnn) | 选了什么方案、为什么不选其他方案 | Reviewer 判断选型合理性；TRD 直接引用 D 编号 |
| 模块总览 (ASCII 图+职责表) | 系统拆成哪几块、各自管什么、怎么协作 | 建立全局画像 |
| 核心模块设计 (四要素) | 每个模块为什么存在、边界在哪、和谁协作、取舍是什么 | TRD 直接引用设计推理 |
| 优缺点 | 当前设计有什么已知局限 | 已知局限搬入 TRD 风险表 |
| 文件树 | 目录和文件怎么组织 | 路径唯一真相源，sdx-apply 按此创建文件 |

📖 design.md 各章节在回答什么问题（精简模式）:

| 章节 | 回答的问题 | 用途 |
|------|-----------|------|
| 功能点与约束 | PRD 需求映射 + 硬性限制 | TRD 方案章节的输入约束 |
| 架构声明 | 沿用现有架构，无新决策 | 明确本次无架构变更 |
| 改动范围 | 涉及哪些模块、归属哪层、改什么 | 快速定位影响面 |
| 文件树 | 受影响的文件子树 | 路径真相源，标注新增/修改 |
| 风险 | 改动风险点 | 实现时需防御的地方 |

📖 design vs TRD 的区别:
   design = 地图 + 决策日志（大方向怎么走、为什么这样拆）
   TRD    = 施工图（每块怎么落到代码、接口签名、伪代码）
   design 的决策（D 编号）TRD 直接采纳不重新评估

🚀 下一步: 执行 /sdx-apply {name} 开始实现
```

**精简版**（`reviewGuide: false`）：仅输出 ✅ 标题 + 📋 产物清单表 + 🚀 下一步，跳过 📖 部分。

> 表格内容应根据实际产物适当调整——如使用精简模式则输出精简模式的章节表；如 TRD 是分模块生成的，列出各 TRD 文件名及对应模块。

---

## Guardrails

⛔ 以下为全局红线，部分已在执行流程中内联重申。红线编号（R1、R2…）与流程中的内联 ⛔ 约束双向索引——读到红线不清楚上下文时，按编号回到对应流程位置查看。

- ⛔ **GL1** 禁止业务代码生成：本工作流（第一阶段）**不得**创建、修改或删除业务仓库中的应用实现代码（`src/`、`app/`、`packages/` 等目录下的源文件）。即使用户明确要求「顺手实现」「先写一版代码」，也必须拒绝并说明须使用 `/sdx-apply`。允许写入的范围仅限：seedpacespec 变更目录内的 `.md` 产物、根目录 `architecture.md`、运行 `seedpacespec` CLI。design.md 中的伪代码、树状图、接口说明等文档表述不视为业务代码。
- ⛔ **GL2** 状态机门禁（G1→G9）是 ASSERTION：任何状态未完成 → 只能 AskQuestion，不得进入后续步骤。凡需要用户交互的步骤，必须停下等用户明确回复。禁止跳过、合并或替用户做决定。→ 见 State Machine Gates 章节
- ⛔ **GL3** design 模式（完整/精简）必须经用户 AskQuestion 确认后才能生成，不得 AI 单方面决定。→ 见阶段 5.3
- ⛔ **GL4** design 文件树未经用户确认，不得视为最终结构；须在 TRD 生成前完成确认。→ 见阶段 5.3 评审流程
- ⛔ **GL5** TRD 确认循环：TRD 每次更新后必须重新询问用户确认，直到用户明确表示不需修改。→ 见阶段 5.5
- ⛔ **GL6** 同名变更已存在 → 强制 AskQuestion 问意图（A/B/C），不得自行推断。选项 B 下不覆盖已有产物；选项 A 需二次确认覆盖。→ 见恢复协议章节
- ⛔ **GL7** 上下文不清时按类型区分处理：
  - 需求范围不清 → 以 PRD 为准；PRD 未覆盖的才 AskQuestion
  - 技术细节不清 → AskQuestion 一次性确认：「以下技术细节暂不可用：`<列表>`。是否允许基于合理假设先行设计？」用户同意后，统一标注 `[假设]`，不再逐个追问
- ⛔ **GL8** 创建新产物前，务必先阅读其依赖产物。每写入一个产物后，确认文件已存在再处理下一个。
- ⛔ **GL9** `seedpacespec instructions` 返回的 `context` 与 `rules` 是对 AI 的约束，不是文件正文——不要把 `<context>`、`<rules>`、`<project_context>` 等块复制进产物。
- ⛔ **GL10** 产物总结必须输出，不得跳过。根据 `propose.reviewGuide` 配置决定完整版或精简版。→ 见产物总结章节
- ⛔ **GL11** 已有 PRD 但全文既无 `\bR\d{2}\b` 也无 `\bR-\d{2}\b` 时，必须先完成阶段 4「PRD 需求编号检查」的 AskQuestion（或完成归一化），不得直接进入阶段 5。→ 见阶段 4

---

## 引用

- `templates/design-template.md` — design.md 完整模式输出结构
- `templates/design-template-lite.md` — design.md 精简模式输出结构
- `.cursor/skills/_shared/memory-protocol.md` — 反馈记忆读取/收集协议
- `.cursor/skills/seedpacespec-trd-generator/SKILL.md` — TRD 生成器
