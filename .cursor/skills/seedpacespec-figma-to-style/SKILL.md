---
name: seedpacespec-figma-to-style
id: seedpacespec-figma-to-style
category: Workflow
description: >
  从 Figma .fig 文件提取样式上下文 JSON（颜色、字号、间距、布局等精确视觉参数），用于 UI 还原。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"提取样式"、"提取 Figma 样式"、"我要精确还原UI"、需要从 .fig 获取视觉参数。
  SKIP: 用户想从 .fig 生成需求文档（用 sdx-figma-prd）；用户已有 style-context 想实现 UI（用 sdx-apply 或 render-ui）。
  requires: 本地 .fig 文件。
  output: figma_data/json_data/style-context.dedup.json（视觉属性 + 布局参数）。
  examples: "从这个 fig 文件提取样式参数" → 触发；"这个按钮颜色不对" → 不触发。
---

# seedpacespec-figma-to-style

从 Figma `.fig` 文件提取**样式上下文**——精确的颜色、字号、间距、布局方向等视觉参数。

**定位**：这是一份**设计视觉快照**，不是业务文档。截图告诉 AI "长什么样"，style-context.dedup.json 告诉 AI "精确值是多少"——用于 apply 阶段写具体 UI 组件时还原样式。

## 与 figma-to-prd 的关系

| | figma-to-prd | figma-to-style（本 skill） |
|--|---|---|
| **输入** | .fig + 截图 | .fig（截图可选辅助理解） |
| **输出** | PRD Markdown（业务需求文档） | `figma_data/json_data/style-context.dedup.json`（视觉样式数据） |
| **保留** | texts、functionalDescription、连线关系 | 视觉属性、布局参数、界面文字样式 |
| **丢弃** | 样式/布局数据 | functionalDescription（功能说明文字） |
| **下游** | TRD → tasks → apply | apply 实现 UI 任务时经 AskQuestion 确认后参考 |

两者复用同一套逆向脚本（parser + tree-builder），只是提取维度不同。可独立执行，也可在 `figma-to-prd` 之后执行。

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.figma-to-style` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `after_style_extracted` | 样式 JSON 生成后（Step 4 之后） | hook | 可用于样式后处理、设计令牌生成 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配的 `skill: figma-to-style` + `slot: 名字` 条目 → 有则加载 `run` 指定的文件执行，完毕后回到主流程继续 → 无则跳过。

若无 `plugins` 配置 → 正常执行，无任何变化。

---

## State Machine Gates

执行前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得开始提取样式。**

| # | 状态 | 完成条件 | 未完成时行为 |
|---|------|---------|-------------|
| G1 | `inputs_collected` | .fig 文件路径已确定；变更名已确定或标记可选 | AskQuestion 收集缺失项 |
| G2 | `fig_parsed` | .fig 已解析，页面/版本列表已获取 | 执行解析 |
| G3 | `version_section_submodule_selected` | 用户选定版本和 section，并明确子模块选择（指定或不指定） | AskQuestion 让用户选择 |
| G4 | `style_extracted` | 样式上下文已提取并保存 | 执行提取 |

**状态推进单向** G1→G2→G3→G4，不得跳跃。


**🚫 禁止编造跳过理由**：AI 不得以任何自创名义（如恢复协议、追加模式、精简流程、复用已有产物、简化模式等）跳过门禁。所有门禁必须逐一通过并产出可验证输出。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。
---

## Step 1. 收集输入（→ G1）

检测用户是否已提供以下信息，**缺失时用 AskQuestion 一次性询问**：

| 信息项 | 说明 | 必需性 |
|--------|------|--------|
| **.fig 文件路径** | Figma 设计文件 | ✅ 必需 |
| **变更名** | seedpacespec 变更目录名（用于确定输出路径） | 🔶 可选——若用户未提供，**必须 AskQuestion**：「输出保存到哪里？」选项：A）关联变更（列出 active 变更供选）；B）保存到当前工作目录。禁止自行推断落点 |
| **子模块意图** | 是否只提取某个子模块（可在 Step 3 再精确选择） | 🔶 可选 |
| **截图路径** | 开发者手动提供的截图文件或目录（仅作为后续 apply 参考） | 🔶 可选 |

---

## Step 2. 解析 .fig（→ G2）

复用 `seedpacespec-figma-to-prd` 的逆向脚本：

```typescript
import { parseFigFile, listPageVersions } from '.cursor/skills/seedpacespec-figma-to-prd/scripts/index'

