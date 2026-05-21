---
name: /sdx-archive
id: sdx-archive
category: Workflow
description: 归档已完成变更：仅写入 seedpacespec/global-specs/changelog.md（不写根目录 CHANGELOG）+ 目录归档。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"归档"、"收尾"、"变更做完了"、"生成changelog"。SKIP: 还有任务没完成用 /sdx-apply。requires: 变更任务全部完成。output: global-specs 纪要 + 归档
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-archive-change/SKILL.md` 全文。

本命令**不**复述 SKILL 中的 Plugin Protocol、逐步说明、成功模板与 Guardrails——一律以 SKILL 为准。

**输入**：可选变更名；未明确时须 `seedpacespec list --json` + **AskQuestion** 选择（禁止凭对话臆测）。

## Steps（仅索引）

按 SKILL 顺序：**选变更** → **status 检查产物** → **tasks 检查** → **写入 `global-specs/changelog.md`** → **移入 `archive/`** → **展示摘要**。

## Output

成功时的 Markdown 摘要格式与字段说明见 SKILL **「成功时输出」**；含警告 / 目录已存在等边界见 SKILL 与 **Guardrails**。

## Guardrails

- 凡 AskQuestion 须等用户明确回复；**步骤与插件插槽以 SKILL 为唯一依据**。
