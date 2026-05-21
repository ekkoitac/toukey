---
name: /sdx-drift-check
id: sdx-drift-check
category: Quality
description: 检查指定 Git 范围内的源码变更是否与活跃变更的 TRD/design 对齐，输出漂移报告。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"检查文档漂移"、"文档对齐"、"spec 对齐"、"drift check"。SKIP: 被动检测走 rules 不走本命令。requires: 活跃变更 + Git 基准分支。output: 漂移检测报告
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-drift-check/SKILL.md` 全文。

对 seedpacespec 变更执行**文档漂移检测**。

**输入**：可选指定变更名和 Git 比较基准。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G3）和执行流程执行，不得跳过或合并。**

## Guardrails

- **G1 未完成（缺变更名/Git 范围）→ 禁止开始检测**
- **不写任何代码**：本命令只做检测和输出报告
- **不修改任何文档**：只建议操作，不自动执行
