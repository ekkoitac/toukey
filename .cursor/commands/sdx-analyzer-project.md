---
name: /sdx-analyzer-project
id: sdx-analyzer-project
category: Workflow
description: 分析代码仓库并生成根目录 architecture.md。TRIGGER when：（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说「分析项目」「分析架构」「看看仓库结构」「生成 architecture」。SKIP：想规划需求用 /sdx-propose；只想写代码用 /sdx-apply；纯概念问答。requires：已 clone 的本地 git 仓库。output：architecture.md（含文档用途导读）
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-analyzer-project/SKILL.md` 全文；输出结构与章节规则以同目录下 `templates/architecture-output.md` 为准。

本命令**不**重复叙述 SKILL 中的门禁、阶段与 Guardrails——一律以 SKILL 为准。

**输入**：无参数。若 `architecture.md` 已存在，通过 AskQuestion 确认操作模式（全量/增量/沿用/不生成）。

## Steps

**严格按 SKILL.md 的 State Machine Gates 和执行流程执行，不得跳过或合并。**

## Output

**成功时**：仓库根目录 `architecture.md`；头部含生成时间与基准提交；含文档用途导读。

**终止时**：不覆盖文件或不动仓库，输出简短确认。

## Guardrails

- **步骤与门禁以 SKILL 为准**；凡 AskQuestion 须等待用户明确回复
- **客观事实**写作规则不变；「文档用途」表格为导读，不替代各章事实陈述
- **monorepo** 须用户选择聚焦范围，禁止自动推断 core 包
- 超大文件仅记路径与行数；不做逐行代码审计