const buf = fs.readFileSync(figPath)
const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const versions = listPageVersions(buffer)
```

解析后获得页面/版本列表。

---

## Step 3. 选择版本、Section 和子模块（→ G3）

### 3.1 选择版本

用 **AskQuestion** 展示所有可用版本/页面供用户选择：

```
检测到以下版本/页面：
  A) v1.0.7 - 主版本
  B) v1.0.6 - 旧版本
  C) ...
请选择要提取样式的版本：
```

### 3.2 选择 Section

解析选中版本的 section 列表，用 **AskQuestion** 让用户选择（单选）：

```
该版本下包含以下 section：
  A) 设备系统更新 (8 frames)
  B) 用户设置 (5 frames)
  C) ...
请选择要提取样式的 section（单选）：
```

### 3.3 指定子模块（可选）

在选中 section 后，继续用 **AskQuestion** 让用户选择子模块。
**候选列表只允许来自图层名含“子模块”标记的节点**，禁止按“模块/卡片模块”等泛名称猜测：

```
该 section 下识别到以下候选子模块：
  A) 目标展示
  B) 导航操作区
  C) 不指定子模块（提取整个 section）
请选择本次提取范围：
```

若用户选择 `不指定子模块`，后续提取范围为整个 section；否则仅提取指定子模块对应范围。
若 section 下不存在任何“子模块”标记节点，仅展示 `不指定子模块（提取整个 section）`。

---

## Step 4. 提取样式上下文（→ G4）

从解析后的 TreeNode 树中，遍历选中 section（或指定子模块）下的 frame，提取扁平样式上下文。

标准调用：

```typescript
import { extractStyleContextDedupByContent } from '.cursor/skills/seedpacespec-figma-to-prd/scripts/index'

const style = extractStyleContextDedupByContent(buffer, {
  version,
  sectionName,
  subModuleName, // 可选；不指定时传 undefined
})
```

### 4.1 提取规则

**保留**：

| 数据类别 | 具体字段 | 映射说明 |
|----------|---------|---------|
| 节点标识 | `name`、`comp` | 图层名 + 组件名（实例节点），用于定位"这是截图中的哪个元素" |
| 尺寸 | `size` | 节点宽高 |
| 填充 | `fillPaints` → `fills` | RGBA 转为 `#RRGGBB` 或 `rgba(r,g,b,a)` |
| 描边 | `strokePaints` + `strokeWeight` → `strokes` | 颜色 + 粗细 |
| 效果 | `effects` | 阴影（内/外）、模糊 |
| 圆角 | `cornerRadius` / 四角独立 | 统一或 `{ tl, tr, bl, br }` |
| 透明度 | `opacity` | 0~1 |
| 文本样式 | `fontSize`、`fontName`、`lineHeight`、`letterSpacing`、`textAlignHorizontal` | 仅 TEXT 节点 |
| 界面文字 | `textData.characters` 或 `content` → `text` | TEXT 节点可见文字；当 `characters` 为空时回退到 `content` |
| 布局 | `stackMode` → `layout.dir`；`stackSpacing` → `layout.gap`；`stackPadding*` → `layout.pad`；`stackPrimaryAlignItems` → `layout.main`；`stackCounterAlignItems` → `layout.cross` | Kiwi 字段名映射为可读布局语义 |
| 组件标记 | `mainComponentName` → `componentName` | 仅 INSTANCE 节点 |
| 输出容器 | `frames[].texts + frames[].areas` | 按 frame 拍平输出，便于按文案/控件名检索样式 |

**去掉**：

| 数据 | 原因 |
|------|------|
| `functionalDescription` | 产品写给开发看的功能说明文字，不属于视觉层 |
| `guid` / 技术 ID | 对样式还原无用 |
| 不可见节点（`visible: false`） | 不渲染的元素 |
| `fromMainComponent` 等组件内部元数据 | 对样式还原无用 |
| `connectorStart` / `connectorEnd` | 连线关系属于 PRD 范畴 |

