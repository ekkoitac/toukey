---
name: doc-drift-awareness
description: >
  被动文档漂移检测规范——AI 修改源码文件后自动检查是否与活跃变更的 TRD/design 对齐。
  TRIGGER when: AI 在本轮对话中实际修改或创建了项目源码文件（.ts/.tsx/.js/.vue/.dart/.go/.py/.java/.kt/.swift 等），
  且 seedpacespec/config.yaml 中 driftDetection.enabled 为 true，
  且当前修改不是由 sdx skill（如 sdx-apply）驱动的。
  SKIP: driftDetection.enabled 不为 true（包括字段不存在、文件不存在）；
  修改由 sdx skill 驱动（sdx skill 内部已有偏离检测）；
  修改的仅是测试/配置/seedpacespec/.cursor/.claude 等非项目源码文件。
  手动漂移检测请使用 /sdx-drift-check（独立 SKILL.md）。
type: global-rule
compatibility: Claude Code (CLAUDE.md) / Cursor (.cursor/rules/) / 任何读取项目规则文件的 AI 工具
---

# 被动文档漂移检测

本规范仅服务**被动模式**：AI 修改源码文件后，自动检测是否与活跃变更文档对齐。

手动漂移检测（指定 Git 范围）→ 使用 `/sdx-drift-check`，流程见其 SKILL.md。

> **前置条件**：入口逻辑（`CLAUDE.md` / `.claude/rules/doc-drift-awareness.md`）已完成以下判断后才会进入本规范：
> 1. `driftDetection.enabled` 为 `true`
> 2. 非 sdx skill 驱动的修改
>
> 进入本规范时，上述条件已满足，无需重复判断。

## 跳过条件

满足任一则不检测，直接跳过：

- 修改的仅是测试文件（`test/`、`__tests__/`、`*_test.*`、`*.spec.*`）
- 修改的仅是配置文件（`package.json`、`tsconfig.json`、`.eslintrc` 等）
- 修改的仅是 `seedpacespec/`、`.cursor/`、`.claude/` 目录内的文件
- 修改的仅是 `.md`、`.json` 等非源码文件

## 前置设计上下文展示（改代码前）

当用户以自然语言追问要求修改源码文件时（非 sdx-apply 驱动），**在动手修改代码之前**，先执行以下步骤展示关联的设计上下文：

### 触发条件

- 用户消息意图是修改/修复项目源码（非测试/配置/文档）
- `driftDetection.enabled` 为 `true`
- 非 sdx skill 驱动
- `seedpacespec/changes/active-change/` 下有活跃变更

### 展示流程

1. **定位目标文件**：从用户描述中推断即将修改的文件路径
2. **路径匹配**：按 Step 2a 的路径匹配规则，在聚焦变更的 `design.md` 文件树和 `trds/*.md` 中查找该文件
3. **命中时展示**：输出对应的 TRD/design 段落位置（文件名 + 章节标题 + 行号），格式如下：

```
📋 设计上下文

本次要修改的文件在活跃变更「{变更名}」中有对应设计：

  - {文件路径}
    └─ TRD: trds/{trd文件}.md → §{章节标题}（第 {N} 行）
    └─ Design: design.md → {所属模块节}（第 {N} 行）

你可以先查看设计意图再决定如何修改。
```

4. **未命中**：不展示，直接修改
5. **展示后不阻塞**：展示完毕即开始修改，不需等待用户确认（仅供参考）

> 此步骤的目的是让用户看到"原始方案写的什么"，帮助判断是方案理解错了还是代码实现错了。

---

## 检测流程（改代码后）

AI 完成代码修改后（写入文件后、回复用户前），执行以下步骤：

### Step 1：确定聚焦变更

扫描 `seedpacespec/changes/active-change/` 目录。

- 目录不存在或为空 → 跳到 Step 3（仅检查 architecture.md）
- 有变更 → 按下方多变更策略确定聚焦变更

### Step 2：检测变更范围命中 + 漂移诊断

#### 2a. 路径匹配

对聚焦变更（以及命中的其他变更），读取以下文件（若存在）：

- `design.md` 中「模块与文件结构（树状图）」章节 → 提取文件路径列表
- `trds/*.md` 中引用的源码文件路径

将本次修改的文件与上述路径匹配。匹配规则：

- 精确路径匹配（文件路径完全一致）
- 目录前缀匹配（修改的文件在 TRD/design 声明的目录下）
- 模块名匹配（修改的文件属于 TRD/design 中声明的模块目录）

#### 2b. 漂移诊断（仅对命中文件执行）

对每个命中的文件，做轻量对比，判断漂移类型和原因：

