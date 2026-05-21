# 插件指南

本文档说明如何通过 `seedpacespec/config.yaml` 的 `plugins` 配置来定制 skill 行为。

---

## 两种定制方式

| 方式 | 适用场景 | 影响范围 |
|------|---------|---------|
| **override（整体替换）** | 用自己的 skill 完全替换内置 skill | 替换整个流程 |
| **slot（插槽挂载）** | 在内置流程的关键节点插入额外逻辑或替换局部内容 | 仅影响挂载点 |

---

## Override（整体替换）

### 配置方式

```yaml
plugins:
  override:
    trd-generator: .cursor/skills/my-backend-trd/SKILL.md
    propose: .cursor/skills/my-propose/SKILL.md
```

### 可替换的 skill 列表

| skill 短名 | 对应内置 skill | 职责 |
|------------|---------------|------|
| `propose` | seedpacespec-propose | 从需求生成 proposal/design/TRD/tasks |
| `trd-generator` | seedpacespec-trd-generator | 基于 PRD 生成 TRD |
| `apply` | seedpacespec-apply-change | 按 tasks 写代码实现 |
| `update-task` | seedpacespec-update-task | 修改已有设计产物 |
| `test-plan` | seedpacespec-test-plan | 生成单元测试 |
| `defect-detect` | seedpacespec-defect-detect | 检测业务逻辑缺陷 |
| `archive` | seedpacespec-archive-change | 归档已完成变更 |
| `figma-to-style` | seedpacespec-figma-to-style | 从 Figma 提取样式 |

### 编写替换 skill 的注意事项

1. **产物兼容**：替换 skill 的产出文件应放在同样的目录结构下（如 TRD 放 `trds/`、design 放变更根目录），否则下游 skill 找不到文件。

2. **语义段建议**：下游 skill 会按语义名称定位 TRD 中的章节（如"方案设计"、"风险与约束"、"需求覆盖"等）。若你的 TRD 格式中包含这些语义段，下游可自动消费；若不包含，下游会跳过（不会阻塞）。

3. **交互设计**：内置 skill 使用 State Machine Gates + AskQuestion 实现用户确认。替换时建议保留关键确认点（如 TRD 确认循环、任务完成确认），避免流程失控。

4. **参考原始 skill**：替换前请阅读对应的 `.cursor/skills/seedpacespec-*/SKILL.md`，了解完整流程和约定。

---

## Slot（插槽挂载）

### 配置方式

```yaml
plugins:
  slots:
    - skill: propose
      slot: after_trd_confirmed
      run: .cursor/skills/sop-generator/SKILL.md
      description: "TRD 确认后生成 SOP 文档"
```

### 插槽类型

| 类型 | 标记方式 | 行为 |
|------|---------|------|
| **hook** | `<!-- slot:名字 -->` | 纯扩展点，默认不执行任何内容；挂载后在此处执行外部 skill |
| **content** | `<!-- slot:名字 -->...默认内容...<!-- /slot:名字 -->` | 有默认内容；挂载后用外部文件替换该段内容 |

### 全部插槽参考

#### propose（提议变更）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_prd_resolved` | hook | PRD 就绪后 | 可用于 PRD 校验、额外文档生成 |
| `after_design_confirmed` | hook | design 文件树确认后，TRD 生成前 | 可用于额外评审、架构图生成 |
| `after_trd_confirmed` | hook | TRD 确认后，生成 tasks 前 | 可用于 SOP 生成、TRD 后处理 |
| `after_tasks_created` | hook | tasks 生成后 | 可用于任务后处理、通知 |

#### trd-generator（生成 TRD）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `trd_output_format` | content | TRD 生成时 | 替换默认的 TRD 输出模板/格式 |
| `after_trd_generated` | hook | TRD 保存后 | 可用于 TRD 后处理、触发下游 |

#### apply（写代码实现）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_context_digested` | hook | 上下文加载完成后 | 可用于额外上下文注入 |
| `before_each_task` | hook | 每条任务实现前 | 可用于预检、拉取最新代码 |
| `ui_render` | content | UI 类任务实现时 | 替换默认 UI 还原规范 |
| `task_completion_check` | content | 任务完成检查时 | 替换默认完成检查逻辑 |
| `after_all_tasks_done` | hook | 全部任务完成后 | 可用于自定义后置检查 |