### 4.2 理解输出 JSON 的树形结构

style-context.dedup.json 是从 Figma `.fig` 二进制文件逆向解析生成的。要正确理解和使用这个 JSON，必须了解它是如何从 Figma 的组件系统中"展开"出来的。

#### 4.2.1 核心概念：SYMBOL、INSTANCE 与展开

Figma 中每个组件（Component）在 `.fig` 文件中存储为 **SYMBOL**（组件定义/模板），放置在画布上的组件实例存储为 **INSTANCE**（引用 SYMBOL）。

类比函数：SYMBOL 是函数定义，INSTANCE 是函数调用。

INSTANCE 本身不包含子节点——它通过引用 SYMBOL 来"展开"其内部结构。提取脚本在遇到 INSTANCE 时，会找到它引用的 SYMBOL，递归遍历 SYMBOL 的子节点树，同时应用 INSTANCE 上的覆盖数据。

**JSON 中每个 area 节点的 `comp` 字段**就是 INSTANCE 引用的 SYMBOL 的变体名。例如：
```json
{ "name": "1.1按钮", "comp": "年龄=学龄, 颜色=dark, 尺寸=56h, 主次=次, 状态=normal" }
```
`name` 是图层名（可能被设计师随意命名），`comp` 是组件变体全名（精确描述了该组件的属性状态）。

#### 4.2.2 实际遇到的几种情况及处理方式

以下是从真实 .fig 文件中遇到的典型场景，说明 JSON 是怎么"展开"出来的：

**场景 1：按钮栏 5 个槽位只显示 2 个**

导航栏右侧有一个"右操作"区域，它引用的 SYMBOL 定义了 5 个 `1.3功能按钮` 槽位（加 4 个 VECTOR 分割线）。但设计师只想显示其中 2 个（"设置"和"讲错了"），其余 3 个隐藏。

Figma 的做法：SYMBOL 定义了 5 个参数（`componentPropDefs`），每个参数绑定到一个按钮的 `VISIBLE` 属性（通过 `componentPropRefs`）。在 INSTANCE 上，`componentPropAssignments` 给其中 2 个参数传了 `true`，其余保持默认 `false`。

提取脚本的处理：`_resolveChildVisibility` 函数遍历 SYMBOL 子树，把 `componentPropRefs` 上绑定的 `defID` 和 `componentPropAssignments` 传入的 `boolValue` 匹配起来。匹配到 `false` 的加入 `hiddenChildIds`（跳过），匹配到 `true` 但节点本身 `visible=false` 的加入 `forceVisibleIds`（强制显示）。最终 JSON 中只出现 2 个按钮。

**场景 2：父级把子组件整个替换成另一个组件（Symbol Swap）**

"无形象对话"组件里有一个"信息操作"子组件，它的 SYMBOL 原本是"类型=a.提示词"（带多个选项标签）。但在实际画面中，设计师通过父级的 `symbolOverrides` 把它替换（swap）成了"类型=1个文本按钮"（只有一个按钮）。

Figma 的做法：在"无形象对话" INSTANCE 的 `symbolOverrides` 里，有一条 depth-1 override：`guidPath=[9011:37677]`，带 `overriddenSymbolID` 指向新 SYMBOL。`9011:37677` 是"库 GUID"，需要翻译成"信息操作"在 SYMBOL 中的本地 GUID `1906:387221`。

提取脚本的处理：展开"无形象对话"时，把这条 swap override 存入 `childSwapMap`。递归到"信息操作"子节点时，把 `childSwapMap[chId]` 作为 `inheritedSwapSymbolId` 传入，让它展开新 SYMBOL 而非旧的。

关键陷阱："信息操作"自身的 `symbolOverrides` 和 `derivedSymbolData` 仍然指向**旧** SYMBOL。一旦被 swap，这些数据必须丢弃，改用父级传入的 `inheritedOverrides`。否则会展开错误的 SYMBOL 内容。

**场景 3：库 GUID 和本地 GUID 不一致**

`symbolOverrides` 中的 `guidPath` 使用的是"库 GUID"（如 `9011:37677`），但 SYMBOL 子节点的实际 ID 是"本地 GUID"（如 `1906:387221`）。如果不做翻译，所有的 swap、隐藏、文字覆盖都会找不到目标。

