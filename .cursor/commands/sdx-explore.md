---
name: /sdx-explore
id: sdx-explore
category: Workflow
description: 探索模式——从模糊想法出发，对话澄清需求、发散方案，可生成 PRD。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"我想做个XX但没想清楚"、"帮我分析下怎么做"、"有个想法"。SKIP: 已明确需求用 /sdx-propose。requires: 无。output: 澄清后的需求 + 可选 PRD
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-explore/SKILL.md` 全文。

本命令**不**复述 SKILL 中的阶段分诊、意图路由、文档模板与 Guardrails——一律以 SKILL 为准。

**定位**：**思考与澄清**，可读代码与架构做调研；**不**在本命令内实现业务功能或批量改代码（实现走 `/sdx-apply` 等）。

**输入**：模糊想法、具体问题、变更名、方案对比，或无参数。

## Steps（仅索引）

步骤：按 SKILL 的**阶段 0 意图分诊**与后续章节流动；是否产出 PRD、是否落盘均由 SKILL + 用户决策。

## Guardrails

- **以 SKILL 为唯一流程依据**；「不实现、不擅自落盘、可视化与追问」等约束均在 SKILL 内定义。