#### test-plan（生成测试）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_targets_identified` | hook | 测试目标识别后 | 可用于调整测试范围 |
| `test_generation_strategy` | content | 测试生成时 | 替换默认测试生成策略 |
| `after_tests_executed` | hook | 测试执行后 | 可用于上报覆盖率 |

#### defect-detect（缺陷检测）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_changes_traced` | hook | 变更追踪完成后 | 可用于额外上下文补充 |
| `defect_checks` | content | 缺陷校验时 | 替换默认校验项（如嵌入式专用校验） |
| `after_defects_reported` | hook | 缺陷报告生成后 | 可用于通知、工单创建 |

#### archive（归档变更）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_changelog_generated` | hook | changelog 生成后 | 可用于格式转换、通知 |
| `before_archive_move` | hook | 归档移动前 | 可用于最终校验 |

#### figma-to-style（提取样式）

| 插槽名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `after_style_extracted` | hook | 样式 JSON 提取后 | 可用于格式转换、注入设计 token |

---

## 完整配置示例

```yaml
schema: spec-driven

plugins:
  # 用自定义 TRD 生成器替换默认版本
  override:
    trd-generator: .cursor/skills/my-backend-trd/SKILL.md

  # 在关键节点挂载扩展
  slots:
    # propose 流程：TRD 确认后自动生成 SOP
    - skill: propose
      slot: after_trd_confirmed
      run: .cursor/skills/sop-generator/SKILL.md
      description: "TRD 确认后生成 SOP 文档"

    # apply 流程：每条任务前拉最新代码
    - skill: apply
      slot: before_each_task
      run: .cursor/skills/pre-task-sync/SKILL.md
      description: "实现前拉取最新代码并检查冲突"

    # trd-generator：替换输出格式为后端风格
    - skill: trd-generator
      slot: trd_output_format
      run: .cursor/skills/backend-trd-format/template.md
      description: "后端 TRD 输出格式"

    # defect-detect：嵌入式专用校验项
    - skill: defect-detect
      slot: defect_checks
      run: .cursor/skills/embedded-checks/checks.md
      description: "嵌入式专用校验（中断安全、硬件交互等）"

    # test-plan：测试执行后上报覆盖率
    - skill: test-plan
      slot: after_tests_executed
      run: .cursor/skills/coverage-report/SKILL.md
      description: "测试执行后自动上报覆盖率到 CI"
```

---

## 编写插槽 skill 的约定

### hook slot

hook skill 是一个标准的 SKILL.md 文件，接收当前流程上下文（变更目录、已有产物），执行完毕后控制权回到主流程。

```markdown
---
name: my-hook-skill
description: 简述
---

# My Hook Skill

## Goal
{做什么}

## Workflow
{具体步骤}
```

### content slot

content slot 的 `run` 文件是纯内容文件（不需要 frontmatter），其内容会直接替换原 slot 包裹的默认内容。

例如替换 `trd_output_format`，`run` 文件就是你自定义的 TRD 骨架模板。

---

## 不配置 plugins 时

所有 skill 按默认行为执行，零影响。`plugins` 字段是完全可选的。

---

## 高级定制：trd-generator

trd-generator 是定制需求最多的 skill（不同技术栈、不同团队对 TRD 格式和深度要求差异大）。除了通用的 override 和 slot，它还支持以下细粒度定制：

### 定制层级总览

| 定制粒度 | 配置方式 | 影响范围 | 适用场景 |
|----------|---------|---------|---------|
| 替换整个 skill | `plugins.override.trd-generator` | 整个生成流程 | 完全自定义 TRD 流程 |
| 替换输出模板 | `plugins.trd.template` | TRD 骨架结构 | 保留流程，换输出格式 |
| 替换/新增技术栈 references | `plugins.trd.references_dir` | 条件加载的参考文件 | 自定义写作指南 |
| 替换条件加载表 | `plugins.trd.loaders` | 哪些 reference 被加载 | 自定义加载条件 |
| 新增技术栈 | `plugins.trd.extra_stacks` | 技术栈检测 + references | 内置栈不覆盖你的技术 |
| 替换黄金样本 | `plugins.trd.example` | 质量锚点 | 团队有自己的标杆 TRD |

