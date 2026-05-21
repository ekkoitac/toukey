---
name: seedpacespec-trd-generator
description: >
  基于 PRD 生成技术实现方案文档（TRD），按技术关注点组织，精确到代码实体级别。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"生成技术方案"、"写TRD"、"出个技术设计"。
  SKIP: 用户还没有 PRD（先用 sdx-propose / sdx-guided 或 sdx-explore）；用户想改已有 TRD（用 sdx-update-task）。
  requires: architecture.md + PRD 文档 + 变更目录已创建。
  output: seedpacespec/changes/active-change/<name>/trds/ 下的 TRD 文件。
  examples: "基于这个 PRD 出个技术方案" → 触发；"什么是 TRD" → 不触发。
license: MIT
compatibility: 需要 architecture.md + PRD + 变更目录
metadata:
  author: seedpacespec
  version: "2.1"
---

# seedpacespec-trd-generator

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.trd-generator` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `trd_output_format` | Step 9 TRD 生成（TRD Output Template 章节） | content | 可替换默认的 TRD 输出模板/格式 |
| `after_trd_generated` | TRD 生成并保存后（Step 10 之后） | hook | 可用于 TRD 后处理、触发下游流程 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配的 `skill: trd-generator` + `slot: 名字` 条目 → 有则加载 `run` 指定的文件执行，完毕后回到主流程继续 → 无则跳过。对于 content slot（`<!-- slot:xxx -->...<!-- /slot:xxx -->`），有匹配时用外部文件内容替换包裹的默认内容。

若无 `plugins` 配置 → 正常执行，无任何变化。

---

## Goal

将 PRD 业务需求转化为**按技术关注点组织的实现方案文档（Markdown）**。

**双重读者**：AI 凭 TRD 即可编码；人快速 review 架构决策和逻辑归类。

**核心原则**：
1. **设计意图优先**：每层先说 why，再说 what/how
2. **架构级粒度**：组件分层、逻辑归类、状态选型——不写 render 函数
3. **类型契约 > 实现细节**：接口定义用真实语法，实现逻辑用伪代码/自然语言
4. **只说 How，不重复 What**：引用 R-ID，不复述需求原文
5. **对 design.md 补位非重复**：已有决策直接引用，未涉及的由 TRD 补充
6. **技术栈无关**：层名和术语从 architecture.md 读取，不硬编码

**写作基调**：语言结构清晰，表述严谨简洁。精简冗余但不压缩设计推理。每个核心设计点须阐明决策依据与备选方案的取舍理由。伪代码块后须附中文设计解读段落。

---

## State Machine Gates

生成 TRD 前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得进入生成。**

| # | 状态 | 完成条件 | 可验证产出 | 未完成时行为 |
|---|------|---------|-----------|-------------|
| G0 | `tech_stack_role_resolved` | **Step 2** 已确定本 spec 的技术栈与角色（写入 `seedpacespec/role.yaml`），并已选定要加载的 `references/<stack>/loaders.yaml` | role.yaml 文件 | 执行 Step 2，必要时 AskQuestion |
| G1 | `mode_selected` | Step 4 用户选定模式（A/B/C/D） | 用户回复 | AskQuestion 询问模式 |
| G2 | `r_scope_normalized` | 所有纳入的 R 已识别并归一化 | R 列表 | AskQuestion 确认 R 范围 |
| G3 | `user_confirmed_scope` | 用户明确确认 R 范围和 TRD 文件名 | 用户回复 | AskQuestion 展示 R 列表确认 |
| G3.1 | `subpkg_confirmed` | monorepo：Q4 已展示全部子包并获用户确认；单包：自动通过 | AskQuestion 含全部子包列表 | 执行 §4.2 |
| G3.2 | `depth_assessed` | Q-depth 评估表已输出且用户已确认各 R 分级 | 深度分级评估表 | 执行 §4.5，输出评估表 |
| G4 | `context_loaded` | C1+C3 已加载，可选上下文已标记有/无，**反馈记忆已读取**（或确认 memory.enabled=false） | Step 3 第 4 条执行记录 | 停止，提示缺失上下文 |
| G4.1 | `extra_context_collected` | Step 5 AskQuestion 已发出且用户已回复 | AskQuestion 消息 | 执行 Step 5 |
| G4.2 | `common_module_assessed` | Step 7 公共模块抽离判定已输出结论（"无需抽离"或抽离建议的 AskQuestion） | 判定结论文本 | 执行 Step 7，输出判定 |
| G5 | `references_loaded` | **Step 8 评估表已输出**（条件来自 G0 选定的 `loaders.yaml`），且所有"命中=✅"行的文件已通过 Read 工具读取（"已读取"列为 ✅ 或 —） | 评估表 | 执行 Step 8，输出评估表 |
| G6 | `draft_confirmed_if_chunked` | 若分块：概要摘要已获用户确认；否则自动通过 | — | 展示概要等确认 |

**状态推进单向** G0→G1→G2→G3→G3.1→G3.2→G4→G4.1→G4.2→G5→G6，不得跳跃。全部通过后方可进入 Step 9 生成。

⛔ 约束 [GR1]: 禁止编造跳过理由——不能用"恢复协议选项 B"、"追加模式"、"精简流程"等理由,直接跳过门禁,唯一允许精简流程的场景是 Step 7 公共模块 TRD 生成（有明确标注）。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。→ 见 Guardrails

⛔ 约束 [GR2]: 交互阻断型门禁（G0/G3.1/G3.2/G4.1/G4.2）执行单轮唯一输出约束——本轮输出仅限该门禁的可验证产出 + AskUserQuestion，调用后立即停止。→ 见 Guardrails

**交互阻断型门禁速查**：

| 门禁 | 步骤 | 单轮唯一合法输出 |
|------|------|----------------|
| G0 | Step 2 项目设置 | role.yaml 写入结果 + 确认告知技术栈和角色 |
| G3.1 | §4.2 Q4 子包确认 | 子包列表 + AskUserQuestion（单包自动通过） |
| G3.2 | §4.5 Q-depth | 深度分级评估表 + AskUserQuestion |
| G4.1 | Step 5 额外上下文 | 上下文收集问题 + AskUserQuestion |
| G4.2 | Step 7 公共模块 | 判定结论（"无需抽离"）或 抽离建议 + AskUserQuestion |

**自检协议**：进入这些门禁时，先输出 `[GATE Gx.x: 描述 — 等待用户确认后才能继续]` 标记，输出后唯一允许的后续动作是产出该门禁内容 + 停止。

⛔ 约束 [GR3]: 反馈记忆不可省略——读取（Step 3）和记录（Step 9.5）缺一不可。→ 见 Guardrails

**反馈记忆执行点**：

| 动作 | 位置 | 必须做什么 | 验证方式 |
|------|------|-----------|---------|
| **读取反馈** | Step 3 第 4 条 | 读取 `seedpacespec/config.yaml` 的 `memory.enabled`；为 `true` 时读取 `seedpacespec/memory/team-feedback.md` 和 `personal-feedback.md`（若存在） | G4 门禁检查：`memory.enabled=true` 但未读取 → G4 不通过 |
| **记录反馈** | Step 9.5 选 A 第 2 步 | 分析纠正/肯定/决策信号，有则写入记忆文件；无则输出"本轮无需记录反馈" | 选 A 时必须在更新状态标记之后、进入 Step 10 之前显式输出结论 |


---

## AskQuestion 触点速查表

> 全流程所有交互点一览。**必须严格按此表判断是否询问**——触发条件满足就问，短路条件满足就跳过。
> Q-next-subpkg与 Q-next-req是独立的两次询问，**不能合并为一次**。

| # | 触点 | 什么意思 | 在哪里执行 | 什么时候必须问 | 什么时候跳过不问 |
|---|------|---------|-----------|--------------|----------------|
| **Q1** | 子包候选确认 | monorepo 检测到多个子目录后，让用户确认哪些算"子包"、哪些只是工具脚本应排除 | Step 2 的 2.3-M 第 2 步 | 仓库命中 monorepo 的 **naive 信号**（裸目录式平铺，如 `client/` + `server/`，没用 workspaces 等工具）——因为误报率高，必须人确认 | ①命中的是 **tooling 信号**（workspaces 等权威声明，可信度高）→ 直接采用不问；②`role.yaml` 已存在且记录了子包列表 → 直接短路 |
| **Q2** | 角色消岐 | 检测到某技术栈后，追问用户"这是真后台服务还是 BFF 中间层"——因为两者加载的 references 完全不同 | Step 2 的 2.5，对每个子包（或单包根目录）独立判断 | 该子包唯一命中的 tech_stack 标了 `requires_role_disambiguation: true`（**目前只有 backend 标了 true**：检测到 egg / express / nest / FastAPI / Spring 等后台信号时） | ①该 tech_stack 标 `false` 或缺省（如 frontend、embedded）→ 自动采用不问；②`role.yaml` 已记录该子包的 role → 直接短路 |
| **Q3** | 生成模式选择 | 让用户选 A 全量 / B 增量 / C 按模块 / D 自选 R | Step 4 §4.1 | **每次新需求都问**（这是入口决策，决定后续走全量还是循环） | — 不可跳过 |
| **Q4** | 受影响子包确认 | monorepo 场景下，让用户确认当前这条 R 具体影响哪些子包（多选） | Step 4 §4.2 | **monorepo 项目的所有模式（A/B/C/D）**都问（模式 A 默认预勾选全部但仍需确认） | ①单包项目 → 跳过（没有子包概念） |
| **Q5** | monorepo 生成节奏 | Q4 勾选了多个子包后，问用户"一次全生成 / 只先做一份 / 每做完一份问一次 / 自定义子集" | Step 4 §4.3 | Q4 勾选了 **≥2 个子包** | Q4 只勾选了 **1 个子包** → 自动走 `all_at_once`（只有一个，无需选节奏） |
| **Q6** | TRD 确认循环 | 一份 TRD 写完后，问用户"满意保存 / 需要修改 / 方向有问题重新生成" | Step 9 **每份 TRD 生成完之后** | **每次都问**——无论单包还是 monorepo、无论全量还是分块。用户选"需要修改"可反复循环直到满意 | — 不可跳过（这是最终质量把关） |
| **Q-depth** | 深度分级确认 | R 范围确认后，为每条 R 标注展开级别（Full/Eval/Min）和 Full 级别的展开维度，让用户确认/调整 | Step 4 §4.5（G3 通过后、Step 5 之前） | **每次都问**（纳入 ≥1 条 R 即触发） | — 不可跳过 |
| **Q-next-subpkg** | 是否继续下一份子包 TRD | monorepo 内层：当前 R 的一份子包 TRD 保存后，问"继续同一 R 的下一个子包？" | Step 10 保存后（仅 monorepo 内层） | monorepo + Q5 选了 `phased_with_confirm`（分批模式） | ①Q5 选的是 `all_at_once` → 不问，直接继续下一子包；②`focus_one_first` → 只做一份，其余入 pending，不问；③`custom_subset` → 按勾选范围直接生成，不逐份问 |
| **Q-next-req** | 是否继续生成下一份 TRD | 外层：当前选定 R 的所有子包 TRD 都完成并保存后，问"是否继续？"——若继续，**回到 Step 4 重新走流程**（模式 C：用户描述下一个目标，AI 重新划 R；模式 D：列出剩余未完成 R 让用户重新勾选）。注意：**不是自动跳到编号上的"下一条 R"**，而是让用户主导选择下一步做什么 | Step 10 保存 + 内层已全部完成 | Step 4 选了 **模式 C 或 D**（循环类模式） | ①模式 A / B（非循环）→ 不问（一次性完成）；②用户在循环中主动表示全部完成 → 流程结束 |

---

## Prerequisites

| 上下文 | 必需性 | 核心作用 | 缺失处理 |
|--------|--------|----------|----------|
| **C1** architecture.md | ✅ 必需 | 分层结构、模块边界、编码约定 | 停止生成 |
| **C3** PRD 文档 | ✅ 必需 | 需求 ID、验收标准 | 停止生成 |
| **C2** design.md | 🔶 推荐 | 技术决策、数据结构 | §5 标注"基于推断"，继续生成（不单独询问，在 Step 5 统一告知） |
| **C4** 接口文档 | 🔷 推荐 | 接口契约 | TRD 产出中涉及接口的章节标注"基于推断"，继续生成（不单独询问，在 Step 5 统一告知） |
| **C5** 测试用例 | ⬜ 可选 | 边界/异常场景 | §6 覆盖度降低 |
| **C6** 视觉截图 | ⬜ 可选 | UI 细节校验 | UI 层可能不一致 |

---

## Workflow

⛔ 由于本流程包含多种模式分支和嵌套循环，下方列出完整控制流帮助定位当前执行位置。每个步骤的具体规则见后续章节。

```
═══════════════ 准备阶段 ═══════════════