| 检查项 | 方法 | 漂移类型 |
|--------|------|----------|
| **接口签名变更** | 对比本次修改：是否新增/删除/重命名了 export 的函数、类、类型、组件的名称或参数 | `接口不一致` |
| **文件新增/删除** | 本次新建或删除了 TRD/design 文件树中声明的文件 | `文件结构不一致` |
| **数据模型变更** | 本次修改了 TRD 中声明的数据结构（interface/type/schema）的字段 | `数据模型不一致` |
| **组件结构变更** | 新增/删除/重命名了 TRD 中声明的组件、路由、API 端点 | `组件结构不一致` |
| **实现流程变更** | TRD 中有该函数/模块的实现步骤、伪代码或算法描述，本次修改改变了控制流、核心算法、调用顺序或关键分支逻辑，导致与 TRD 描述不符 | `实现流程不一致` |
| **仅内部细节** | 以上均未命中，修改不影响接口、数据模型、组件结构，也不改变 TRD 描述的实现流程（如变量重命名、性能微调、日志调整等） | 无漂移，不提醒 |

检查范围限于本次修改的 diff，不做全文件语义分析。

命中 → 记录：`{变更名, 命中文件, 对应 TRD/design 章节, 漂移类型, 具体原因}`

**仅内部细节变更** → 不产生该文件的漂移提醒

### Step 3：检测 architecture.md 公共模块命中

若项目根目录存在 `architecture.md`，读取：

- §9.2 耦合热点（含公共模块被引用 TOP 10、跨域依赖清单）

将本次修改的文件与上述清单匹配。

命中 → 记录：`{文件名, 角色（公共模块/耦合热点）, 被引用次数}`

### Step 4：输出提醒

**未命中任何** → 不输出提醒，正常回复。

**仅命中一个活跃变更** → 回复末尾追加（不阻塞）：

```
---
⚠️ 文档漂移提醒

本次修改导致以下文件与活跃变更「{变更名}」的文档不一致：

  - {文件路径}（{漂移类型}）
    TRD §{章节号} 记录：{TRD 中的描述摘要}
    实际变更：{本次修改的具体内容，如"新增参数 options: Options"、"删除了 formatDate 导出"}

建议执行 /sdx-update-task {变更名} 同步文档

（关闭此提醒：在 seedpacespec/config.yaml 中设置 driftDetection.enabled: false）
```

**命中多个活跃变更** → 列出选项等待用户确认：

```
---
⚠️ 文档漂移提醒

本次修改的文件与多个活跃变更的文档不一致：

  A) {变更名1}（最近活跃：X 天前）
     - {文件}（{漂移类型}）：{具体原因}

  B) {变更名2}（最近活跃：X 天前）
     - {文件}（{漂移类型}）：{具体原因}

  C) 暂不更新文档

请选择要同步更新哪个变更的文档？（选择后将引导 /sdx-update-task）

（关闭此提醒：在 seedpacespec/config.yaml 中设置 driftDetection.enabled: false）
```

**命中 architecture.md 公共模块**（可与上述叠加） → 追加：

```
⚠️ 公共模块变更提醒

本次修改了以下公共模块（被多处业务依赖）：
  - {文件路径}（被 {N} 处引用，见 architecture.md §9.2）

公共模块变更可能影响多个业务域：
  - 建议检查引用方是否需要适配
  - 若变更了对外接口 → architecture.md 可能需要增量更新（/sdx-analyzer-project 增量模式）
```

## 多变更策略

`active-change/` 下可能有多个未归档的变更。确定聚焦变更的优先级：

1. **config.yaml 显式指定**：`driftDetection.activeChange` 配置了变更名 → 仅用该变更
2. **按时效性自动选择**：未配置 → 读取每个变更目录下产物的最后修改时间，选最近修改的变更

```bash
stat -f "%m" seedpacespec/changes/active-change/<name>/trds/*.md design.md tasks.md 2>/dev/null | sort -rn | head -1
```

## 检测成本控制

- Step 2a 只读文件树和章节标题，不全文分析 TRD/design
- Step 2b 只检查本次 diff 中的 export/类型/组件变更，不做全文件语义分析
- Step 2a 读 design.md 仅需读「树状图」章节（通常 < 50 行）
- Step 2b 对命中文件读 TRD 对应章节的接口描述（通常 < 20 行/文件）
- Step 3 读 architecture.md 仅需读 §9.2 表格（通常 < 30 行）
- 整个检测流程不产生额外文件写入
- 多变更场景下，优先只读聚焦变更；仅当路径匹配时才读其他变更