### 配置方式

```yaml
plugins:
  trd:
    # 替换 TRD 输出模板（等价于 slot trd_output_format，但更简洁）
    template: seedpacespec/templates/my-trd-skeleton.md

    # 用自定义 references 目录替换内置目录
    # 优先级：此目录 > 内置 .cursor/skills/seedpacespec-trd-generator/references/
    references_dir: seedpacespec/trd-references/

    # 只替换条件加载表（不替换整个 references 目录）
    loaders: seedpacespec/trd-references/my-loaders.yaml

    # 新增技术栈（不覆盖内置的 frontend/backend/embedded）
    extra_stacks:
      - id: game
        label: 游戏引擎
        references_dir: seedpacespec/trd-references/game/
        detect:
          - file_exists: ["ProjectSettings/ProjectVersion.txt"]  # Unity
          - file_exists: ["project.godot"]                       # Godot
        architecture_md_hints:
          keywords: [Unity, Godot, Unreal, Cocos]
          categories: [游戏引擎, ECS, 渲染]
          directory_signals: [Assets/Scripts/, Systems/, Components/]
        # 是否需要角色消岐（默认 false）
        requires_role_disambiguation: true
        role_disambiguation:
          options:
            - id: game_client
              label: 游戏客户端（渲染、输入、UI）
              loads: game/
            - id: game_server
              label: 游戏服务器（同步、房间、匹配）
              loads: game-server/
              tag: server

    # 替换黄金样本
    example: seedpacespec/trd-references/our-golden-trd.md
```

### extra_stacks 完整字段说明

每个 `extra_stacks` 条目与内置 `loaders.yaml` 的 `tech_stacks` 条目格式**完全一致**，外加 `references_dir` 和可选的 `role_disambiguation`：

```yaml
extra_stacks:
  - id: string                          # 技术栈唯一标识（与内置同名则覆盖）
    label: string                       # 人类可读名称
    references_dir: string              # 该栈的 loaders.yaml 所在目录（相对项目根）

    # ── 检测规则（与内置 tech_stacks 格式一致）──
    detect:                             # 文件探测规则列表
      - file_exists: [string]           # 文件存在性检查
        contents_match: string          # 可选：文件内容正则匹配
    architecture_md_hints:              # architecture.md 关键词匹配
      keywords: [string]                # 具体技术名/框架名（如 Unity, React, Spring）
                                        # 匹配 architecture.md 正文中出现的技术名称
      categories: [string]              # 可选：技术类别词（如 游戏引擎, UI 框架, ORM）
                                        # 匹配 architecture.md 表格/标题中的分类标签
      directory_signals: [string]       # 可选：特征目录（如 Assets/Scripts/, Systems/）
                                        # 匹配项目中实际存在的目录结构
    # 三者为并集关系：任一类命中都算该栈的信号。keywords 最关键，categories 和 directory_signals 是辅助佐证，可不填。

    # ── 角色消岐（可选，默认不消岐）──
    requires_role_disambiguation: bool  # 默认 false
    role_disambiguation:                # 仅 requires_role_disambiguation: true 时生效
      options:
        - id: string                    # 角色标识
          label: string                 # AskQuestion 展示的选项文本
          loads: string                 # 命中后加载哪个 references 子目录
          tag: string                   # 可选：写入 role.yaml 的 tag
```

**与全局 loaders.yaml 的对应关系**：

