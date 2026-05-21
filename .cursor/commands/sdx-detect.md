---
name: /sdx-detect
id: sdx-detect
category: Quality
description: 基于 PRD + TRD + Git 变更检测业务逻辑缺陷，输出缺陷报告。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"检查有没有bug"、"跑质检"、"代码review"、"提交前检查"。SKIP: 想写单测用 /sdx-test-plan。requires: PRD + TRD + Git 基准分支。output: defect-report.md
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-defect-detect/SKILL.md` 全文。

对 seedpacespec 变更执行**业务缺陷检测流水线**。

**输入**：可选指定变更名和 Git 比较基准。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G6）和执行流程执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **G1 未完成（缺 PRD/TRD/Git 范围）→ 禁止开始检测**
- **G2~G6 自动串行**，无需用户逐步确认，但每步打印进度
- **确凿证据原则**：无证据不判定；不确定时标注不确定性并降低置信度
- **PRD/TRD JSON 不落盘**：仅内存传递
- **不写业务代码**：本命令只输出报告，修复请用 `/sdx-apply` 或 `/sdx-update-task`
