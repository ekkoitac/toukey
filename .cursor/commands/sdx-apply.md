---
name: /sdx-apply
id: sdx-apply
category: Workflow
description: 写代码实现变更中的任务——逐条完成 tasks.md 里的实现步骤。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"开始写代码"、"实现这个"、"继续实现"、"做下一个任务"。SKIP: 只改设计用 /sdx-update-task。requires: 变更目录下存在 tasks.md + TRD。output: 业务代码 + tasks 状态更新
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-apply-change/SKILL.md` 全文。

实现 seedpacespec 变更中的任务。

**输入**：可选指定变更名。若省略，尝试从对话上下文推断。若模糊或有歧义，**必须**提示用户从可用变更中选择。

## 上下文文档消化——硬性约束

**在写出任何一行业务代码之前**，必须完成以下文档的阅读与消化。跳过阅读直接编码是**严重违规**。

1. **architecture.md**（项目根目录）— 架构分层、编码约定、模块依赖
2. **design.md**（变更目录）— 技术决策、模块与文件结构树状图
3. **TRD 文档**（`trds/`）— 按技术关注点组织的实现方案
4. **proposal.md**（变更目录）— 变更目标与范围
5. **tasks.md**（变更目录）— 任务分解与依赖关系

**编码时的文档遵从优先级**：TRD 技术方案 > design.md 文件树 > architecture.md 编码约定 > proposal.md/tasks.md 范围边界

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G6）和执行流程执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得进入后续步骤；禁止跳过、合并或替用户做决定
- **G3 未完成 → 禁止编码**：TRD、design.md、architecture.md 是编码的前置依赖
- **TRD 是编码的第一优先级**：代码怎么写以 TRD 为准，不得另起炉灶
- **路径以 design.md 已确认文件树为第一约束**
- **实现中发现需要改设计**：轻量修改在 apply 内直接改 + 确认；重大修改引导 `/sdx-update-task`
- 代码改动保持最小、紧扣单条任务
- 每条任务完成后 AskQuestion 确认，用户确认后才打 `[x]`