Step 1: 绑定变更目录
Step 2: 项目设置 ────────────────────────── [G0]
Step 3: 加载上下文 ──────────────────────── [G4]
Step 4: 选模式 + 确定范围
  ├─ §4.1 Q3: 选模式 A / B / C / D ───── [G1]
  ├─ §4.1 确定 R 范围 ─────────────────── [G2, G3]
  ├─ §4.2 Q4: 确认受影响子包 (monorepo) ─ [G3.1]  ← 单包跳过
  ├─ §4.3 Q5: 选生成节奏 (≥2 子包时)
  └─ §4.5 Q-depth: 深度分级 ───────────── [G3.2]
Step 5: 收集额外上下文 ──────────────────── [G4.1]
Step 6: R→文件映射
Step 7: 公共模块判定 ────────────────────── [G4.2]
  ├─ 无需抽离 → 继续
  ├─ 用户选 A (先抽离) ──┐
  │   for each 公共模块:  │  ⚠️ 精简流程，不走 G1~G6
  │     生成公共 TRD      │
  │     用户审阅 → 保存   │
  │   ←───────────────────┘
  ├─ 用户选 B (不抽离) → 继续
  └─ 用户选 C (暂时跳过) → 继续
Step 8: 条件加载评估 ────────────────────── [G5]

═══════════════ 生成阶段 ═══════════════