提取脚本的处理：`_buildLibToLocalMap` 从 `derivedSymbolData` 的 depth-1 entries 收集库 GUID，从 SYMBOL 子节点收集本地 GUID，按 `localID` 数值排序后一一配对。支持几种情况：
- 库 GUID 数 = 本地 children 数：精确匹配
- 库 GUID 数 = INSTANCE 类型 children 数：跳过 VECTOR/PATH 分割线匹配
- 库 GUID 数 > 本地 children 数：取 `derivedSymbolData` 中的主集合匹配，多余的不映射
- 只有 1 个 child：所有库 GUID 都映射到它

**场景 4：swap + CPA 组合（最复杂的情况）**

导航栏里的"右操作"节点，被父级同时做了两件事：
1. **swap**：把它从 SYMBOL A 替换成 SYMBOL B
2. **CPA 传参**：给新 SYMBOL B 的参数传值，控制 B 内部 5 个按钮哪些可见

这些 CPA 附在 swap override 里，作为 depth-0 的 `componentPropAssignments` 存在。

提取脚本的处理：展开被 swap 的节点时：
1. 确定目标 SYMBOL：用 `inheritedSwapSymbolId`（来自父级 swap）
2. 构建覆盖集：丢弃自身的 `symbolOverrides`（指向旧 SYMBOL），只用 `inheritedOverrides`
3. 提取 CPA：从 `inheritedOverrides` 中找 depth-0 的 `componentPropAssignments`
4. 用这些 CPA 解析新 SYMBOL 子节点的可见性

#### 4.2.3 symbolOverrides 和 componentPropAssignments 的区别

这两个经常同时出现，容易搞混。核心区别：

**symbolOverrides** — 实例对 SYMBOL 后代的"手动改"

存在于 `INSTANCE.symbolData.symbolOverrides`，每条通过 `guidPath` 精确指向 SYMBOL 内任意深层后代，可以携带：
- `textData.characters` — 改文字
- `overriddenSymbolID` — 换组件（swap）
- `visible: false` — 直接隐藏节点
- `componentPropAssignments` — 给 swap 后的新组件传参

实际 .fig 数据示例（来自"无形象对话"实例 233:13256）：
```
symbolOverrides: [
  // 直接隐藏"浮窗"内部的两个子节点
  { guidPath: [9011:37678, 9011:37531], visible: false },
  { guidPath: [9011:37678, 9011:37532], visible: false },

  // 把"信息操作"子组件 swap 成"1个文本按钮"
  { guidPath: [9011:37677], overriddenSymbolID: 1:6752 },

  // 给 swap 后的新组件的子实例传 CPA（嵌套在 swap override 里）
  { guidPath: [9011:37677, 4258:400571], componentPropAssignments: [...] },

  // 改深层 TEXT 节点的文字
  { guidPath: [9011:37677, 4258:400571, 4024:207991], textData: { characters: "立即开始" } },
]
```

说明：`9011:37677` 是"信息操作"的库 GUID，需要通过 lib→local 映射翻译为本地 GUID `1906:387221`。`guidPath` 越长，目标越深。swap 发生在 depth-1（只有一个 GUID），文字覆盖发生在 depth-3（三个 GUID，逐层剥皮传递）。

swap 的关键陷阱：swap 信息是父级发起的，"信息操作"子节点自己不知道被换了——它身上的 `symbolOverrides` 和 `derivedSymbolData` 还是指向旧 SYMBOL "a.提示词"的。一旦被 swap，这些旧数据必须丢弃，改用父级传下来的 `inheritedOverrides`，否则会展开错误的 SYMBOL 内容。

**componentPropAssignments (CPA)** — 实例对 SYMBOL 参数的"传参"

存在于 `INSTANCE.componentPropAssignments`（或嵌套在 symbolOverrides 里），通过 `defID` 给 SYMBOL 声明的参数传值。不能直接改文字或 swap，只能给参数赋值。控制可见性是间接的：SYMBOL 子节点通过 `componentPropRefs` 声明"我的 VISIBLE 由 defID:517 控制"，CPA 给 `defID:517` 传 `true/false`。

实际 .fig 数据示例（来自导航栏"右操作"被 swap 到 SYMBOL 1:3579 后）：