| 全局 loaders.yaml 字段 | extra_stacks 对应字段 | 说明 |
|------------------------|----------------------|------|
| `tech_stacks.<id>.label` | `label` | 直接对应 |
| `tech_stacks.<id>.detect` | `detect` | 格式一致 |
| `tech_stacks.<id>.architecture_md_hints` | `architecture_md_hints` | 格式一致 |
| `tech_stacks.<id>.requires_role_disambiguation` | `requires_role_disambiguation` | 直接对应 |
| `tech_stacks.<id>.references_dir` | `references_dir` | 内置的是相对 references/ 的子目录名，extra_stacks 是相对项目根的路径 |
| `role_disambiguation.<id>.options` | `role_disambiguation.options` | 直接对应，自动注入全局消岐表 |
| `multi_stack_fallback.options` | — | 自动追加（id + label + loads） |

**自动行为**：配置 `extra_stacks` 后，TRD skill 会自动：
1. 将条目追加到 `tech_stacks` 检测列表末尾
2. 若 `requires_role_disambiguation: true` → 将 `role_disambiguation.options` 注入全局消岐表
3. 将 `{id, label, loads}` 追加到 `multi_stack_fallback.options`（多栈命中时的备选列表）

无需手动编辑全局 loaders.yaml。

### references 目录结构

自定义 references 目录需遵循以下结构：

```
seedpacespec/trd-references/
├── loaders.yaml              # 顶层路由（技术栈检测规则等）
├── frontend/                 # 前端技术栈
│   ├── loaders.yaml          # 条件加载表（mandatory + conditions）
│   ├── ui-component-guide.md # 写作指南（被条件加载）
│   └── advanced-scenarios.md # 高级场景指南
├── backend/                  # 后端技术栈
│   └── loaders.yaml
├── game/                     # 自定义技术栈
│   ├── loaders.yaml
│   └── ecs-guide.md          # ECS 架构写作指南
└── examples/
    └── high-quality-trd.md   # 黄金样本
```

### 编写自定义 loaders.yaml

条件加载表控制"什么情况下读哪些参考文件"。格式：

```yaml
# mandatory: 无论如何都读的文件
mandatory:
  - file: ../../examples/high-quality-trd.md
    label: 黄金样本
    reason: 质量锚点

# depth_dimensions: Full 级别可选展开维度（Q-depth 评估时供用户勾选）
depth_dimensions:
  - id: my_dimension
    label: 我的维度
    applicable_when: 满足什么条件时建议勾选

# conditions: 条件加载项
conditions:
  - id: L1
    label: 人类可读的条件描述
    file: my-guide.md           # 命中时读取的文件（相对本 yaml 所在目录）
    quick_check: |              # AI 如何判定是否命中（自然语言）
      判定逻辑描述...
    purpose: 这个文件提供什么写作指导

# fallback_note: 全部条件不命中时的兜底说明
fallback_note: |
  全未命中 = 简单变更，只需黄金样本对齐质量。
```

### 编写自定义写作指南（reference guide）

写作指南是条件加载命中后读入的参考文件，告诉 AI 如何写 TRD 的某个层/某类场景。编写建议：

1. **聚焦一个关注点**：一个文件解决一类问题（如 UI 层怎么写、API 层怎么写、多模板怎么组织）
2. **给出结构模板**：用 `###` 标题展示期望的输出结构
3. **给出正反例**：用表格对比"应该"和"不应该"的写法
4. **声明必须输出的块**：用编号清单列出该指南要求输出的内容块
5. **不要重复 SKILL.md 的规则**：指南只补充栈特定的写法要求

### 加载优先级

```
plugins.trd.references_dir（若配置）
  ↓ 不存在时 fallback
.cursor/skills/seedpacespec-trd-generator/references/（内置）
```

对于 `extra_stacks`：追加到内置技术栈列表末尾，检测时按配置顺序匹配。若 id 与内置栈重名，以用户配置为准（覆盖内置）。

---

### 端到端示例：为 Unity 游戏项目定制 TRD 生成

**场景**：团队用 Unity 开发游戏，内置的 frontend/backend/embedded 都不匹配。希望：
- TRD 按 ECS 架构组织（System/Component/Entity 层）
- 条件加载中增加"涉及物理系统？"的判定
- 黄金样本换成团队之前写得好的一份 TRD

**Step 1：创建目录结构**