LOOP-R (模式 C/D: 循环 | 模式 A/B: 单次)
│
│  LOOP-SUBPKG (monorepo: 按节奏迭代 | 单包: 跳过)
│  │  Step 9:   生成 TRD (当前 R × 当前子包)
│  │  Step 9.5: Q6 确认 ──── 满意 → 保存
│  │                         修改 → 调整后重新确认
│  │                         重生成 → 回到 Step 9
│  │  Step 10:  保存
│  │  Q-next-subpkg? (仅 phased_with_confirm 模式)
│  END-LOOP-SUBPKG
│
│  Q-next-req? (仅模式 C/D) → 继续则回到 Step 4
END-LOOP-R
```

### Step 1: 绑定变更目录

1. 运行 `seedpacespec list --json` 或由用户指定变更名。
2. TRD 写入 `seedpacespec/changes/active-change/<变更名>/trds/` 目录。
3. 若目录不存在，先创建。

### Step 2: 项目设置（G0 门禁）

⛔ 约束: G0 不可跳过——后续所有步骤都依赖 G0 确定的技术栈和角色。自检：执行 Step 3+ 时 role.yaml 未存在/未确认 → 立即回到 Step 2。短路 ≠ 跳过：role.yaml 已存在时走 2.1 短路合法，但必须告知用户当前技术栈和角色。

**目的**：识别布局（单包 / monorepo）、技术栈、角色 → 写入 `seedpacespec/role.yaml` → 确定加载哪份 `references/<stack>/loaders.yaml`。
**执行频率**：role.yaml 已存在时短路（2.1 即结束），仅首次或结构变更时走完整流程。
**规则来源**：检测规则、技术栈列表、消岐选项 → 全部读 `references/loaders.yaml`，不硬编码。

#### 2.1 短路检查

`Read seedpacespec/role.yaml`——若文件存在且结构有效 → **直接采用**，跳到 2.6。

#### 2.2 读顶层路由配置

1. 读取 `seedpacespec/config.yaml` 的 `plugins.trd` 配置（若有）
2. 若 `plugins.trd.references_dir` 存在 → 以该目录为 references 根目录（后续所有 `references/` 引用改为此目录）
3. 若 `plugins.trd.loaders` 存在 → 用该文件替代顶层 `loaders.yaml`
4. 若 `plugins.trd.extra_stacks` 存在 → 对每个条目：
   - 追加到 `tech_stacks` 检测列表末尾（id 同名则覆盖内置）
   - 若条目有 `requires_role_disambiguation: true` + `role_disambiguation` → 注入 `role_disambiguation` 表
   - 自动追加到 `multi_stack_fallback.options`
5. 若 `plugins.trd.example` 存在 → 替代 `common.mandatory` 中的黄金样本路径
6. 以上均不存在时 → fallback 到内置路径：`Read .cursor/skills/seedpacespec-trd-generator/references/loaders.yaml`

#### 2.3 Monorepo 检测

按 `monorepo_detection` 的两类信号判定：

- **A. tooling 信号** (`signals_tooling`)：workspaces / lerna / pnpm-workspace / nx / turbo / Maven multi-module / Cargo workspace 等
- **B. naive 信号** (`signals_naive`)：根目录平铺多个含包管理文件的子目录（典型：`client/` + `server/`、`web/` + `api/`）
- **任一命中** → 视为 monorepo → 2.3-M
- **均未命中** → 单包项目 → 2.3-S

**2.3-M monorepo 分支**

1. 按 `enumerate_subpackages` 枚举子包路径（tooling → 读 workspaces；naive → 扫 depth=1 子目录，排除 `excluded_dir_names`，优先列 `known_layout_names` 命中项）
2. **Q1 子包候选确认**（naive 信号必问；tooling 可跳过）：列出候选子包 → AskQuestion 让用户确认/调整
3. 对每个确认的子包独立跑 2.4~2.5（工作目录切到该子包）
4. 汇总概览表（subpkg → tech_stack → role）→ 给用户确认

**2.3-S 单包分支**

直接对仓库根目录跑 2.4~2.5。

#### 2.4 技术栈检测

按 `detection_strategy.priority` 顺序逐源尝试，命中即停止：

- **优先源 `architecture.md`**：Read → 用 `architecture_md_hints`（keywords / categories / directory_signals）匹配 → 输出命中清单。若 architecture.md 中标注了 `项目形态: sdk` → 优先匹配 sdk 技术栈。
- **回落源 `file_exists`**：仅当无 architecture.md 时执行 → 按 `tech_stacks.*.detect` 规则逐条判定：
  - `file_exists`：指定文件必须存在
  - `contents_match`：文件内容匹配正则
  - `negative_signals`（若有）：指定的文件或目录**不能存在**——任一 negative signal 命中 → 该条规则判定为**不命中**，跳过
  - 多条规则间为 OR 关系：任一条全部通过（file_exists ✅ + contents_match ✅ + negative_signals 全不存在 ✅）→ 该技术栈命中

#### 2.5 分支处理 + 角色消岐

| 命中情况 | 行为 |
|---------|------|
| **唯一命中** | 检查 `requires_role_disambiguation`：`false` → 自动采用并告知；`true` → **Q2 AskQuestion** 消岐（典型：后台信号 → 真后台 / BFF / 两者兼有） |
| **多个命中** | 按 `multi_stack_fallback` AskQuestion 让用户选主角色 |
| **零命中** | 按 `on_unmatched` AskQuestion 手选，提示团队补检测规则 |

#### 2.6 写入 role.yaml

把 2.3~2.5 的结果持久化。格式详见 **Appendix: role.yaml Schema**。
后续每次运行 2.1 短路读取，不再询问。

#### 2.7 加载条件加载表

- 单包：`Read references/<role.loads>/loaders.yaml`
- monorepo：对每个确认的子包，按其 `loads` 各自加载

输出的 `mandatory` + `conditions` 列表作为 Step 8 的输入。

**协同建议**：若仓库尚无 `architecture.md` → 建议先跑 `seedpacespec-analyzer-project` 生成，让 2.4 检测更准，Step 3 的 C1 必需项也同步就绪。

**多 spec 工作区**：各项目各自走 Step 2，互不干扰。TRD §1 追加 `peer_specs` 引用槽。

### Step 3: 加载上下文（G4 门禁）

1. 按上表加载（C1+C3 必需）。
2. 若用户指定聚焦模块 → 额外读取该模块目录结构和关键代码签名。
3. **加载全局规格上下文**（若存在）：
   - 扫描 `seedpacespec/global-specs/` 目录
   - 读取所有 `.md` 文件（如 `README.md`、`product-requirements.md`、`business-rules.md` 等）
   - 将内容作为「项目背景知识」注入后续生成流程
4. **加载反馈记忆**（必须执行）：按 `.cursor/skills/_shared/memory-protocol.md` 的"读取时机"执行——读取 `seedpacespec/config.yaml` 的 `memory.enabled`，为 `true` 时读取 `seedpacespec/memory/team-feedback.md` 和 `personal-feedback.md`（若存在），作为生成约束。
5. **扫描项目已有代码模式**：找同类代码（Model / Repository / slice 等）→ 分析命名规范、文件组织、代码结构模式 → 后续 §4 必须与已有代码保持一致。
6. **design.md 机器标记**（若变更目录存在 `design.md`）：**Read** 全文或尾部，解析 HTML 注释：
   - `<!-- sdx:design-mode=lite -->` / `<!-- sdx:design-mode=full -->` —— 与 propose **精简 / 完整 design** 对齐，供 **§4.5 Q-depth** 做深度偏好（见 §4.5「与 design 模式联动」）。
   - `<!-- sdx:status=draft|confirmed -->` —— 若 `design-mode=lite` 但 **status 仍为 draft**，在 §4.5 评估表顶部用一行备注「design 尚未 confirmed」，**仍可**按 lite 倾向建议 Eval，由用户在 Q-depth 拍板。

### Step 4: 需求范围与生成策略（G1–G3 门禁）

> **执行频率**：每次需求（模式 A/B 内部不循环），模式 C/D 则每条 R 都回到本步。

#### §4.1 生成模式选择（G1 门禁 · Q3 AskQuestion）

| 模式 | 适用场景 | 需求选择方式 | 循环 |
|------|---------|-------------|------|
| **A. 全量生成** | 小项目/首次 | 自动包含所有 R，但仍须在 G3 展示完整 R 列表并 AskQuestion 确认 | ❌ |
| **B. 增量更新** | 已有 TRD，补充上下文 | 保持原范围 | ❌ |
| **C. 按模块生成** | 大项目，自然语言描述目标 | AI 划入 R → 用户确认/调整 | ✅ |
| **D. 自选 R 生成** | 精确控制范围 | 用户手动勾选 R | ✅ |

> **📋 Q3 用户可见文案模板**（AskUserQuestion 必须使用以下自然语言，禁止出现"模式 A/B/C/D"或"自选 R"等内部术语）：
> - question: "请选择技术方案（TRD）的生成范围："
> - option 1: label="一次性生成全部需求" description="覆盖 PRD 中所有需求，适合小项目或首次生成"
> - option 2: label="在已有方案基础上补充" description="保留已有 TRD 内容，仅补充新增或变更的部分"
> - option 3: label="按功能模块逐个生成" description="描述你想实现的目标，AI 自动匹配相关需求，逐个模块生成"
> - option 4: label="自己选择需求编号" description="从需求列表中手动勾选要生成技术方案的条目"

- **C 流程**：用户描述目标 → AI 划入 R → 用户确认 → 逐模块循环生成
- **D 流程**：列所有 R（已完成标 ✅）→ 用户勾选 → 确认文件名 → 生成 → 循环询问是否继续

文件名：全量 `trds/{功能名}-trd.md`，模块 `trds/{模块名}-trd.md`，monorepo `trds/{subpkg}-{功能名}-trd.md`。

#### §4.2 受影响子包确认（G3.1 门禁 · Q4 AskQuestion，monorepo 必须执行）

⛔ 约束: 单包跳过。monorepo 必须执行——即使"只影响一个子包"也必须列出全部子包让用户确认。任何模式（A/B/C/D）均不可跳过。不得将本步与 §4.3 合并为一次询问。

每条 R 进入生成前，基于 PRD 的模块名 / 路径 / 跨包调用提及，初步划入"受影响子包清单"，AskQuestion 让用户确认/调整（多选）。

⛔ 约束: AskQuestion 必须列出全部已确认子包（AI 预勾选可能受影响的，但不得省略其他子包）。

**标准问法模板**（必须遵循此格式）：

```
本次 R-{n}「{需求标题}」受影响的子包（请确认/调整，可多选）:
  ☑ packages/web    (frontend)     ← AI 预判受影响，预勾选
  ☑ packages/server (backend)      ← AI 预判受影响，预勾选
  ☐ packages/admin  (frontend)     ← 列出但不预勾选
  ☐ packages/shared (shared-lib)   ← 列出但不预勾选