SYMBOL 1:3579 定义了 5 个参数，控制 5 个按钮槽位的可见性：
```
// SYMBOL 上的参数定义
componentPropDefs: [
  { defID: {sessionID:1, localID:517}, name: "显示按钮1", type: BOOLEAN, default: false },
  { defID: {sessionID:1, localID:518}, name: "显示按钮2", type: BOOLEAN, default: false },
  { defID: {sessionID:1, localID:519}, name: "显示按钮3", type: BOOLEAN, default: false },
  ...
]

// SYMBOL 子节点上的绑定
子节点 "1.3功能按钮" 1:3588:
  componentPropRefs: [{ defID: {1:517}, componentPropNodeField: VISIBLE }]
  // 意思："我的 visible 属性由参数 1:517 决定"

子节点 "1.3功能按钮" 1:3586:
  componentPropRefs: [{ defID: {1:518}, componentPropNodeField: VISIBLE }]
```

父级 swap override 附带的 CPA（给新 SYMBOL 传参）：
```
// 嵌套在 symbolOverrides 的 depth-0 override 中
componentPropAssignments: [
  { defID: {1:517}, value: { boolValue: true } },   // 按钮1(1:3588) 可见 → 显示"设置"
  { defID: {1:519}, value: { boolValue: true } },   // 按钮3(1:3584) 可见 → 显示"讲错了"
  // defID:518 没传 → 用默认值 false → 按钮2(1:3586) 隐藏
  // 其余同理 → 按钮4、5 隐藏
]
```

三者串联关系：`componentPropDefs`（定义参数）→ `componentPropRefs`（子节点绑定参数到 VISIBLE）→ `componentPropAssignments`（实例传值 true/false），通过 `defID` 一一对应。

**什么时候用哪个：**

| | symbolOverrides | componentPropAssignments |
|---|---|---|
| 设计师操作 | 右键覆盖、直接 swap | Properties 面板调参数 |
| 粒度 | 精确到任意深层后代（guidPath） | 只能控制 SYMBOL 声明过的参数（defID） |
| 隐藏节点 | 直接 `visible: false` | 间接（BOOLEAN 参数 + propRef） |
| 换组件 | `overriddenSymbolID` | 不行 |
| 改文字 | `textData.characters` | 不行 |
| 附带 CPA | 可以（swap 时给新组件传参） | 自身就是 CPA |

两者经常同时出现——swap 一个组件时，新组件有自己的参数，这些参数的值作为 CPA 嵌套在 symbolOverrides 那条 override 里。

#### 4.2.4 对 apply 侧的意义

1. **`texts` 是最终渲染文字**：已经过所有覆盖链的解析，直接反映截图中的可见文字
2. **`children` 只包含可见节点**：被隐藏（CPA/visible/swap）的节点不会出现
3. **`comp` 是组件变体全名**：比 `name` 更可靠，swap 后的节点 `comp` 反映的是新 SYMBOL 的变体名
4. **多层嵌套会被展平**：SYMBOL→INSTANCE→SYMBOL→INSTANCE 的多层嵌套在 JSON 中体现为 `children` 层级

### 4.3 Kiwi → CSS 语义字段映射

| Kiwi 原始字段 | 输出字段 | 值映射 |
|---|---|---|
| `stackMode` | `layout.dir` | `HORIZONTAL` → `h`；`VERTICAL` → `v`；`NONE` → 不输出 layout |
| `stackSpacing` | `layout.gap` | 原值（px） |
| `stackPadding` / `stackHorizontalPadding` / `stackVerticalPadding` / `stackPaddingRight` / `stackPaddingBottom` | `layout.pad` | `[top, right, bottom, left]` |
| `stackPrimaryAlignItems` | `layout.main` | `MIN` → `start`；`CENTER` → `center`；`MAX` → `end`；`SPACE_EVENLY` → `space-evenly` |
| `stackCounterAlignItems` | `layout.cross` | `MIN` → `start`；`CENTER` → `center`；`MAX` → `end`；`BASELINE` → `baseline` |
| `fillPaints[].color` (RGBA 0~1) | `fills[].color` | `rgba(r*255, g*255, b*255, a)` 或 `#RRGGBB`（a=1 时） |

