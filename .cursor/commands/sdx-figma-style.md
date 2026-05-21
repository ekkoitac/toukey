---
name: /sdx-figma-style
id: sdx-figma-style
category: Workflow
description: 从 Figma .fig 文件提取样式上下文 JSON（颜色、字号、间距等精确视觉参数），用于 UI 还原。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"提取样式"、"提取Figma样式"、"精确还原UI"。SKIP: 想生成PRD用 /sdx-figma-prd。requires: 本地 .fig 文件。output: style-context.dedup.json
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-figma-to-style/SKILL.md` 全文，严格按其中定义的 Workflow 步骤执行。

从 Figma `.fig` 文件提取**样式上下文 JSON**（视觉属性 + 布局参数）。
产出 `figma_data/json_data/style-context.dedup.json`，供 `/sdx-apply` 实现 UI 任务时参考。

**输入**：`.fig` 文件路径（可选指定变更名）。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G4）和执行流程执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得开始提取；禁止跳过、合并或替用户做决定
- 版本、section、子模块选择必须由用户确认
- 输出颜色必须是 `#RRGGBB` 或 `rgba()` 格式，禁止输出 0~1 浮点
- 布局字段使用 CSS 语义命名，不输出 Kiwi 原始字段名