```

**pending 恢复**：若 `monorepo-pending-trds.txt` 存在且含本条 R 的待生成子包 → 在清单顶部优先列出，附「上次未完成」标记。

#### §4.3 monorepo 生成节奏（Q5 AskQuestion，仅 §4.2 勾选 ≥2 时触发）

⛔ 约束: §4.2 确认 ≥2 个子包后必须询问生成节奏，不得默认选择任何模式而跳过。

勾选 1 个子包 → 直接走 `all_at_once`，跳过本节。勾选 ≥2 时询问（来自 `monorepo_strategy.trd_generation_modes`）：

| 模式 | 行为 |
|------|------|
| **all_at_once** | 一次性顺序输出 N 份 TRD，中间不再追问 |
| **focus_one_first** | 只生成 1 份（再问选哪个），其余写入 `monorepo-pending-trds.txt` |
| **phased_with_confirm** | 每完成一份 AskQuestion 是否继续下一份 |
| **custom_subset** | 在勾选范围内二次多选本次先做哪几个 |

> **📋 Q5 用户可见文案模板**（禁止出现 all_at_once 等内部代号）：
> - question: "已选择 {N} 个子包，请选择生成节奏："
> - option 1: label="全部一次性生成" description="按顺序为所有子包生成技术方案，中间不再询问"
> - option 2: label="先做一个，其余稍后" description="选择一个子包先生成，其他的记录下来下次继续"
> - option 3: label="每做完一个确认一次" description="每生成一份后暂停，由你决定是否继续下一个"
> - option 4: label="自己选择本次先做哪几个" description="在已选子包中再挑选本次要生成的子集"

未生成的子包写入 `changes/active-change/<change>/monorepo-pending-trds.txt`，下次重跑自动列出。

#### §4.4 循环规则（必读，非执行步骤）

⛔ 约束: R 循环（外层）与子包循环（内层）严格嵌套。Q-next-subpkg 与 Q-next-req 是独立的两次询问，不能合并。内层完成后必须回外层问"是否继续"。

> 完整嵌套结构见 Workflow 开头的控制流图。以下为补充约束：

```
外层(模式 C/D): for r in selected_R_list:
    ├─ §4.2 确认本条 R 受影响的子包
    ├─ §4.3 选定生成节奏
    ├─ 内层: for subpkg in r.affected_subpackages:
    │     Step 5~10 → 生成 TRD(r, subpkg)
    │     Q6: TRD 确认循环 → Step 10 保存
    │     (phased 模式: Q-next-subpkg "继续下一份子包?")
    │ ← 内层结束
    └─ Q-next-req: "本轮 TRD 已完成，是否继续？" → 若继续，回到 Step 4 §4.1 重新走流程
```

**约束清单**：

1. 内层完成 → 必须回外层问"是否继续生成"（用户决定做什么），不得直接结束 skill
2. Q-next-subpkg（下一份子包）与 Q-next-req（下一条 R）是两个独立 AskQuestion，不能合并
3. 单包项目无内层，外层 C/D 循环直接走 Step 5~10（含 Q6 确认）后回到外层

**Q-next-subpkg触发速查**（避免误判）：

| Q5 选择 | Q-next-subpkg是否触发 | 原因 |
|---------|-------------|------|
| `all_at_once` | ❌ 不问 | 直接顺序生成所有子包 |
| `phased_with_confirm` | ✅ 每份后问 | 用户要逐份确认 |
| `focus_one_first` | ❌ 不问 | 只做一份，其余入 pending |
| `custom_subset` | ❌ 不问 | 按勾选范围直接生成 |

**单子包 + Q-next-req边界**：若 Q4 只勾选了 1 个子包，内层无循环（等同单包），但 **Q-next-req仍然必须问**——只要是模式 C/D，无论子包数量，外层 R 循环的"是否继续下一条 R"都要执行。

#### §4.5 深度分级（G3.2 门禁 · Q-depth AskQuestion）

⛔ 约束: 不得默认全部 Full，不得跳过。无论 R 数量多少，必须输出评估表并等待用户确认。本步唯一合法输出 = `[GATE G3.2]` 标记 + 评估表 + AskUserQuestion，输出后立即停止。

**位置**：R 范围确认（G3）通过后、Step 5 之前。
**目的**：同一变更内不同 R 复杂度差异大时，避免对简单改动强制输出完整骨架。

**三个级别**：

| 级别 | 代号 | 判定条件 | §4 输出要求 |
|------|------|---------|------------|
| **完整展开** | Full | 新增组件/模块、复杂逻辑、架构决策、UI 和流程有实质变更 | 按骨架完整展开所有适用维度 |
| **影响评估** | Eval | 功能已存在，改动在现有模块/组件内完成（可能涉及 UI 调整、逻辑修改、流程微调），但不新增模块或架构决策 | 按 Eval 输出模板：逐文件列出改动内容、改动方式、改动意图 |
| **最小标注** | Min | 文案修改、配置调整、样式微调等无架构影响的改动 | 仅在 §2 矩阵标注改动文件和改动点，§4 不展开 |

> **📋 Q-depth 用户可见文案模板**（评估表中使用自然语言描述级别，禁止仅显示 Full/Eval/Min 代号）：
> - question: "以下是各需求的展开深度评估，请确认或调整："
> - 表格"建议"列显示自然语言：**完整展开**（而非 Full）、**影响评估**（而非 Eval）、**最小标注**（而非 Min）
> - 表格内可在自然语言后括号注明代号辅助理解，如"完整展开(Full)"，但自然语言必须在前

**分级与质量标准的关系**：

- **Full**：对标黄金样本，按骨架完整展开，Non-Negotiables 全部适用
- **Eval**：不要求对标黄金样本和骨架输出。按下方 Eval 输出模板**Eval 输出模板**执行
- **Min**：仅在 §2 矩阵中标注改动文件和具体改动点，§4 不展开

**执行流程**（评估表必须输出）：

1. AI 基于 PRD 内容和已有代码，为每条 R 自动分级，给出推荐理由，并列出建议的展开维度

⛔ 约束: **分级原则如下**：

- **与 propose `design.md` 联动（推荐倾向，不替代用户确认）**：若 Step 3 已解析到 `<!-- sdx:design-mode=lite -->`（即用户在 propose 中确认采用**精简 design**），则 Q-depth **默认倾向 Eval（影响评估）**——对每条 R，**拿不准时优先标 Eval 而非 Full**；评估表「推荐理由」中须点名「design 已标记 `sdx:design-mode=lite`，TRD 深度与之对齐」。**仍必须**输出本条 AskQuestion，用户可将任意 R 升为 Full 或降为 Min。
- **覆盖 design 偏好的例外**：某条 R 在 PRD 或 design 中明确需要架构级展开（新技术栈/中间件、长链路编排、多系统契约、安全合规基座等）→ 可对该 R 建议 **Full**，理由写清「虽 design 为 lite，本条因 … 建议完整展开」。
- **若 `design-mode=full`、无 `design-mode` 行、或无 `design.md`**：维持原规则 —— **拿不准时默认 Full（偏保守）**，由用户在 Q-depth 降级。
- 用户可为 Full 级别的 R 附加额外约束（如"底层逻辑不变，提供参考代码，只展开 UI 层和交互流"）
- 所有级别的 R 均纳入 §2 需求覆盖矩阵，不遗漏

⛔ 约束 : **Full 级别的展开维度清单**（从当前技术栈的 `loaders.yaml` → `depth_dimensions` 字段动态读取，评估表中逐项列出，用户可勾选/去除）：

> `depth_dimensions` 的作用是**让用户了解本栈下 Full 级别可能涉及哪些方面**，供 Q-depth 评估时勾选/去除。它不决定实际展开的写法和深度——那由对应栈的 references guide 文档（如 `ui-component-guide.md`）控制。
> AI 必须在 Step 2 技术栈判定后，Read 对应栈的 `references/<stack>/loaders.yaml`，提取 `depth_dimensions` 数组作为本次可选维度菜单。若项目为 monorepo 且子包技术栈不同，各子包使用各自栈的维度清单。
  
1. **必须**输出深度分级评估表（AskQuestion），等待用户确认后才能继续。用户可对任意 R 升降级，或增删展开维度。格式如下：


```
深度分级评估（请确认/调整各 R 的级别和展开维度）:

┌───────┬──────────────────┬──────┬──────────────────────────┬─────────────────────────────┐
│ R-ID  │ 需求简述          │ 建议 │ 推荐理由                  │ 展开维度（Full/Eval 时列出）  │
├───────┼──────────────────┼──────┼──────────────────────────┼─────────────────────────────┤
│ R-01  │ 配网流程改版       │ Full │ 新增页面+状态机+异步编排    │ 组件树·逐组件设计·状态归属·   │
│       │                  │      │                          │ 交互流·需求链路              │
│ R-02  │ 密码强度校验       │ Eval │ 在已有表单组件内加逻辑，    │ 影响文件·调用链·风险点·       │
│       │                  │      │ 无新模块，改动范围可控      │ UI 改动点                   │
│ R-03  │ 首页文案修改       │ Min  │ 纯文案替换，无逻辑变更      │ §2 标注改动文件和改动点       │
└───────┴──────────────────┴──────┴──────────────────────────┴─────────────────────────────┘

用户可对任意 R 升降级，或增删展开维度。
```

3. 用户确认后，各 R 按对应级别生成。Full 级别仅展开用户确认的维度，未勾选维度跳过


**Eval 输出模板**（§4 中 Eval 级别的 R 按此格式输出）：

> 以下示例为前端场景。后端/嵌入式项目同样遵循此结构，但术语应反映实际技术栈。
> Eval 是 Full 的**轻量版**——结构相似但深度更浅，不要求完整的组件树/状态归属/逻辑单元设计等展开，但涉及 UI/模块变更时须体现组件级改动。

```markdown
### 4.x {R-ID} {需求简述}（Eval）

