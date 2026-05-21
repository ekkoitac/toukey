---
name: seedpacespec-archive-change
description: >
  归档已完成的变更，自动生成 changelog 并收尾。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"归档"、"收尾"、"这个变更做完了"、"生成changelog"。
  SKIP: 用户还有任务没完成（继续用 sdx-apply）；用户想做质检（先用 sdx-detect）。
  requires: seedpacespec/changes/active-change/<name>/ 下任务全部完成。
  output: `seedpacespec/global-specs/changelog.md` 归档纪要（唯一 changelog 落点）+ 变更目录移至 `archive/`。
  examples: "这个功能全做完了，归档吧" → 触发；"帮我写个 changelog" → 不触发。
license: MIT
compatibility: 需要 seedpacespec CLI。
metadata:
  author: seedpacespec
  version: "1.0"
  generatedBy: "seedpacespec"
---

在实验工作流中归档已完成的变更。

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.archive` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `after_changelog_generated` | `global-specs/changelog.md` 写入确认后（步骤 4 之后） | hook | 可用于纪要后处理、额外通知 |
| `before_archive_move` | 执行归档移动前（步骤 5 之前） | hook | 可用于归档前自定义检查、备份 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配的 `skill: archive` + `slot: 名字` 条目 → 有则加载 `run` 指定的文件执行，完毕后回到主流程继续 → 无则跳过。

若无 `plugins` 配置 → 正常执行，无任何变化。

---

**输入**：可选指定变更名。若用户未在本回合消息中明确写出变更名，**必须**运行 `seedpacespec list --json` 并用 AskQuestion 让用户选择，禁止仅凭对话历史推断。

**步骤**

1. **若未提供变更名，提示选择**

   运行 `seedpacespec list --json` 获取可用变更。使用 **AskQuestion 工具**让用户选择。

   只展示**进行中**的变更（尚未归档）。
   若可获取，列出每个变更使用的 schema。

   **重要**：不要猜测或自动选定变更。始终由用户选择。

2. **检查产物完成状态（`seedpacespec status`）**

   运行 `seedpacespec status --change "<name>" --json`。

   解析 JSON：`schema`（工作流名）、`artifacts` 里每个产物的 `status`。

   **`done` 是什么意思（与 PRD、R 编号、changelog 无关）**  
   CLI **只看变更目录里的磁盘事实**：对应产物在 schema 里配置的 `file` 或 `directory` 是否存在且**非空**。没有单独的「数据库」或「把 R 标成 done」——**不能靠改 YAML 假装完成**。实现见引擎：`文件 size > 0` 才算非空；**目录**须至少包含一个子项。

   **默认 `spec-driven` 时**（定义见仓库 `schemas/spec-driven/schema.yaml`，若项目使用自定义 schema 则以其中的 `artifacts` 为准）：
   | 产物 | 何时为 `done` |
   |------|----------------|
   | `proposal` | `proposal.md` 存在且非空（**0 字节不算**） |
   | `specs` | `specs/` 目录存在且**非空**（至少一个文件） |
   | `design` | `design.md` 存在且非空 |
   | `tasks` | `tasks.md` 存在且非空；且依赖链上 `specs`、`design` 已先满足 |

   **其它状态**：`ready` = 依赖产物已 `done`，本产物文件还未建；`blocked` = 上游未齐。

   **如何把产物变成 `done`**：在 `active-change/<name>/` 下创建/补全上述路径，并写入实质内容（例如给空的 `proposal.md` 写几行、在 `specs/` 里放一个 PRD `.md`）。

   **若有产物不是 `done`：**
   - 展示警告，列出未完成产物及原因（可对照上表提示用户补文件）
   - 使用 **AskQuestion** 确认是否仍要继续归档（确认则继续；若用户选择去补产物则中断归档流程）

3. **检查任务完成状态**

   读取任务文件（通常为 `tasks.md`）检查未完成任务。

   统计 `- [ ]`（未完成）与 `- [x]`（已完成）数量。

   **若存在未完成任务：**
   - 展示警告，给出未完成数量
   - 使用 **AskQuestion 工具**确认是否仍要继续
   - 用户确认后继续

   **若无 tasks 文件：** 不进行与任务相关的警告，直接继续。

4. **写入 `seedpacespec/global-specs/changelog.md`（唯一 changelog 落点）**

   **目的**：在仓库里留下「每次归档」对应的能力与交付记录 + **应用迭代时间线**，便于后续判断需求是否在已知模块上迭代（可与 `architecture.md`、历史归档对照）。

   **禁止**：**不要**在项目根目录创建或追加 `CHANGELOG.md`；所有归档纪要只写入本文件。

   **路径**：`seedpacespec/global-specs/changelog.md`（固定文件名）。若目录或文件不存在 → **创建**后再写入；新建文件可在首行使用标题 `# 应用迭代与归档纪要`（若已有内容则不改原有标题）。

   **信息来源**（写作时**内化吸收**，不要照搬编号或小标题）：
   - `proposal.md`、`specs/`（PRD）、必要时扫一眼 `design.md` / `tasks.md` / `defect-report.md`
   - 写成**简短自然语言**，便于日后用你的 PRD、全局业务上下文和本文件做**语义对照**（是否同类迭代、是否曾交付过类似能力），**不必**逐条列 R-xx，**不必**单独开「模块 / 域」小节——模块或边界若在叙述里一两句能说清楚即可。

   **条目模板**（尽量短；新条目插在文件**最上方**，最新在上）：
   ```markdown
   ## [YYYY-MM-DD] <简短标题> (`<change-name>`)

   **归档：** `seedpacespec/changes/archive/YYYY-MM-DD-<change-name>/`

   {2～5 句话：本次迭代交付了什么、对用户或业务可见的变化是什么；语义上要能被后来的你自己对照 PRD / 全局 spec「对上号」，不写细则清单}

   <!-- 可选一行 -->
   *交付线索：* 任务 x/y；缺陷检测 {简述或「未跑」}。
   ```

   **交互**：生成草稿后 **AskQuestion** 请用户确认或微调；确认后写入。若用户明确「本次跳过写入」，须在步骤 6 摘要中注明 **未写入 global-specs/changelog.md（用户跳过）**。

   **与插件**：若 `plugins.override.archive` 已替换本 skill，或插槽中已覆盖纪要逻辑，以插件为准。