### 4.4 颜色转换

```typescript
function figmaColorToString(c: FigmaColor): string {
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  if (c.a === 1) return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
  return `rgba(${r},${g},${b},${parseFloat(c.a.toFixed(2))})`
}
```

### 4.5 输出结构

```typescript
interface StyleTextEntry {
  t: string                              // 文案
  s: number                              // fontSize
  c?: string                             // color
  f?: string                             // fontFamily
  w?: string                             // fontWeight/style
  lh?: number | string                   // lineHeight
  at: [number, number, number, number]   // [x, y, w, h]，相对 frame
}

interface StyleAreaEntry {
  name: string
  comp?: string
  at: [number, number, number, number]
  bg?: string
  radius?: number | [number, number, number, number]
  opacity?: number
  shadow?: string
  layout?: {
    dir: 'h' | 'v'
    gap?: number
    pad?: [number, number, number, number]
    main?: string
    cross?: string
  }
  overrides?: string[]
}

interface StyleContentDedupOutput {
  documentName: string
  pageName: string
  section: string
  frameTrees: Array<{
    index: number
    name: string
    size: [number, number]
    roots: Array<{
      id: string
      parentId?: string
      depth: number
      name: string
      at: [number, number, number, number]
      texts: Array<StyleTextEntry>
      children: Array<unknown>
    }>
    orphanTexts: Array<StyleTextEntry>
  }>
}
```

### 4.6 保存

输出保存到变更目录下（`trds/` 同级）：

```
seedpacespec/changes/active-change/{变更名}/figma_data/json_data/style-context.dedup.json
```

截图目录约定为（由开发者手动放置，本流程不搬迁/不移动截图）：

```
seedpacespec/changes/active-change/{变更名}/figma_data/screenshots/
```

若无变更目录，保存到当前工作目录下的：

```
figma_data/json_data/style-context.dedup.json
figma_data/screenshots/
```

展示摘要：

```
✅ 样式上下文已生成

  文件: seedpacespec/changes/active-change/{变更名}/figma_data/json_data/style-context.dedup.json
  截图目录: seedpacespec/changes/active-change/{变更名}/figma_data/screenshots/
  版本: v1.0.7
  Section: 设备系统更新
  子模块: 目标展示（未指定则显示“全部”）
  Frame 数: 8
  节点总数: 156
  含布局信息的节点: 42
  含文本样式的节点: 38
```

<!-- slot:after_style_extracted -->

---


**坐标可信度说明**：

经 INSTANCE size 覆盖 + constraint 重排修复后，`flatCollect` 已合并 3 处位置数据（自身 transform + SYMBOL 内子节点 transform + INSTANCE.derivedSymbolData/symbolOverrides），所有节点的 `at`（frame 内绝对位置）和 `rel`（相对直接父位移）均与 Figma 设计面板一致：

- swap 节点的 `at/rel` 已正确合并 swap override，可直接使用；
- INSTANCE size 与 SYMBOL size 不一致时，按子节点 horizontal/verticalConstraint 自动重算位置/尺寸；
- auto-layout 容器内的子节点已按 padding+gap 累加到正确位置；
- `isSwap` / `isFromSwapParent` 等元标记仍然保留——**作为人工 review 时的语义提示**（区分"设计师手动 swap 进来的节点"与"原生节点"），**不再作为"位置不可信"的决策依据**。

apply 时仍遵循 P0 截图决定论判断"渲染什么"，但"渲染在哪里"可以直接信任 JSON 的 `at/rel/layout`。

---

## 与 apply 的集成

`/sdx-apply` 实现 UI 相关任务时，**不得自行推断是否存在设计参考**。必须通过 AskQuestion 询问用户是否提供了截图与 JSON 参考路径，再决定是否注入。

AI 实现 UI 组件时的三件套：

| 上下文 | 来源 | 提供什么 |
|--------|------|----------|
| 截图（多模态） | `figma_data/screenshots/` | 视觉全貌——"长什么样" |
| style-context.dedup.json | `figma_data/json_data/style-context.dedup.json` | 精确数值——字号、间距、颜色、布局方向 |
| 用户指定的参考文件 | AskQuestion 手动指定 | 已有组件/基础样式——复用什么、遵循什么风格 |