**改动意图**：{一句话说明为什么要改}

| 文件 | 改动内容 | 改动方式 | 意图说明 |
|------|---------|---------|---------|
| `src/xxx/YyyPage.tsx` | 新增密码强度校验逻辑 | 在 `onSubmit` 中调用 `validatePasswordStrength()` | 满足 R-02 密码强度要求 |
| `src/utils/validation.ts` | 新增 `validatePasswordStrength` 函数 | 新增导出函数 | 复用校验规则，避免硬编码 |

**UI/组件变更**（若涉及，否则省略此节）：
```
{涉及的组件树片段，标注新增(+)/修改(~)/抽离公共(⭐)}
```
- 新增组件：{组件名 — 一句话职责}
- 修改组件：{组件名 — 改了什么}
- 抽离公共组件：{组件名 — 复用场景}

**影响调用链**：{列出改动文件的上下游调用方，标明是否受影响。无跨文件影响则写"改动自闭合，无外部调用方"}

**风险点**：{改动可能影响的现有功能、需要回归测试的场景，无则写"无"}
```

> Eval 的核心是让 reviewer 明确知道：改哪些文件、每个文件怎么改、为什么这样改、影响哪些调用方、有什么风险。涉及 UI 变更时还要体现组件级改动（新增/修改/抽离公共），但不需要像 Full 那样画完整组件树或展开逐组件设计。

### Step 5: 额外上下文（G4.1 门禁 · AskQuestion，一次性收集）

⛔ 约束: 不得跳过。本步唯一合法输出 = `[GATE G4.1]` 标记 + 上下文收集消息 + AskUserQuestion，输出后立即停止。即使"没什么要问的"也必须发出 AskUserQuestion 让用户确认。

**用一次 AskQuestion 统一处理**，包含以下内容（合并为一条消息，不逐项追问）：

1. **缺失上下文告知**：列出 Step 3 中检测到缺失的可选上下文（C2/C4/C5/C6），说明将以"基于推断"方式处理，用户若有补充可在此提供路径
2. **额外关注点**：性能/安全/兼容等
3. **参考文件路径**：用户想额外纳入的文件
4. **特殊约束**
5. **（可选）对标 TRD 路径**：若用户提供仓库内已有 TRD（如 `trds/r06-xxx-trd.md`），本步一并收集路径；**生成 §4 时须 Read 该文件**，章节厚度与写法**不得低于**该参考（薄 PRD 也不能比参考 TRD 更「提纲化」）
6. **（可选）先抽离公共模块**：用户若已知有公共逻辑需要先设计，可在此声明（如"先帮我抽一个动画调度器的公共 TRD"）→ 记录意图，待 Step 7 统一处理

示例：
> 以下可选上下文未检测到：接口文档（C4）、测试用例（C5）。相关章节将标注"基于推断"。
> 如果你有这些文件，请提供路径；没有的话直接确认即可。
> 另外，有没有额外关注点或特殊约束？是否有需要先抽离的公共模块？

**用户回复后即继续**，后续流程不再重复询问这些缺失项。

### Step 6: 需求-代码映射

分析每条 R 的改动范围，为 Step 7 公共模块判定和 Step 9 内部公共单元评估提供依据。

1. 遍历每条 R，基于 PRD 描述 + architecture.md + design.md（若有）+ 代码目录，列出涉及的现有文件/模块
2. **跨 R 公共模块预扫描**：对比各 R 的改动范围，检查是否有多个 R 需要同一个尚不存在的公共能力 → 记录结果，供 Step 7 判定
3. **R 内部/模块内部公共单元预扫描**：在单条 R 内部，检查是否存在多处重复逻辑（同类数据转换、同类状态模式、相似 UI 结构等）→ 记录结果，供 Step 9 生成时在 TRD `§4.x 本模块内部公共单元` 中展开。判定依据：
   - 同一 R 内 ≥2 个组件/模块需要相同的工具逻辑
   - design.md 中已识别的内部公共层（如"公共 Hook 层"、"工具层"）
   - 这些单元不需要独立 TRD，直接在当前 TRD 的 §4 对应层中设计

> 设计规则（层名来源、分析维度、design.md 消费方式等）统一在 Step 9 由 `templates/trd-skeleton.md` 控制，本步只做文件级定位。

### Step 7: 公共模块抽离判定（G4.2 门禁）

⛔ 约束: 不得跳过。本步唯一合法输出 = `[GATE G4.2]` 标记 + 判定结论（"无需抽离"或 AskUserQuestion）。若需 AskUserQuestion，输出后立即停止。

⛔ 约束: 必须输出判定结论——无论是否需要抽离：
- **需要抽离** → AskQuestion 建议
- **无需抽离** → `📋 公共模块判定：无需抽离（原因：{具体原因}）`



**触发条件**（满足任一即进入）：
- **用户在 Step 5 主动声明**了要先抽离公共模块
- **AI 主动发现**：Step 6 映射结果中，≥ 2 个 **Full 或 Eval 级别的** R 引用了**同一个尚不存在的**公共逻辑

> Min 级别的 R 不参与公共模块抽离判定。若变更中全部 R 为 Min 且用户未主动声明 → 跳过本步。

**AI 主动发现的判定规则**：

扫描 Step 6 的改动方案，若出现以下情况 → 用 AskQuestion 建议先抽离：
- ≥ 2 个 R 需要**同一个尚不存在的**工具函数 / Hook / Service / 组件
- ≥ 2 个 R 需要**同一种尚不存在的**状态管理模式（如统一的缓存层、统一的错误处理）
- 某个横切能力（日志、埋点、权限校验）被多处引用但项目中无统一实现

不满足上述条件且用户未声明 → 输出"无需抽离"判定结论（G4.2 通过），进入 Step 8。

**AskQuestion 示例**（AI 主动建议时）：

> **📋 Step 7 公共模块抽离 用户可见文案模板**：
> - question: "发现以下公共逻辑被多个需求共用，建议先为它们生成独立的技术方案。如何处理？"
> - option 1: label="先生成公共模块方案" description="先为公共逻辑生成独立技术方案，后续功能方案直接引用"
> - option 2: label="不抽离，各自设计" description="各功能方案中分别设计，可能有重复但更独立"
> - option 3: label="暂时跳过" description="先看功能方案再决定是否需要抽离公共模块"

> 在需求映射中发现以下公共逻辑被多个 R 共用，但项目中尚不存在：
>
> | 公共逻辑 | 被引用的 R | 说明 |
> |---------|-----------|------|
> | 动画队列调度器 | R-03, R-05, R-08 | 多处需要按顺序/并行编排 lottie 动画 |
>
> 建议先为它们生成独立的公共 TRD，后续功能 TRD 直接引用。
> A) 先抽离公共模块，生成公共 TRD 后再继续
> B) 不抽离，各功能 TRD 中各自设计（可能重复）
> C) 暂时跳过，我先看功能 TRD 再决定

**用户选 A 后的执行流程**：

1. AI 输出**公共模块抽离分析表**：

   | 公共模块 | 涉及 R | 抽离原因 | 复用场景 | 建议承载方式 |
   |---------|--------|---------|---------|------------|
   | {模块名} | R-XX, R-YY | {为什么不能各自实现，必须统一} | {哪些功能 TRD 会引用} | Hook / Service / 工具类 / 组件 |

   > 抽离原因必须回答：**为什么不能让各功能模块各自实现？统一抽离的收益是什么？不抽离的风险是什么？**

2. 用户确认/调整抽离清单
3. 为每个公共模块**直接生成独立的公共 TRD**（文件名：`trds/common-{模块名}-trd.md`）

   **⚠️ 精简流程——不走 G1~G6 门禁**：公共 TRD 的 R 范围和上下文在 Step 7 已确定，**不需要**重新走模式选择、R 确认、额外上下文收集等循环。直接生成 → 用户审阅 → 保存。

   - **输出格式**与功能 TRD 一致（§1~§7），但 §2 需求覆盖矩阵只列涉及该公共模块的 R
   - §1 概述中标注：「本 TRD 为公共模块，供以下功能 TRD 引用：{列表}」
   - 若公共模块满足复杂度判定条件 → 检查 **design.md 是否已按 design-module 粒度展开了该模块**：
     - **design 已展开** → 公共 TRD 直接引用 design 中的类图/模式选型/协作流程,只补充接口签名 + 伪代码 + 边界处理的实现细节
     - **design 未展开或不存在** → 自动按 `seedpacespec-design-module` Step 3 的思考粒度完整展开（类图→模块图→职责表→模式选型→伪代码+设计解读→协作流程→边界与异常）
   - 若不满足复杂度条件 → 职责表 + 接口签名 + 设计说明即可

4. 公共 TRD 保存后，**AskQuestion 确认下一步**：

   > 公共模块 TRD 已生成并保存：
   > - `trds/common-{模块名}-trd.md` ✅
   >
   > 接下来如何继续？
   > A) 继续生成功能 TRD（引用已生成的公共 TRD）
   > B) 我要先审阅/修改公共 TRD，改完再继续
   > C) 还有其他公共模块需要先抽离

   - 用户选 A → 进入 Step 8 继续主流程
   - 用户选 B → 根据用户反馈修改公共 TRD → 保存 → 重新回到本 AskQuestion（用户可继续选 B 反复修改，直到满意后选 A 继续）
   - 用户选 C → 回到本步第 1 条，补充抽离分析表

5. 后续功能 TRD 中引用公共模块时，用 `→ 详见 common-{模块名}-trd.md` 引用，不重复展开

**用户选 B 或 C** → 记录决定，直接进入 Step 8。

**⚠️ 本步不影响 R 范围**：R 的确认在 G3（Step 4 之后）已完成。本步只是从已确认的 R 中识别共性，先把公共部分独立设计。功能 TRD 的 R 范围不变。


### Step 8: 条件加载评估（G5 门禁）

⛔ 约束: 必须在 Step 9 之前完成。不输出评估表 = G5 未通过 = 禁止进入 Step 9。判定来源完全由 `references/<stack>/loaders.yaml` 配置驱动

**执行流程**：

1. 确认已加载 `references/<stack>/loaders.yaml`（来自 G0 输出，文件名见 `seedpacespec/role.yaml` 的 `loads` 字段；若 `plugins.trd.references_dir` 已配置，从该目录加载）
2. **必读项**：把 `loaders.yaml.mandatory` 列表里的所有文件全部 Read（典型至少包含黄金样本）
   - **各栈独立黄金样本**：各栈 `loaders.yaml.mandatory` 可指定本栈专属的黄金样本（如 `examples/backend-high-quality-trd.md`）。若有专属样本则以专属样本为质量锚点；若无，则 fallback 到通用 `examples/high-quality-trd.md`
   - `plugins.trd.example` 配置可覆盖所有栈的默认样本路径
3. **条件项**：逐条遍历 `loaders.yaml.conditions`，按 `quick_check` 字段执行判定
4. **输出评估表**（结构如下，行数 = `mandatory` 项数 + `conditions` 项数）
5. 对所有"命中=✅"的行，**立即用 Read 工具读取对应文件**（路径以 loaders.yaml 中 `file` 字段为准，相对其所在目录解析）
6. 全部命中文件读取完毕后，方可进入 Step 9


**评估表模板**（必须原样输出表头；行数动态——`mandatory` 一行一项，`conditions` 一行一项；`#` 列对 mandatory 写"必读"，对 conditions 直接照搬其 `id`）：

