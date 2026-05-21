---
name: /sdx-figma-prd
id: sdx-figma-prd
category: Workflow
description: 从 Figma .fig 文件逆向解析并生成 PRD 需求文档。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"从Figma生成PRD"、"解析fig文件"、提供了 .fig 文件路径。SKIP: 没有.fig只有文字需求用 /sdx-explore。requires: 本地 .fig 文件 + 截图。output: PRD Markdown
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-figma-to-prd/SKILL.md` 全文，严格按其中定义的 Workflow 步骤执行。

从 Figma `.fig` 文件生成**可执行的 PRD Markdown 文档**。
`.fig` 逆向为结构化 JSON（内存中间产物），结合截图生成 PRD。

**输入**：`.fig` 文件路径 + 截图（可选指定变更名）。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G4）和执行流程执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得开始生成 PRD；禁止跳过、合并或替用户做决定
- **JSON 仅在内存中使用**，禁止保存到本地文件
- 验收标准必须完整写入，`functionalDescription` 逐条、按顺序、完整写入
- DFS 遍历整棵树，不得跳过 `children`
- 禁止技术 ID 出现在 PRD 正文
