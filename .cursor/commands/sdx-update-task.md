---
name: /sdx-update-task
id: sdx-update-task
category: Workflow
description: 修改已有变更的设计产物（TRD/design/tasks），不写业务代码。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"方案要改"、"设计不对"、"调整任务"。SKIP: 写代码用 /sdx-apply。requires: 已有变更目录。output: 更新后的 TRD + design.md + tasks.md
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-update-task/SKILL.md` 全文，严格按其中定义的 Workflow 步骤执行。

在已有变更中**添加新功能**或**修改已有设计方案**，自动联动更新 TRD → design → tasks。

**输入**：`/sdx-update-task` 后可选变更名；功能点描述支持自然语言，多条用换行或分号分隔。

**三种模式**（AI 自动识别，无法确定时必须询问用户）：

| 模式 | 触发 | 示例 |
|------|------|------|
| **新增** | 加功能、补遗漏、拆任务 | "加一个导出 PDF 功能" |
| **修改** | 改方案、换策略、调设计 | "TRD §4.3 状态管理要从 Redux 改成 Zustand" |
第三种: 上述两种模式混合

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G7）和执行流程（步骤 1→7）执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **全流程禁止业务代码生成**：整个 update-task 流程（G1→G7）均不得创建或修改 `src/` 等应用源码，引导至 `/sdx-apply`
- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得进入后续步骤；禁止跳过、合并或替用户做决定
- **G3 未完成 → 禁止更新产物**：所有文档必须全部阅读且 R 编号归一化完成后，才能进入确认和更新
- **确认循环**：TRD 更新（G5）和 tasks 更新（G7）均须经用户确认，未确认不得进入后续步骤
- **修改模式下受影响的 `[x]` 任务必须重置为 `[ ]`**，不得保留误导性的完成状态