```
┌─────┬──────────────────────────────┬────────┬─────────────────────┬────────┐
│  #  │ 条件 (label)                  │ 命中？ │ 判定依据            │ 已读取？│
├─────┼──────────────────────────────┼────────┼─────────────────────┼────────┤
│ 必读│ {mandatory[i].label}          │ ✅ 命中│ 配置标记为必读      │ ✅/❌  │
│ {id}│ {conditions[j].label}         │ ✅/❌  │ {依据}              │ ✅/❌/— │
│ ... │ ...                           │ ...    │ ...                 │ ...    │
└─────┴──────────────────────────────┴────────┴─────────────────────┴────────┘
```

**命中 → 必须先读文件再继续。** 任一行"命中=✅"但"已读取=❌" → 停止，先读取对应文件。

**判定独立性**：所有 conditions 之间相互独立，可同时命中多条；命中多条 → 叠加读取所有命中文件。

**配置占位 / 全部不命中的兜底**：若 `loaders.yaml.conditions` 为空（如当前 `backend/` `embedded/` 占位状态），或全部条件都不命中——**仍须读取 mandatory 中的全部文件**，并按 `fallback_note` 字段处理。

⛔ **无专属 guide 时的强制兜底**：此时**必须额外 Read `references/stack-thinking-skeleton.md`**，重点阅读其中对应技术栈的「各层核心设计问题」表和「设计意图必答题」

### Step 9: 生成 TRD

⛔ 约束: Step 8 评估表必须已输出，且所有"命中=✅"行的文件已读取。否则回到 Step 8。

**生成 TRD 依赖三类输入，各司其职（仅 Full 级别）：**

| 输入 | 角色 | 说明 |
|------|------|------|
| **骨架** `templates/trd-skeleton.md` | 结构框架 | 决定 TRD 有哪些章节、章节顺序、章节间约束关系。骨架中 blockquote 段落（architecture/design/TRD 三者关系、分层来源规则、写作规则等）是**强制生成约束**，必须逐条遵守。⛔ 生成前必须已 Read |
| **填充指南** `references/` 下的文件 | 思考维度 | 决定每层**用什么问题展开**。Step 8 已加载的条件参考文件（如 `frontend/ui-component-guide.md`）提供该栈专属的展开维度；若无专属 guide 或条件全部未命中，则由 `references/stack-thinking-skeleton.md` 兜底——按其中对应技术栈的「各层核心设计问题」和「设计意图必答题」展开 |
| **黄金样本** `examples/high-quality-trd.md` | 深度标尺 | 用黄金样本**检验输出深度**——产出是否有充分的设计推理，而不是只有小标题+bullet 的流水账。这不是内容模板——不模仿它写了什么，只对标它**怎么写**的层次和深度 |

**三者协作关系**：骨架定结构 → 填充指南定每层问什么 → 黄金样本校深度。缺一环都可能导致产出质量不达标。

⛔ **核心理念：三者是"约束+引导"，不是"照抄模板"**

AI 生成时的正确心智模型是：**"我在设计这个项目的技术方案，骨架告诉我格式要求，guide 提醒我别漏了重要维度，黄金样本告诉我写到多深才算合格"**——而不是"我在填一个表格模板"。

| 输入 | 它约束什么 | 它**不**决定什么（由项目实际情况决定） |
|------|-----------|--------------------------------------|
| **骨架** | 必须有 §4、§4 必须分层、必须写设计意图 | 具体分几层、层叫什么名字 → 从 architecture.md / design.md / 技术栈推导 |
| **填充指南** | UI 层要想组件树/状态归属/需求链路；后端要想事务边界/并发安全 | 具体树长什么样、状态归到哪、事务怎么划 → 由项目实际代码和 PRD 需求决定 |
| **黄金样本** | 设计意图要有 why + 备选方案 + 取舍推理 | 具体推理什么内容 → 完全由当前需求和技术选型决定 |

**禁止的行为**：
- ❌ 把骨架当表格逐格填写——骨架是结构约束，不是填空题
- ❌ 把填充指南的示例照搬换名字——guide 的正反例是教你写法思路，不是让你复制粘贴
- ❌ 把黄金样本的具体内容模仿一遍——样本是深度标尺，学的是"怎么写"不是"写什么"
- ❌ 因为 guide 没覆盖某个层就不写设计意图——guide 只是提醒维度，通用的设计意图规则（5 点）始终适用

**章节用途说明输出控制**：读取 `seedpacespec/config.yaml` → `trdGenerator.showSectionGuide`：
- `true`（默认）：TRD 产出中保留每章的 `> **用途**：...` blockquote，帮助读者理解各章节的作用和消费方式
- `false`：生成时去掉所有用途说明行，产出更紧凑

> Eval / Min 级别不使用骨架和黄金样本——Eval 按本文件中的「Eval 输出模板」执行，Min 仅在 §2 矩阵标注。

Full 级别的 TRD 必须满足以下三项兜底要求：

1. **术语必须是原生的**：不是"把 Component 替换为 Controller"这种文字替换，而是用该技术栈做设计时**自然会用的术语和思考维度**。后端的 §4 应该读起来像后端架构师写的，嵌入式的应该读起来像固件工程师写的。
2. **深度不能流水账**：产出后用黄金样本做对比自检——如果某层只剩小标题+bullet、没有设计推理，说明深度不够，必须补充。
3. **需求闭环可审查**：§4 中每条 R 的设计必须让读者能回答三个问题——**怎么做**（技术方案）、**为什么**（设计意图）、**需求是否满足**（回溯到 PRD 的 R 编号 + 验收标准）。读者仅凭 TRD 即可理解从需求到实现的决策链路，不需要再去猜。

若 Step 5 用户提供了**对标 TRD 路径**：生成前 **Read** 该文件；最终 §4 的展开深度**不得低于**该参考。

**外层循环边界**：本步每次执行生成**一份完整 TRD**（当前 R × 当前子包）。生成完毕后进入 Step 9.5 确认循环。外层循环由 §4.4 控制（模式 C/D 循环多条 R；monorepo 循环多个子包）。

