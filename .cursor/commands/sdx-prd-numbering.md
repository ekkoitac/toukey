---
name: /sdx-prd-numbering
id: sdx-prd-numbering
category: Workflow
description: 为已有 PRD Markdown 补充或统一需求编号（R01/R02…）。TRIGGER when：（sdx 会话或提到 seedpacespec/sdx）且用户要给 PRD 编号、重编号、规范化需求 ID。requires: PRD 文件路径或变更目录 specs。output: 编号后的 PRD + 对照表
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-prd-numbering/SKILL.md` 全文。

## 用途

- 业务侧已有 PRD，但没有 **R01/R02…** 编号，或编号混乱（`R-01`、`REQ-5`、纯序号等）
- 需要与 seedpacespec 下游 **TRD / tasks** 对齐前，先统一 PRD 需求 ID

## 输入

`/sdx-prd-numbering` 后可跟：

- PRD 文件路径（相对仓库根或绝对路径）
- 变更名（kebab-case）：将在 `seedpacespec/changes/active-change/<name>/specs/` 下选择文件
- 无参数：按 skill 门禁 AskQuestion 收集路径或变更

## Guardrails

- 以 skill 正文为准；覆盖写入前必须用户确认（skill 内 G2/G3）
- 本命令只做编号归一，**不自动扩写需求**
