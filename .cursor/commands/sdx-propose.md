---
name: /sdx-propose
id: sdx-propose
category: Workflow
description: 提议新变更——从需求出发，一步生成 proposal、design、TRD、tasks。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"做个新功能"、"新需求"、"开始规划"、"创建变更"。SKIP: 改已有设计用 /sdx-update-task；写代码用 /sdx-apply；想法不确定用 /sdx-explore。requires: seedpacespec CLI。output: proposal.md + design.md + tasks.md + TRD
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-propose/SKILL.md` 全文。

提议一个新变更——创建变更目录并一步生成所有产物。

**将创建**：
- proposal.md（做什么与为什么）
- design.md（怎么做）
- tasks.md（实现步骤）
- `<功能名称>_trd.md`（技术方案）

准备开始实现时，执行 `/sdx-apply`

**输入**：`/sdx-propose` 后参数为变更名（kebab-case），或对要做内容的描述，或不提供参数。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G7）和执行流程执行，不得跳过或合并。**

## Output

- 变更名称与所在路径
- 已创建产物列表及每项简要说明
- 就绪说明：「所有产物已创建！可以开始实现。」
- 提示：「执行 `/sdx-apply` 开始实现。」

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **全流程禁止业务代码生成**：整个 propose 流程均不得创建或修改 `src/` 等应用源码，引导至 `/sdx-apply`
- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得进入后续步骤；禁止跳过、合并或替用户做决定
- **G6 确认循环**：TRD 每次更新后必须重新询问用户确认
- **design.md 文件树须经用户确认后再定稿 tasks**
- **同名变更已存在 → 强制 AskQuestion 问意图**（A 全新 / B 新模块 / C 断点恢复），不得自行推断
