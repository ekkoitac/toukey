---
name: seedpacespec-drift-check
id: seedpacespec-drift-check
category: Quality
description: >
  检查指定 Git 范围内的源码变更是否与活跃变更的 TRD/design 对齐，输出漂移报告。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"检查文档漂移"、"文档是否对齐"、"spec 对齐检查"、"drift check"、"推送前检查漂移"。
  SKIP: 被动检测场景（rules/CLAUDE.md 自动触发走 doc-drift-awareness.md 模式 A，不走本 skill）；用户想做缺陷检测不是漂移检测（用 sdx-detect）。
  requires: 活跃变更 + Git 比较范围。
  output: 漂移检测报告（命中的文件 + 对应 TRD/design 章节 + 建议操作）。
---

对 seedpacespec 变更执行**手动文档漂移检测**。

这是文档漂移检测的**手动调用**入口。
与被动模式（`.claude/skills/_shared/doc-drift-awareness.md`）的区别：手动模式需要先收集上下文（变更名、Git 范围），然后基于 git diff 文件列表执行检测。

## State Machine Gates

执行前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得跳入后续步骤。**

| # | 状态 | 完成条件 | 未完成时行为 |
|---|------|---------|-------------|
| G1 | `inputs_collected` | 变更已选定、Git 比较范围已确定 | AskQuestion 收集缺失信息 |
| G2 | `drift_detected` | 已完成漂移检测（Step 2~4） | 执行检测 |
| G3 | `report_output` | 漂移报告已输出 | 输出报告 |

**状态推进单向** G1→G2→G3，不得跳跃。


**🚫 禁止编造跳过理由**：AI 不得以任何自创名义（如恢复协议、追加模式、精简流程、复用已有产物、简化模式等）跳过门禁。所有门禁必须逐一通过并产出可验证输出。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。
---

## Step 1. 收集输入（→ G1）

缺失时用 **AskQuestion** 收集：

| 信息 | 来源 | 必需 |
|------|------|------|
| **变更名** | 用户提供 或 `seedpacespec list --json` 选择 | ✅ |
| **Git 比较基准** | 用户提供（如 `main`、`HEAD~5`、commit hash） | ✅ |
| **Git 比较目标** | 默认 `HEAD` | 否 |
| **聚焦模块** | 用户可指定某个目录优先分析 | 否 |

**自动探测变更逻辑**：
```
变更目录 = seedpacespec/changes/active-change/<变更名>/
```

**Git 比较范围选择**（与 defect-detect 一致）：

用户未提供时：
1. 运行 `git log --oneline -20` 获取最近 20 条 commit
2. 运行 `git branch -a --sort=-committerdate | head -10` 获取活跃分支
3. 用 **AskQuestion** 以列表形式让用户选择 source 和 target

**G1 完成后、G2 开始前**，必须展示参数摘要并用 **AskQuestion** 确认：
「即将执行文档漂移检测，参数如下：\n- 变更：`<name>`\n- Git 范围：`<source>...<target>`\n- 聚焦模块：`<path 或 无>`\n\n确认开始？」

---

## Step 2. 获取变更文件列表（→ G2 前置）

```bash
git diff --name-only <source>...<target>
```

过滤：
- 排除 `.cursor/`、`.claude/`、`seedpacespec/` 目录
- 排除测试文件（`test/`、`__tests__/`、`*_test.*`、`*.spec.*`）
- 排除配置文件（`package.json`、`tsconfig.json`、`.eslintrc` 等）
- 只保留源码文件

---

## Step 3. 执行漂移检测（→ G2）

使用 `.claude/skills/_shared/doc-drift-awareness.md` 的 **Step 2（检测变更范围命中）** 和 **Step 3（检测 architecture.md 公共模块命中）** 流程，但输入文件列表来自 Step 2 的 git diff 结果（而非当前对话修改的文件）。

具体执行：
1. 读取聚焦变更的 `design.md`「模块与文件结构」→ 提取文件路径列表
2. 读取聚焦变更的 `trds/*.md` → 提取引用的源码文件路径
3. 将 git diff 文件列表与上述路径匹配
4. 若存在 `architecture.md` → 检查公共模块命中

---

## Step 4. 输出漂移报告（→ G3）

按 `doc-drift-awareness.md` 的 **Step 4** 格式输出。额外增加统计摘要：

```
━━ 文档漂移检测报告 ━━

变更：<name>
Git 范围：<source>...<target>
检测文件数：<N>

## 漂移命中

[按 doc-drift-awareness.md Step 4 的情况 A/A-multi/B/D 格式输出]

## 建议操作

- 若有漂移 → 建议执行 /sdx-update-task <变更名>
- 若命中公共模块 → 建议检查引用方适配 + /sdx-analyzer-project 增量更新
- 若无漂移 → ✅ 文档与代码对齐，无需操作
```

---

## Guardrails

- **G1 未完成（缺变更名/Git 范围）→ 禁止开始检测**
- **不写任何代码**：本 skill 只做检测和输出报告
- **不修改任何文档**：只建议操作，不自动执行
- **检测成本控制**：只读文件树和章节标题，不做代码语义分析（同 doc-drift-awareness.md 的成本控制原则）