只有在用户确认并提供路径后，apply 才可使用这些参考文件。

### apply 使用样式 JSON 的推荐规则

为避免 Figma 逆向结构中的命名混乱、幽灵节点和大容器噪声导致定位偏差，apply 侧实现 render 时应遵循以下分层规则（P0 > P1 > P2，高优先级不可被低优先级覆盖）：

**P0 — 截图决定论（最高原则）**
- 截图（多模态）是元素**存在性**和**空间布局**的唯一真源
- **只渲染截图中可见的元素**；JSON 中存在但截图中不可见的节点——无论是幽灵节点、设计标注、壳层容器还是隐藏图层——一律视为噪声，**禁止渲染**
- 元素在画面中的大致位置、层叠关系、视觉权重均以截图为准

**P1 — JSON 是查询工具，不是渲染清单**
- **禁止遍历 JSON 节点列表来决定「渲染什么」**；正确流程是：先从截图识别出目标元素 → 再去 JSON 中查找该元素的精确样式值
- 把 style JSON 当逆向结构索引：节点名可能不稳定（如 `Frame xxx`、复用组件名），不得单靠 `name/comp` 做单点匹配

**P2 — 理解 JSON 结构后再查询**

style-context.dedup.json 是从 Figma 组件系统逆向展开的树形结构：
- `frameTrees[].roots` 是树形结构，每个节点代表一个可见的 UI 区域
- `name` 是图层名（可能不稳定），`comp` 是组件变体全名（更可靠）
- `texts` 已经是覆盖解析后的最终文字，直接反映截图中的可见文字
- `children` 只包含可见节点，被隐藏的节点不会出现
- `layout`（dir/gap/pad/main/cross）是 Flex 语义布局，比 `at` 坐标更适合还原为 CSS

查询策略：
1. **文字索引优先**：先按文案匹配 `texts`，再回查容器样式
2. **comp 辅助定位**：用 `comp`（组件变体名）辅助确认区域
3. **坐标兜底**：无文案元素按 `at` 坐标 + 尺寸 + 邻近关系定位
4. **冲突选最深节点**：多候选时选 `depth` 更大的节点
5. **layout 与坐标并列可用**：`at/rel` 已经过 SYMBOL 展开 + INSTANCE size 覆盖 + constraint 重排合并，与 `layout` 语义同等可信；按场景择优——绝对定位用 `at`，Flex/Grid 还原用 `layout`，相对父定位用 `rel`
6. **仅作视觉参考**：JSON 只用于样式与定位映射，不改变 TRD 已定的组件分层与组件树

---

## Guardrails

- **状态机 G1→G4 是 ASSERTION**：G1 未完成 → 禁止解析；G3 未完成 → 禁止提取
- **AskQuestion 必须等用户回复**：版本、section、子模块选择都必须停下等用户明确回复，禁止替用户做决定
- **子模块必须显式决策**：用户必须明确“指定某子模块”或“提取整个 section”，不得默认猜测
- **子模块候选严格来源于“子模块”标记**：候选列表只列图层名含“子模块”的节点，禁止基于语义猜测扩展候选
- **产物目录固定**：JSON 必须落到 `figma_data/json_data/`，与 `trds/` 同级
- **json_data 仅保留 dedup 文件**：默认产物为 `style-context.dedup.json`，不再额外保留 `style-context.json`
- **截图由开发者手动维护**：本流程不移动、不复制截图文件
- **不得隐式注入**：apply 侧使用设计参考前，必须 AskQuestion 向用户确认是否有截图和 JSON 可参考
- **只提取样式，不生成 PRD**：本 skill 不写 PRD、不处理 functionalDescription
- **颜色必须转为可读格式**：`#RRGGBB` 或 `rgba()`，禁止输出 0~1 浮点
- **布局字段使用可读语义命名**：`dir`/`gap`/`pad`/`main`/`cross`，不输出 Kiwi 原始字段名
- **过滤不可见节点**：`visible: false` 的节点不出现在输出中
- **逆向结构容错**：输出可能存在命名噪声、结构壳层或幽灵节点；apply 侧必须以截图为元素存在性的唯一真源（P0 截图决定论），JSON 仅作为精确样式值的查询工具（P1），禁止遍历 JSON 决定渲染什么
- **输出完整可见样式项**：每个 frame 的 `texts` 与 `areas` 应覆盖可见文本与关键视觉区域，不做主观裁剪