```
seedpacespec/trd-references/
├── game/
│   ├── loaders.yaml          # 条件加载表
│   ├── ecs-guide.md          # ECS 架构写作指南
│   └── physics-guide.md      # 物理系统写作指南
└── examples/
    └── high-quality-trd.md   # 团队黄金样本
```

**Step 2：编写 `game/loaders.yaml`**

```yaml
mandatory:
  - file: ../examples/high-quality-trd.md
    label: 团队黄金样本
    reason: 写作深度和 ECS 组织方式的标杆

depth_dimensions:
  - id: system_design
    label: System 设计
    applicable_when: 新增或重构 System
  - id: component_schema
    label: Component 数据结构
    applicable_when: 新增或修改 Component 定义
  - id: entity_lifecycle
    label: Entity 生命周期
    applicable_when: 涉及 Entity 创建/销毁/池化

conditions:
  - id: G1
    label: 涉及 ECS 架构？
    file: ecs-guide.md
    quick_check: |
      改动文件是否属于 Systems/、Components/、Entities/ 目录？
      有 → 命中。
    purpose: 提供 System/Component/Entity 各层的 TRD 写法

  - id: G2
    label: 涉及物理系统？
    file: physics-guide.md
    quick_check: |
      改动是否涉及 Rigidbody、Collider、PhysicsSystem 相关文件？
      有 → 命中。
    purpose: 物理系统的时序约束、FixedUpdate 编排写法

fallback_note: |
  全未命中 = 简单脚本变更，只需黄金样本对齐质量。
```

**Step 3：编写 `game/ecs-guide.md`**（节选）

```markdown
# ECS 架构 TRD 写作指南

## 方案章节组织方式

按 ECS 三层展开 TRD 方案章节：

### 4.x Component 层
- 列出所有新增/修改的 Component struct
- 每个 Component 给出字段定义（真实 C# 语法）+ 语义说明
- 标注哪些 Component 是共享的（ISharedComponentData）

### 4.x System 层
- 每个 System 的职责、执行阶段（Update/FixedUpdate/LateUpdate）
- 输入 Component 查询（EntityQuery）
- 关键逻辑伪代码 + 设计解读
- System 间执行顺序依赖（[UpdateBefore]/[UpdateAfter]）

### 4.x Entity 层
- Entity Archetype 定义
- 生命周期管理（何时创建、何时回池、何时销毁）
- Prefab → Entity 的转换策略
```

**Step 4：配置 `config.yaml`**

```yaml
plugins:
  trd:
    extra_stacks:
      - id: game
        label: 游戏引擎 (Unity ECS)
        references_dir: seedpacespec/trd-references/game/
        detect:
          - file_exists: ["ProjectSettings/ProjectVersion.txt"]
          - file_exists: ["Assets/Scripts/Systems/"]
        architecture_md_hints:
          keywords: [Unity, ECS, DOTS, Burst, Jobs]
    example: seedpacespec/trd-references/examples/high-quality-trd.md
```

**效果**：
1. TRD skill 检测到项目是 Unity → 自动选用 `game/loaders.yaml`
2. 分析改动涉及 Systems/ 目录 → 命中 G1 → 读入 `ecs-guide.md` 作为写作参考
3. AI 按 ECS 三层（Component/System/Entity）组织 TRD 方案章节
4. 质量对标团队自己的黄金样本，而非内置的前端样本

---

## 高级定制：propose

propose 的 design.md 模板也支持替换：

```yaml
plugins:
  propose:
    # 替换 design 模板
    design_template: seedpacespec/templates/my-design-template.md
    # 替换 design-lite 模板（简单变更用）
    design_template_lite: seedpacespec/templates/my-design-lite.md
```

替换模板时建议保留"如何阅读本文档"表头和章节用途说明，以便 TRD 生成器正确消费。

---

## 高级定制：apply

apply 的任务完成检查逻辑可通过 content slot 替换，也可以通过配置调整行为：

```yaml
plugins:
  apply:
    # 自定义 lint/test 命令（apply 完成任务后自动运行）
    post_task_commands:
      - npm run lint -- --fix
      - npm run test -- --related
    # 关闭逐任务确认（适合信任度高的团队）
    auto_confirm_tasks: false
```