<!-- slot:after_changelog_generated -->

<!-- slot:before_archive_move -->

5. **执行归档**

   若不存在则创建归档目录：
   ```bash
   mkdir -p seedpacespec/changes/archive
   ```

   用当前日期生成目标名：`YYYY-MM-DD-<change-name>`

   **检查目标是否已存在：**
   - 若已存在：报错失败，建议重命名已有归档或换日期
   - 若不存在：将变更目录移入归档

   ```bash
   mv seedpacespec/changes/active-change/<name> seedpacespec/changes/archive/YYYY-MM-DD-<name>
   ```

6. **展示摘要**

   展示归档完成摘要，包括：
   - 变更名
   - 使用的 schema
   - 归档位置
   - `seedpacespec/global-specs/changelog.md` 是否已写入（或用户跳过）
   - 若有警告，注明（未完成产物/任务等）

**成功时输出**

```
## 归档完成

**变更：** <change-name>
**Schema：** <schema-name>
**归档至：** seedpacespec/changes/archive/YYYY-MM-DD-<name>/
**归档纪要：** ✓ 已写入 `seedpacespec/global-specs/changelog.md`（或「用户跳过」；根目录不写 CHANGELOG）

所有产物已完成。所有任务已完成。
```

**Guardrails**
- 未提供变更名时，**必须** `list --json` + AskQuestion 选择，禁止凭对话推断
- 用产物依赖图（seedpacespec status --json）检查完成度
- 警告不阻止归档——仅告知并请用户确认
- 移动到归档时保留 `.seedpacespec.yaml`（随目录一起移动）
- 清晰说明发生了什么
- 每次归档须执行步骤 4（除非 override）——仅更新 `seedpacespec/global-specs/changelog.md`，**不**维护项目根 `CHANGELOG.md`；用户显式跳过则记录在摘要中
- 若配置了 `before_archive_move` 等归档插槽，按 Plugin Protocol 与插槽执行顺序处理
