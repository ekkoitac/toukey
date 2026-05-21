---
name: /sdx-trd-generator
id: sdx-trd-generator
category: Workflow
description: 基于 PRD 生成技术实现方案文档（TRD），精确到代码实体级别。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"生成技术方案"、"写TRD"、"出个技术设计"。SKIP: 没有PRD先用 /sdx-propose。requires: architecture.md + PRD + 变更目录。output: TRD 文件
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-trd-generator/SKILL.md` 全文。

基于 PRD 生成按技术关注点组织的实现方案文档（TRD Markdown）。

**输入**：PRD 文件路径或变更名。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G6）和执行流程执行，不得跳过或合并。**

## 易错提醒

以下是最容易被跳过的状态，从 SKILL.md 中提取重申：

- **G1 模式选择**：不能因为"用户给了 PRD"就默认全量，必须 AskQuestion 让用户选
- **G2+G3 R 编号归一化 + 范围确认**：`R1/R01/R-01` 视为同一需求，最终 R 列表必须经用户确认
- **G6 复杂模块分块确认**：先出概要摘要等用户确认，再逐层展开
- **质量自检**：交付前必须完成；若"只有做什么、没有为什么/取舍"，必须重写后再交付

## Guardrails

- **状态机门禁是 ASSERTION**：任何 gate 未完成 → 只能 AskQuestion，不得进入生成；禁止跳过、合并或替用户做决定
- 引用的代码实体须在仓库中真实存在
- 不复述 PRD 原文，只引用需求 ID
- 技术层名称从 architecture.md 动态读取
- 设计意图必须包含替代方案对比和取舍理由
- 术语使用项目真实技术栈，不照搬示例中的写法