**内层分块（单份 TRD 内部的生成策略）**：

> 用途：当单份 TRD 复杂度较高时，需要在生成过程中分块输出 + 中间确认，避免一次性输出过长导致方向偏离。分块生成的具体 AskQuestion 流程由 `references/<stack>/advanced-scenarios.md` 定义。
> 后台/嵌入式若有等价文档，应在各自 `loaders.yaml` 中以同样的 `id`/`label` 暴露，本节自动适配。

| 复杂度 | 判定条件 | 生成方式 |
|--------|---------|---------|
| **简单** | <5 R 且 ≤2 层 | 直接全量生成整份 TRD |
| **复杂** | ≥5 R 或 ≥3 层 | 读 `advanced-scenarios.md` §分块生成 → 按其中定义的分块确认流程逐块输出，每块经用户确认后再继续下一块 |
| **边界** | 恰好 5 R 或恰好 3 层 | AskQuestion：「本模块包含 N 个需求 / M 个架构层，建议分块生成。」选项：A）分块生成；B）直接全量 |
| **多模板** | 多 R 模板组 / 单 R 内多模板 | 读 `advanced-scenarios.md` §多模板，按其中定义的 AskQuestion 模板确认流程执行 |

⛔ **分块确认 ≠ 最终确认**：分块内部的逐块确认是"边写边对齐方向"；Step 9.5 的 Q6 确认循环是整份 TRD 写完后的**最终验收**。两者并存，分块确认不替代最终确认。

---

**模式 B（增量更新已有 TRD）**：

> 用途：用户在 Step 4 选择了模式 B 时（已有 TRD，补充新上下文），不是从零生成，而是在已有 TRD 基础上局部更新。

1. 读取现有 TRD → 识别受影响章节 → **仅重写受影响部分** → §7 追加变更记录
2. **不得重写未受影响章节**
3. **补充接口文档时**：逐项校验数据模型字段与最新接口一致性、API 调用与最新契约匹配 → 不一致时主动修正（标注「因接口文档更新而调整」）
4. **补充测试用例时**：不只是把场景搬到 §6——要**回溯 §4 各层方案**，检查测试用例中提到的异常分支、边界条件、并发/超时等场景在设计中是否已被覆盖（哪一层处理、怎么兜底）。未覆盖的 → 补充到对应 §4.x 的设计方案中（标注「因测试用例补充而增强」），同时更新 §6 测试要点

### Step 9.5: TRD 确认循环（G6 门禁）

⛔ 约束: 每份 TRD 生成后都必须执行本步，无论单包/monorepo、分块/全量。分块内部的逐块确认与本步并存不替代——本步是整份 TRD 的最终验收。

⛔ 约束: **确认循环必须设置上限，防止无休止重写**：
1. **同一份 TRD 的“重新生成（选 C）”最多 10 次**
2. **同一份 TRD 的“需要修改（选 B）”最多 10 轮**
3. 达到任一上限后：必须停止继续重写/重生成，改为 AskQuestion 一次性收集“失败原因 + 需要补充的上下文/约束”（如：具体不满意点、必须遵守的接口/字段、参考代码路径、期望的章节深度、必须/禁止的技术选型），并明确告知“收集到信息后再进入 Step 9 重写”

AskQuestion：

> **📋 Q6 用户可见文案模板**：
> - question: "技术方案已生成完毕：{文件名}，请审阅后选择："
> - option 1: label="满意，保存并继续" description="确认当前方案，保存文件并进入下一步"
> - option 2: label="需要修改" description="指出需要调整的地方，我来修改后再次确认"
> - option 3: label="整体方向有问题" description="放弃当前方案，重新生成"

```
TRD 已生成完毕：{文件名}

请 review 后选择：
  A) 满意，保存并继续
  B) 需要修改 — 请指出修改点，我来调整
  C) 整体方向有问题，需要重新生成
```

**选 A — 满意，执行以下三步（按顺序，不可省略，不可调换）：**

1. **立即更新状态标记**：将文件末尾的 `<!-- sdx:status=draft -->` 替换为 `<!-- sdx:status=confirmed -->`
2. **反馈记忆收集**（必须执行）：按 `.cursor/skills/_shared/memory-protocol.md` 的"收集时机"执行——分析本轮确认过程是否有值得记录的纠正/肯定/决策信号，有则写入记忆文件并简短告知用户。
3. **进入 Step 10 保存**，保存后按 §4.4 循环规则判定下一步：
   - monorepo 且当前需求还有未生成的子包 → 继续下一子包
   - 当前需求的所有子包都完成 → Q-next-req 询问是否继续下一条需求
   - 全部完成 → 流程结束

**选 B — 需要修改：**

根据用户反馈修改 → 修改完毕后重新展示本确认循环（用户可反复选 B 直到满意）→ 最终选 A 时执行上述三步（此时记忆收集重点关注纠正类记忆）

**选 C — 重新生成：**

回到 Step 9 重新生成（保留已加载的上下文和 references，不需要重走 Step 2~8）

### Step 10: 保存

保存到 `seedpacespec/changes/active-change/<变更名>/trds/{名称}-trd.md`。

**状态标记**：TRD 文件末尾必须包含状态标记用于断点恢复：
- Step 9 生成时写入 `<!-- sdx:status=draft -->`
- Step 9.5 用户确认通过时（选 A 第 1 步）已更新为 `<!-- sdx:status=confirmed -->`
- 恢复协议通过此标记判断 TRD 是否已经过用户确认：`draft` 状态的 TRD 需要重新进入确认循环；无标记的旧文件视为 `confirmed`（兼容旧版本）

分模块模式额外生成 `trds/README.md` 汇总。

<!-- slot:after_trd_generated -->

---

## Loaders 配置说明（Reference Loading Architecture）

> **本节解释配置文件结构，便于团队拓展。** Step 8 已经从配置驱动；这里只解释配置怎么组织、怎么加技术栈、怎么加条件。

```
references/
├── loaders.yaml              ← 顶层路由：技术栈检测规则 + 子目录映射 + monorepo/消岐策略
├── stack-thinking-skeleton.md ← 无专属 guide 时的 §4 兜底思考框架（所有栈共用）
├── frontend/
│   ├── loaders.yaml          ← 前端的 mandatory + conditions
│   ├── ui-component-guide.md
│   └── advanced-scenarios.md
├── backend/
│   └── loaders.yaml          ← 占位，待后台团队补 references
├── sdk/
│   ├── loaders.yaml
│   ├── sdk-api-design-guide.md
│   └── sdk-lifecycle-guide.md
├── embedded/
│   └── loaders.yaml          ← 占位
└── ...
```

### 黄金样本机制

当前 `examples/high-quality-trd.md` 为通用黄金样本（偏前端场景），各栈共用。

**各栈可配置独立样本**：在各栈 `loaders.yaml` 的 `mandatory` 中，将 `file` 指向本栈专属样本即可。例如：

```yaml
# references/backend/loaders.yaml
mandatory:
  - file: ../../examples/backend-high-quality-trd.md   # 后端专属
    label: 黄金样本(质量锚点)
    reason: 后端 TRD 写作风格标杆
```

未配置专属样本的栈仍 fallback 到通用 `examples/high-quality-trd.md`。`plugins.trd.example` 可在项目级覆盖所有栈的样本路径。

### 三个核心文件

| 文件 | 作用 | 谁来改 |
|------|------|--------|
| `references/loaders.yaml` | 注册技术栈、检测规则、monorepo 策略、消岐选项 | **新增技术栈时改这里** |
| `references/<stack>/loaders.yaml` | 本技术栈的必读项和条件项 | **新增/调整加载条件时改这里** |
| `seedpacespec/role.yaml` | 项目布局 + 每个(子)包的角色（Step 2 自动写入） | **不要手动改**，除非角色确实变了 |


---

⛔ **Full 级别生成 TRD 前，必须先 Read 骨架模板**：

```
Read: <本 skill 目录>/templates/trd-skeleton.md
```

骨架模板是 TRD 的**结构定义 + 生成约束**的唯一来源。其中：
- **Markdown 标题结构**（§1–§7）定义了 TRD 必须包含的章节及顺序
- **blockquote（`>` 开头的段落）是强制生成约束，不是占位注释**，必须逐条遵守：
  - architecture / design / TRD 三者关系（通用层 → 业务子层 → 代码实体）
  - §4 要写多少层（分层来源规则）
  - §4.x 各层的内容维度查找（专属 guide → stack-thinking-skeleton → 通用设计意图）
  - 写作规则（设计意图、伪代码+解读、接口签名+设计说明等）
  - 各章节的用途说明（指导 sdx-apply 如何消费该章节）
- 生成时必须**遵守骨架中的约束指令**，而非仅复制其 Markdown 结构

