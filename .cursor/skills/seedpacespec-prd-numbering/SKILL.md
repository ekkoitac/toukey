---
name: seedpacespec-prd-numbering
id: seedpacespec-prd-numbering
category: Workflow
description: >
  为已有 PRD Markdown 补充或统一需求编号（R01/R02…），便于衔接 TRD、tasks。TRIGGER when:
  （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说
  「PRD 没有编号」「给 PRD 加 R 编号」「统一需求编号」「重新编号 PRD」「规范化 PRD ID」。
  SKIP: 用户要从零写 PRD（用 sdx-explore / sdx-guided / sdx-figma-prd）；用户只想改 TRD（用 sdx-update-task）。
  requires: 一份可读的 PRD `.md`（路径或变更目录内 specs）。
  output: 更新后的 PRD 文件（或另存为 `*-prd-numbered.md`），附编号对照表。
  examples: "/sdx-prd-numbering specs/foo-prd.md" → 触发；"R01 是什么" → 不触发。
---

# seedpacespec-prd-numbering

## Goal

将**部门已有但未按 seedpacespec 约定编号**的 PRD，整理为可被下游消费的 **需求 ID**：

- **标准格式**：`R01`、`R02`、…（两位数字，从 `01` 起连续递增），与 `seedpacespec-explore` / `seedpacespec-propose` 的 tasks、TRD 引用习惯一致。
- **兼容识别**：把文中已有的 `R1`、`R-01`、`R 01`、`REQ-1`、`需求 1`、`#1` 等视为「待归一条目」，映射到统一的 `Rnn`，并在文末给出 **编号对照表**。

本 skill **只做编号与结构对齐**，不扩写业务需求；若原文条目语义不清，AskQuestion 让用户确认后再写入。

---

## State Machine Gates

⛔ 约束：门禁未完成 → 只能 AskQuestion，不得覆盖写入 PRD。

| #  | 状态                    | 完成条件                                               | 未完成时行为        |
|----|-------------------------|--------------------------------------------------------|---------------------|
| G1 | `prd_source_resolved`   | 已确定要处理的 PRD 文件路径（或变更名 + specs 内文件） | AskQuestion 让用户选 |
| G2 | `strategy_confirmed`    | 用户确认编号策略（见下文「编号策略」）                 | AskQuestion         |
| G3 | `mapping_reviewed`      | 用户已确认「条目清单 + 拟分配 R 编号」对照表           | 展示对照表待确认    |
| G4 | `write_done`            | 已按确认结果写入文件（或另存）                         | 执行写入            |

⛔ 约束：禁止编造跳过理由；未经 G3 确认不得执行 G4。

---

## 编号策略（AskQuestion 必问）

在 G2 用 **AskQuestion** 让用户选一项（可加一行说明默认推荐）：

1. **顺序重编（推荐）**：按文档中出现顺序（或「需求清单」表格行序）依次分配 `R01`、`R02`…，忽略旧编号冲突。
2. **保留原序号**：若原文已有稳定编号（如业务方的 REQ-5），只做格式归一 → `R05`（不足两位补零），**缺失的号段保留空缺或 AskQuestion 是否压缩连续**。
3. **仅补缺失**：已有 `R01`/`R02` 的不动；只对无 ID 的段落补号，接在后面递增。

同时确认 **写入方式**：

- **覆盖原文件**（建议先提示用户 git 备份或使用副本）
- **另存为新文件**：同目录 `*-prd-numbered.md` 或用户指定路径

---

## 执行流程

### Step 1：定位 PRD（→ G1）

1. 若用户给了路径 → `Read` 该文件，校验为 Markdown。
2. 若用户给了变更名 → 在 `seedpacespec/changes/active-change/<name>/specs/` 下列出 `*.md`，AskQuestion 选一文件。
3. 若都没有 → AskQuestion：粘贴路径 / 变更名 / 从 `seedpacespec list --json` 选变更。

### Step 2：解析条目（内部）

通读 PRD，识别「一条需求」的载体，包括但不限于：

- 「需求清单」表中的每一行
- 二级/三级标题：`## 功能一`、`### 登录`（无 `Rnn` 前缀）
- 枚举：`1.`、`（1）`、`- 需求：` 等（谨慎合并：同一标题下多个 bullet 可能是一条或多条，按语义AskQuestion）

列出 **候选条目清单**（标题摘要 + 原文位置线索），准备映射到 `R01…`。

### Step 3：编号策略与对照表（→ G2/G3）

1. 执行 **编号策略** AskQuestion（见上）。
2. 输出 **拟分配对照表**（Markdown 表格）：

| 新编号 | 原文标识或摘要       | 备注       |
|--------|----------------------|------------|
| R01    | （原「登录」小节）   |            |
| R02    | （原 REQ-7）         | 映射自 REQ-7 |

AskQuestion：**「以上编号是否确认？有需要合并/拆分的条目请说明。」**

### Step 4：改写 PRD（→ G4）

在用户确认后：

1. **需求清单表**（若有）：`ID` 列统一为 `R01`、`R02`…
2. **需求详述标题**：统一为 `### R01 [标题]`、`### R02 [标题]` …（标题保留原文含义，可微调长度）
3. **正文内引用**：将明显的旧引用替换为新编号（如 `需求 3` → `R03`）；不确定处加 `[编号归一：待人工复核]` 注释 **仅当用户同意标注**，默认宁可保留原文也不瞎改。
4. 文首或文末增加固定块：

```markdown
<!-- prd-numbering:seedpacespec -->
> **编号说明**：本文需求 ID 已按 seedpacespec 约定整理为 `R01`…`Rnn`。编号对照见文末。

## 编号对照（归档）

| 新编号 | 原标识 / 位置           |
|--------|---------------------------|
| R01    | …                         |
```

5. 按用户选择的 **覆盖 / 另存** 写入文件。

### Step 5：收尾输出

简短说明：

- 处理文件路径
- 共几条需求（`R01`–`Rnn`）
- 下一步：可执行 `/sdx-propose` 或 `/sdx-trd-generator`（若变更目录已齐）

---

## Guardrails

- ⛔ **不改业务含义**：不借机删除、新增需求内容；仅重组编号与标题格式。
- ⛔ **不静默覆盖**：覆盖写入前须用户在 G2/G3 明确确认；建议提醒 git diff。
- ⛔ **编号体系单一**：正文统一使用 `R01` 风格；避免同一文档混用 `R-01` 与 `R01`（除非用户明确要求保留对外编号于对照表）。
- ⛔ **与下游一致**：后续 TRD/tasks 中的需求引用以本文 `Rnn` 为准；若 PRD 曾被他处引用，提示用户同步下游文档。

---

## 引用

- `seedpacespec-explore` PRD 模板中的需求编号约定（`R01`、`R02`…）
- `seedpacespec-apply-change`：R 编号归一化思路（`R1`/`R01`/`R-01` 视为同一键——本文产出以 **`R01` 两位数字** 为唯一正文写法）
