---
name: /sdx-guided
id: sdx-guided
category: Workflow
description: 引导式变更规划——通过一问一答逐步收集技术决策，生成 Eval 风格的 proposal、design、TRD、tasks。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"引导模式"、"一步步来"、"guided"、"逐步规划"。SKIP: 有完整需求想一键生成用 /sdx-propose；改已有设计用 /sdx-update-task；写代码用 /sdx-apply。requires: seedpacespec CLI。output: proposal.md + design.md + TRD(Eval) + tasks.md
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-guided/SKILL.md` 全文。

引导式变更规划——一问一答收集技术决策，逐步生成变更产物。

**将创建**：
- proposal.md（做什么与为什么）
- design.md（技术决策 + 改动范围）
- TRD（Eval 风格实现方案）
- tasks.md（实现步骤）

准备开始实现时，执行 `/sdx-apply`

**输入**：`/sdx-guided` 后参数为变更名（kebab-case），或对要做内容的描述，或不提供参数。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G8）和执行流程执行，不得跳过或合并。**

## Output

- 变更名称与所在路径
- 已创建产物列表
- 就绪说明：「所有产物已创建！可以开始实现。」
- 提示：「执行 `/sdx-apply` 开始实现。」

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **全流程禁止业务代码生成**：整个 guided 流程均不得创建或修改 `src/` 等应用源码，引导至 `/sdx-apply`
- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得进入后续步骤；禁止跳过、合并或替用户做决定
- **G5 一问一答**：每次 AskQuestion 只包含 1 个技术决策问题，严禁一次问多个
- **G6 决策回顾**：必须等待用户确认所有决策后才能生成产物
- **同名变更已存在 → 强制 AskQuestion 问意图**