> Eval 级别按本文件中的「Eval 输出模板」执行，Min 级别仅在 §2 矩阵标注，均不使用骨架。

<!-- slot:trd_output_format -->
## TRD Output Template
<!-- /slot:trd_output_format -->

---


## Guardrails

⛔ 以下为全局红线。生成完毕后逐行自检，任何一行不通过 → 修正后再交付。

### 流程约束（执行流程中内联引用 `→ 见 Guardrails`）

- ⛔ **GR1** 禁止编造跳过理由：不存在"恢复协议选项 B"、"追加模式"、"精简流程"等可以跳过门禁的机制。唯一允许精简的场景是 Step 7 公共模块 TRD 生成。→ 见 State Machine Gates
- ⛔ **GR2** 交互阻断型门禁（G0/G3.1/G3.2/G4.1/G4.2）执行单轮唯一输出约束：本轮输出仅限该门禁的可验证产出 + AskUserQuestion，调用后立即停止。上一轮未执行过前置门禁的 AskUserQuestion 并收到用户回复 → 立即回退到缺失门禁。"需求简单"等理由不构成跳过正当依据。→ 见 State Machine Gates
- ⛔ **GR3** 反馈记忆不可省略：读取（Step 3）不可假设"上次已读过"；记录（Step 9.5 选 A）三步严格顺序（①状态标记→②反馈收集→③Step 10），第 2 步必须有可见输出。选 B 反复修改后最终选 A 时，重点关注纠正类记忆。→ 见 State Machine Gates

### 内容质量（TRD 产出自检清单）

| # | 规则 | 检查标准 | ❌ 红线（命中即不通过） |
|---|------|---------|----------------------|
| 1 | **覆盖完整** | 每条 R 在 §2 矩阵有对应章节，§4 中有对应设计 | 遗漏 R；写了 R-ID 但 §4 无对应设计 |
| 2 | **设计意图充分** | Full 级别：每层 ≥3 句话（含 why + 替代方案 + 取舍）；核心决策 ≥5 句话。学习每个栈引用材料或stack-thinking-skeleton的推理深度。Eval 级别：每个改动点须说明改动意图 | 一句话带过："使用 xx 管理状态" / "封装为 Hook" |
| 3 | **代码实体真实** | 引用的文件/函数/类在代码库中真实存在；接口字段一一映射 | 编造不存在的 API 或文件路径 |
| 4 | **有据可依** | 有文档引文档（design 决策附一句话摘要：`基于 D03(原因)`）；没有标"基于推断" | 光写 `基于 D03` 不附摘要；有文档却不引用 |
| 5 | **design 对齐** | D 编号直接采纳不重新评估；文件路径跟 design 文件树；模块拆分以 design 为起点（可补充，标注"TRD 补充"）；design 的约束表条目作为 §4 硬限制 | 推翻 design 决策但未说明；路径与 design 树矛盾；忽略 design 约束表 |
| 5a | **接口文档对齐** | 接口文档（C4）已加载时：§4 中的数据模型字段必须与接口响应一一映射；API 调用方式/参数/错误码必须与契约匹配；字段命名以接口文档为准不自创 | 接口文档已加载却在 §4 中编造字段名或接口路径；模型定义与接口契约矛盾 |
| 5b | **测试用例回溯** | 测试用例（C5）已加载时：用例中的异常分支、边界条件、并发/超时场景必须在 §4 对应层中体现如何处理（哪层兜底、什么策略）；未覆盖的场景须补充到 §4 并更新 §6 | 测试用例已加载却仅搬到 §6 列表，§4 方案中看不出对这些场景的设计覆盖 |
| 6 | **类型真实 + 伪代码设计解读** | 类型定义用项目真实语法；实现逻辑用英文伪代码 + 中文设计解读（阐明编排逻辑和兜底策略，非逐行翻译） | 设计解读仅为"先调 A 再调 B 最后返回 C"的流水账 |
| 7 | **命名一致** | 命名/文件组织/代码模式与项目已有同类代码保持一致 | 自创 architecture.md 不存在的层名；编造目录结构或命名风格 |
| 8 | **缺失上下文降级** | 缺失项在 §5 标注降级策略和补充指引 | 缺上下文但不标注 |
| 9 | **逻辑单元完整** | 可复用单元有接口签名（真实语法）+ 设计说明（为什么提取、消费者、边界情况） | 只列名字和一句话描述，无签名无设计说明 |
| 10 | **视图/入口层完整** | 数据来源 + 内部状态 + 职责边界 + 对外接口/props；有异步编排需说明流程 | 缺数据来源或内部状态 |
| 11 | **不复述 PRD** | 引用 R-ID 即可 | 复制粘贴需求原文 |
| 12 | **不写完整实现** | 无 render 函数 / 完整组件代码 | 贴整个实现代码 |
| 13 | **不压缩表达** | 用自然语言分步描述，不用箭头链（`A → B → C`） | 电报式压缩代替叙述 |
| 14 | **不硬编码层名** | architecture.md 有分层 → 采用；无分层 → AI 自行分析，禁止平铺不分层 | 自创层名；或无分层就把 §4 全平铺 |
| 15 | **不偷工减料** | 每个设计点必须说清 why + 不这样做会怎样 | "使用 Flex 布局"一句话跳过 |
| 16 | **不目录式堆砌** | §4 每层有设计意图正文 + 支撑块（表/伪代码/逐模块设计等） | 连续小标题 + bullet，无展开正文 |
| 17 | **不跨包合写** | 一份 TRD 只服务一个 (子包, 角色)。→ 见 §4.4 | 跨子包/跨角色合并为一份 |
| 18 | **不硬编码加载条件** | 所有 references 加载判定读 `references/<stack>/loaders.yaml` | 把 L1~L4 当常量硬编码进流程 |
| 19 | **薄 PRD ≠ 薄实现** | Full 级别：PRD 简略时 §4 仍须完整展开，用 `stack-thinking-skeleton.md` 的"必答题"检查遗漏。Eval/Min 不受此约束 | Full 级别因 PRD 简单就只写提纲级 §4 |
| 20 | **学风格不学内容** | references 未命中时 Full 级别仍须：①学黄金样本写作风格；②用本栈原生思考维度；③每条 R 写明做什么、为什么、如何验证 | 把黄金样本当模板批量替换术语；或因无参考就降级为提纲 |

> 各技术栈特有检查标准由 `references/<stack>/` 下的写作指南补充，不在此表硬编码。

---

## design.md Consumption

> design.md 是 TRD 的**上游输入**——TRD 直接采纳 design 的决策和模块划分,不重新评估。
> 以下表说明 design.md 各章节如何被 TRD 消费。

| design.md 章节 | TRD 消费方式 |
|----------------|-------------|
| **技术选型与决策** (D01~Dnn) | §1 标注「设计决策引用：D01 — 直接采纳」；§2 矩阵"决策引用"列填 D 编号；§4 设计意图中引用时**必须附带一句话摘要**，让 reviewer 不跳转也能 get——格式：`基于 D03(新建独立 Reducer,因为环节类型枚举不同)`，而不是光写 `基于 D03` |
| **模块总览** (模块划分图 + 职责表) | §4 只为 design 涉及的层写子章节,**层名从 architecture.md 读取**；层内的模块拆分**以 design 职责表为起点**——design 画了 A/B/C,TRD 在对应层里按 A/B/C 展开；但 TRD 在实现层面**可以补充 design 未预见的模块**(如 design 只画了"知识讲解",TRD 展开后发现需要拆出 ConceptTeach / MethodTeach 等子组件),补充的模块在 §4 正文中标注"TRD 补充"即可 |
| **核心模块设计** (四要素) | §4 各层的设计意图可引用 design 中的"为什么存在/取舍"说明,不重复展开；TRD 可补充 design 未涉及的实现级取舍和更细粒度的设计推理 |
| **功能点/非功能点/约束** | §2 需求覆盖矩阵对齐功能点编号；约束直接作为 §4 的硬限制(如 C01 JSBridge 限制 → §4 数据层方案受此约束)；非功能点的"设计上如何满足"由 TRD §4 展开为具体实现方案 |
| **本设计的优缺点** | 已知局限搬入 §5 风险表,标注"来源：design.md" |
| **Risks / Trade-offs** | 搬入 §5,标注来源 |
| **模块与文件结构(树状图)** | §4 文件改动表直接引用 design 树中的路径,不自创新路径 |
| **Goals / Non-Goals** | Non-Goals 纳入 §1「不影响什么」 |

---

## Downstream

```
✅ TRD 已保存到 seedpacespec/changes/active-change/<变更名>/trds/

后续可选:
1. 调用 trd-spec-extractor 提取结构化技术规格 JSON
2. 调用 business-defect-detector 进行缺陷检测
3. 人工审查修改后再进行上述操作
```

---