---

## Step 5. Overrides 清洗（可选但推荐）

Figma 中的 `overrides` 文本替换通常位于容器层而非最底层的文本节点，这会导致 `texts` 字段与实际显示不符。本步骤将 `overrides` 下沉到正确的 `texts` 位置。

### 5.1 清洗逻辑

```typescript
// 使用独立的 CLI 工具清洗
// 位置: .cursor/skills/seedpacespec-figma-to-prd/scripts/clean-overrides-cli.ts
```

**核心规则**：

1. **后代优先匹配**：优先检查后代节点的 `overrides` 是否能匹配祖先的 `overrides` 列表
2. **按序分配**：父节点有多个 `overrides` 且多个子节点时，`overrides[i]` 分配给 `children[i]`
3. **一路下沉**：匹配的 `override` 会替换沿途所有节点的 `texts[0]`，并清除经过节点的 `overrides`
4. **不匹配报告**：当无法匹配时输出警告，用户自行检查设计

**示例场景**：

```
原始: nav(overrides:["课程目标","设置","标准语速","讲错了"])
       └─按钮-左图标(overrides:["讲错了"])
           └─...内容(texts:["功能"])

清洗后: 后代"讲错了"匹配祖先列表 → 内容(texts:["讲错了"])
        沿途所有节点的 overrides 被清除
```

### 5.2 执行清洗

**方式一：CLI 命令行**（推荐用于已提取的 JSON 文件）

```bash
# 在项目根目录执行
cd /Users/hujixin/Desktop/project/seedpacespec

# 清洗单个文件
npx ts-node .cursor/skills/seedpacespec-figma-to-prd/scripts/clean-overrides-cli.ts \
  figma_data/json_data/style-context.dedup.json \
  figma_data/json_data/style-context.cleaned.json

# 输出报告示例:
# ═══════════════════════════════════════════════
# Overrides 清洗报告
# ═══════════════════════════════════════════════
#
# ✅ 匹配成功 (14项):
#   [nav] overrides["讲错了"]匹配祖先列表索引3
#   [按钮-左图标] 后代"内容"匹配祖先"讲错了"
#   ...
#
# 📊 Overrides 分配 (2处):
#   [导航栏] 4个 → 4个子节点:
#     [0] 返回按钮: "返回"
#     [1] 设置按钮: "设置"
#     ...
#
# ⚠️ 未匹配警告 (1项，请检查):
#   [按钮-右图标]
#     overrides: ["讲错了"]
#     原因: overrides[讲错了]不匹配祖先overrides[课程目标,设置]
#
# ═══════════════════════════════════════════════
# ✅ 已保存到: style-context.cleaned.json
```

**方式二：在提取流程中自动清洗**（需要修改 extractStyleContextDedupByContent）

```typescript
// 在调用 extractStyleContextDedupByContent 后添加:
import { cleanOverridesInStyleContext, formatCleanReport } from './overrides-cleaner'

const style = extractStyleContextDedupByContent(buffer, { version, sectionName })
const { context: cleaned, report } = cleanOverridesInStyleContext(style)

// 输出报告
console.log(formatCleanReport(report))

// 保存清洗后的文件
fs.writeFileSync('style-context.cleaned.json', JSON.stringify(cleaned, null, 2))
```

### 5.3 不匹配报告解读

| 场景 | 报告输出 | 建议处理 |
|------|---------|---------|
| `overrides` 数量 > `children` 数量 | "override[i]没有对应的子节点" | 检查设计，可能有多余的 overrides 或缺少子节点 |
| 后代 `overrides` 不匹配祖先列表 | "overrides[X]不匹配祖先overrides[Y]" | 检查 Figma 中的组件覆盖关系，确认是否是预期行为 |
| 单层多 overrides 但单层单 child | "按顺序分配" | 确认设计意图，可能需要手动调整 |

**注意**：清洗脚本是**保守**的——即使不匹配，也会使用第一个 `override` 进行替换，确保 `texts` 有值而非空。未匹配的警告供人工 review，不阻止流程继续。
