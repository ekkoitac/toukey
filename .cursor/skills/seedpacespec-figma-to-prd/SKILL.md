---
name: seedpacespec-figma-to-prd
id: seedpacespec-figma-to-prd
category: Workflow
description: >
  从 Figma .fig 文件逆向解析并生成 PRD 需求文档。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"从 Figma 生成PRD"、"解析fig文件"、"我有设计稿要生成需求文档"、提供了 .fig 文件路径。
  SKIP: 用户没有 .fig 文件只有文字需求（用 sdx-explore）；用户只需要提取样式不需要 PRD（用 sdx-figma-style）。
  requires: 本地 .fig 文件 + 对应截图。
  output: PRD Markdown 文档（需求清单、验收标准、用户流程图）。
  examples: "帮我把这个 login.fig 转成需求文档" → 触发；"Figma 怎么用" → 不触发。
license: MIT
metadata:
  author: seedpacespec
  version: "1.0"
---

# seedpacespec-figma-to-prd

从 Figma `.fig` 文件或已有清洗 JSON 生成**可执行的 PRD Markdown 文档**。

## 两条输入路径

> **无论哪条路径，最终产出都是 PRD Markdown。** JSON 始终只是中间产物。

| 路径 | 输入 | 中间产物 | 最终输出 |
|------|------|---------|---------|
| **A：从 .fig 逆向（标准路径）** | `.fig` 文件 + 版本 + section + 截图 | 清洗 JSON（内存，不保存文件） | **PRD Markdown** |
| **B：从已有 JSON 快捷生成** | 已有清洗 JSON + 版本 + section + 截图 | —（用户已提供中间产物） | **PRD Markdown** |

路径 B 是路径 A 的快捷入口——当用户已经有了逆向后的 JSON（中间产物），可跳过解析步骤直接进入 PRD 生成。

大型 Section 支持**渐进生成**（分批选子模块、逐轮输出，见 §七）。

---

## .fig 逆向原理

以下为背景知识，帮助理解 `scripts/` 目录中逆向脚本的工作原理。AI 无需手动编写解析逻辑，直接调用脚本即可。

### .fig 文件格式

.fig 文件有两种封装格式：

1. **ZIP 容器**（常见）：内含 `canvas.fig`（主画布二进制）+ `images/` 目录（内嵌位图资源）
2. **纯 fig-kiwi 二进制**：以魔数 `fig-kiwi`（ASCII `[102,105,103,45,107,105,119,105]`）开头，无单独 images

二进制部分结构（`canvas.fig` 或整个文件本身）：
- 12 字节文件头（含 `fig-kiwi` 魔数）
- N 个 length-prefixed chunk（每个 4 字节 little-endian 长度 + 压缩数据）
- chunk 解压策略：PNG 魔数 → 直传；Zstd 魔数 `[0x28,0xb5,0x2f,0xfd]` → zstd 解压；否则尝试 raw deflate → zstd 兜底
- 前两个解压后的 chunk：**Kiwi 二进制 schema** + **Kiwi 数据 payload**
- 用 `kiwi-schema` 库的 `decodeBinarySchema()` + `compileSchema()` → `decodeMessage()` 解码 payload
- payload 解码后得到 `{ nodeChanges[], blobs[] }`

### 逆向管线（4 步）

```
.fig (ZIP 或 fig-kiwi 二进制)
  │
  ▼ Step 1: 解析二进制
  若 ZIP → 解压取 canvas.fig + images/*
  解析 fig-kiwi → 解压 chunks → Kiwi schema + data → { nodeChanges[], blobs[], imageFiles }
  │
  ▼ Step 2: 构建树
  flat nodeChanges[] → TreeNode 树（parentIndex.guid 关联，parentIndex.position 排序）
  DOCUMENT 为根 → CANVAS 子页面 → FRAME/GROUP/SECTION/TEXT/... 层级
  │
  ▼ Step 3: 提取 PRD 结构
  选择 page(版本子串匹配) → flattenWithBounds → 识别 sections(SECTION 类型优先，大 FRAME/GROUP 兜底)
  → 对每个 section 提取 elements/texts/functionalDescription/connectors
  │
  ▼ Step 4: 输出 FigToPrdOutput JSON
  { documentName, pageName, usageHint, sections[{ name, bounds, elements[], functionalDescription[] }] }
```

### 关键依赖库

| npm 包 | 作用 |
|--------|------|
| `uzip` | 解压 .fig ZIP 容器；raw inflate 解压部分 chunk |
| `fzstd` | Zstandard 解压（chunk 的主要压缩格式） |
| `kiwi-schema` | 解码 .fig 内嵌的 Kiwi 二进制 schema 并编译解码器 |

### 脚本调用

逆向脚本位于 `scripts/` 目录，**AI 不需要编写解析逻辑**，按以下标准流程调用即可。

#### 前置：安装依赖

```bash
npm install fzstd kiwi-schema uzip
```

#### 标准调用流程

```
1. 读取 .fig 文件    → const buf = fs.readFileSync(figPath)
                      const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
2. 列出页面版本     → listPageVersions(buffer) → { name, index }[]
3. 用户选择版本/页面 → AskQuestion
4. 生成 JSON        → generatePrdFromFig(buffer, { version, baseName }) → FigToPrdOutput
5. 清洗简化         → pruneForDify(prdOutput) → 精简后的 JSON（移除 id、装饰节点、自动命名等）
6. (可选) 提取图片   → extractFigImages(buffer) → Map<fileName, Uint8Array>
```

**核心函数签名**（详细类型见 `scripts/fig-to-prd.ts`）：

| 函数 | 输入 | 输出 |
|------|------|------|
| `parseFigFile(buffer)` | .fig ArrayBuffer | `{ nodeChanges[], blobs[], imageFiles: Map }` |
| `listPageVersions(buffer)` | .fig ArrayBuffer | `{ name: string; index: number }[]` 页面列表 |
| `generatePrdFromFig(buffer, options?)` | .fig ArrayBuffer + `{ version?, baseName?, nestedExpandMarkers? }` | `FigToPrdOutput` |
| `pruneForDify(output)` | FigToPrdOutput | 精简后的 JSON（移除 id/装饰节点/自动命名，减少 token） |
| `extractFigImages(buffer)` | .fig ArrayBuffer | `Map<string, Uint8Array>` 原始图片字节 |



### JSON 结构概览

无论使用何种逆向工具，最终 PRD JSON 应符合以下结构：

```typescript
interface FigToPrdOutput {
  documentName: string
  versionFilter: string | null
  pageName: string
  usageHint: string
  sections: Array<{
    id: string
    name: string
    bounds?: { x: number; y: number; w: number; h: number }
    functionalDescription?: Array<{ id: string; text: string }>
    elements: Array<{
      id: string
      type: string              // FRAME | GROUP | TEXT | INSTANCE | ...
      name?: string             // 图层名（去掉 Figma 自动命名如 Frame 123）
      displayName?: string
      texts?: Array<{ id: string; text: string; elementId?: string }>
      functionalDescription?: Array<{ id: string; text: string }>
      from?: Array<{ id: string; name: string; label?: string; blockId?: string }>
      to?: Array<{ id: string; name: string; label?: string; blockId?: string }>
      children?: Element[]      // 图层名含「子模块」标记时递归展开
      isComponentInstance?: boolean
      mainComponentName?: string
    }>
  }>
}
```

**关键字段语义**：
- `texts[]`：框内界面文案——截图里用户能看到的所有文字（按钮、标题、正文等），按画布从上到下、从左到右排列
- `functionalDescription[]`：功能/规格说明——产品经理写在截图旁边给开发看的规格，**不会出现在最终产品界面上**
- `from[]` / `to[]`：CONNECTOR/LINE 连线关系，表示页面间跳转或流程走向
- `children[]`：嵌套子模块，结构与父级完全相同，需 DFS 递归遍历
- `bounds`：section 在画布上的包围框坐标
- `sectionLevelHint`：画布上未吸附到任何 FRAME 的游离说明，通常是整个 section 的背景说明或全局规则

### 截图说明

逆向过程**不包含渲染 .fig 为 PNG 的能力**。截图获取方式：
1. **ZIP 内嵌图片**：解压 .fig ZIP 中 `images/` 目录即可提取（通常是设计师放入的参考图）
2. **用户手动提供**：从 Figma 客户端或浏览器导出的界面截图
3. **section bounds**：JSON 输出包含每个 section 的画布坐标，可用于外部裁剪工具

---

## State Machine Gates

执行前必须依次通过以下状态门禁。**任何状态未完成 → 只能 AskQuestion，不得开始生成 PRD。**

| # | 状态 | 完成条件 | 未完成时行为 |
|---|------|---------|-------------|
| G1 | `inputs_collected` | 数据源（.fig/JSON）、版本号已确定；截图和变更名已确定或标记缺失 | AskQuestion 一次性收集缺失项 |
| G2 | `path_determined` | 路径 A(.fig) 或路径 B(JSON) 已确定；路径 A 时 fig 已解析 | 解析 fig / 识别路径 |
| G3 | `section_selected` | 用户选定要处理的 section（.fig 时从解析结果列表中选） | AskQuestion 让用户选择 |
| G4 | `generating` | 截图 + JSON 已就绪，进入 PRD 生成（DFS 遍历 + 规范写作） | 生成 PRD |

**状态推进单向** G1→G2→G3→G4，不得跳跃。**G3 未完成 → 禁止生成 PRD。**


**🚫 禁止编造跳过理由**：AI 不得以任何自创名义（如恢复协议、追加模式、精简流程、复用已有产物、简化模式等）跳过门禁。所有门禁必须逐一通过并产出可验证输出。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。
---

## 前置检查与询问（G1 门禁）

执行本 skill 时，首先检测用户是否已提供以下信息，**缺失时用 AskQuestion 一次性询问**：

| 信息项 | 说明 | 必需性 |
|--------|------|--------|
| **数据源** | `.fig` 文件路径（路径 A）或 已有清洗 JSON 文件路径（路径 B） | ✅ 必需（二选一） |
| **版本号** | 数据版本标识（如 `v1.0.0`、`2024-Q1`） | ✅ 必需 |
| **Section** | 要处理的 section 名称（.fig 可先解析后列出供选择） | ✅ 必需 |
| **截图** | 配套界面截图文件/目录 | 🔶 强烈推荐——若用户未提供，在流程开始时**简要提示一次**：「未检测到截图，视觉验收可能不完整。如有截图可随时补充。」然后继续生成，不阻塞流程 |
| **变更名** | seedpacespec 变更目录命名 | 🔶 可选 |

## 文件放置规范

```
seedpacespec/changes/active-change/{变更名}/
├── {功能名}-prd.md                 # ★ PRD 主文档（最终产出）
└── figma-screenshots/              # 配套截图（可选）
    └── {版本号}/
        └── {section-name}/
            ├── frame-1.png
            └── ...
```

> 从 .fig 逆向时，清洗后的 JSON 仅作为内存中间产物传递给 PRD 生成逻辑，**不保存为本地文件**。

## PRD 生成规范

本节为**唯一规范**：生成 PRD 时**只读本文件**，无需再读其它 rules 文件。

---

### 一、理解输入：截图 + JSON 的关系

产品经理在 Figma 中画交互稿，每个页面（Page）包含若干 **Section**（大的功能区块）。每个 Section 下有若干 **FRAME**（可理解为一张"截图"或一个"交互状态"），以及旁边的文字说明。

逆向脚本把这棵 Figma 树提取为结构化 JSON，同时用户会提供对应的**截图**。二者配合才能完整理解需求：

| 信息来源 | 能提供什么 | 不能提供什么 |
|----------|-----------|-------------|
| **截图** | 视觉布局、色彩风格、组件样式、空间关系 | 精确文案（截图可能模糊/被遮挡）、规格数值、分支条件 |
| **JSON** | 精确文案、功能规格、数据字段、执行顺序、连线关系、树形层级 | 视觉样式、动效、组件在屏幕上的外观 |

**核心原则：文案以 JSON 为准，视觉以截图为准，业务理解靠二者结合。**

**写 PRD 时只处理用户指定的那一个 section**，不要把其他 section 的内容混入。

---

### 二、节点（element）字段详解

每个节点代表 Figma 画布上的一个元素。**`elements` 和 `children` 里的节点结构完全相同**，可以无限嵌套。

#### 2.1 `name` — 节点名称

Figma 里图层的名称，由设计师/产品手动设定。

**重要提醒：name 经常不可靠**。产品经理在 Figma 中可能：
- 根本不改默认名 → 出现 `"Frame 1"`、`"Group 1410090450"` 这样的无意义名称
- 只用数字编号 → `"1"`、`"2"`、`"3"` 表示同一模块的不同交互状态/步骤
- 用简短标签 → `"模块"`、`"列举目标（2个目标）"`

**写 PRD 时**：不要依赖 name 理解节点含义。**要结合 `texts`、`functionalDescription` 和截图来判断这个节点到底是什么**。

#### 2.2 `type` — 节点类型

常见值：`FRAME`（画框/容器）、`GROUP`（组）、`TEXT`（文字）、`INSTANCE`（组件实例）等。

`FRAME` 和 `GROUP` 通常对应一个"截图"或"交互状态"，是需求清单的主要来源。

#### 2.3 `texts[]` — 框内界面文案（核心字段）

这个 FRAME/GROUP **截图画面里能看到的所有文字**，按画布从上到下、从左到右排列。包含按钮文字、标题、正文、标签、提示语等。

**AI 生成 PRD 时如何使用 `texts`**：

1. **理解画面内容**：当 name 无意义时，`texts` 是判断"这个截图是什么画面"的最重要线索
2. **还原交互状态**：同一模块的多个 FRAME（如 name 为 "1"、"2"、"3"）可通过 `texts` 差异理解各步骤
3. **写入验收标准**：`texts` 中的文案应完整收录到需求清单的验收标准中
4. **辅助写用户故事**：从 `texts` 提取关键词（如"开始学习"、"提交"），结合截图推断交互路径

#### 2.4 `functionalDescription[]` — 功能/规格说明（核心字段）

产品经理写在截图旁边的**功能说明文字**——这些文字**不会出现在最终产品界面上**，是给开发看的规格说明。

**AI 生成 PRD 时如何使用**：

1. **验收标准的核心来源**：必须**完整、逐条**写入需求清单的验收标准，**禁止概括或删减**
2. **数据字段说明**中的字段名、限制（字数、数量、格式）→ 直接成为可测试条件
3. **执行顺序说明**中的步骤 → 直接成为交互流程的验收标准

#### 2.4a `functionalDescription` 中的 UI 文案噪声

由于 Figma 画布布局的复杂性，导出工具的几何吸附算法偶尔会将**图框内部的 UI 文字**错误归入 `functionalDescription`。

**识别特征**（满足任一即疑似 UI 噪声）：

| 特征 | 例子 |
|------|------|
| 极短文字（≤ 6 字）且无规格含义 | "开始学习"、"确定"、"返回" |
| 与同块 `texts` 中的文案重复或高度相似 | |
| 不含任何规格语法特征 | 无编号、无字段名、无数值限制、无逻辑条件 |
| 与同块其他条目风格/长度差异悬殊 | 其余都是多行规格段落，混入一条 3 字按钮标签 |
| 看起来像截图中可见的 UI 元素 | Tab 标签、导航项、弹窗标题 |

**处理方式**：

1. 疑似 UI 噪声**不写入验收标准**
2. 可作为理解画面上下文的辅助线索
3. 满足噪声特征但又含部分规格语法特征（如短文案但附带数值限制），统一标记 `[需确认：该条可能为界面文案而非规格]`，交由用户裁定
4. 优先关注多行、有编号、含字段定义或逻辑条件的条目——它们才是规格本体
5. 可将截图与 `functionalDescription` 交叉比对：截图中肉眼可见的文案大概率是 UI 文案

#### 2.5 `texts` 与 `functionalDescription` 的区别

| | `texts[]` | `functionalDescription[]` |
|--|-----------|---------------------------|
| **本质** | 截图里用户能看到的界面文案 | 截图旁边产品写的规格说明 |
| **是否出现在产品中** | 是 | 否，只是给开发的说明 |
| **PRD 中的作用** | 理解画面 + 文案规范表 + 对齐验收 | 直接成为验收标准核心内容 |
| **能否概括** | 短文案可合并表述 | **禁止概括，必须完整收录** |

#### 2.6 `from[]` / `to[]` — 连线关系

Figma 中的箭头/连线，表示页面间跳转或流程走向。`from`/`to` + `label` 是绘制 Mermaid 流程图的依据。

#### 2.7 `children[]` — 子节点（子模块）

当 FRAME 名称包含"子模块"标记时，子 FRAME 出现在 `children` 中。结构与根级节点完全相同。

**关键规则**：
- 父节点通常只有少量标题文案，**规格和长文在子节点上**
- 写 PRD 时必须 **DFS 递归遍历** `children`，不能只看根层

#### 2.8 `sectionLevelHint` — 游离说明

画布上没有被吸附到任何 FRAME 的独立文字，通常是整个 section 的背景说明或全局规则。写入概述或作为全局验收标准，若信息不足标 `[需确认]`。

#### 2.9 其他字段

| 字段 | 说明 | PRD 中是否使用 |
|------|------|---------------|
| `id` | Figma 节点 ID（如 `7074:151072`） | **禁止写入 PRD 正文** |
| `isComponentInstance` | 是否为组件实例 | 仅解析参考，不写入 PRD |
| `mainComponentName` | 主组件名 | 仅解析参考，不写入 PRD |

---

### 三、典型场景举例

#### 场景 A：name 为"1"的 FRAME

```json
{
  "name": "1",
  "type": "FRAME",
  "functionalDescription": [
    { "text": "2、执行顺序：\n①AI老师先正面对着孩子说开场语..." }
  ],
  "texts": [
    { "text": "通过本节课，我能：" },
    { "text": "认识形容词和名词，知道它们是好朋友" }
  ]
}
```

**解读**：name `"1"` 无意义 → 看 `texts` → 画面是"学习目标"页面 → `functionalDescription` 写了执行顺序 → 写需求时用业务名"目标展示-单条目标状态"

#### 场景 B：子模块结构

```json
{
  "name": "1v1课程语言主流程-我的目标-模版",
  "type": "FRAME",
  "texts": [ { "text": "01 我的目标" }, { "text": "开始学习" } ],
  "children": [
    { "name": "列举目标（2个目标）", "functionalDescription": [...], "texts": [...] },
    { "name": "1", "functionalDescription": [...], "texts": [...] }
  ]
}
```

**解读**：父节点 `texts` 只有标题和公共按钮 → **规格全在 `children`** → 必须 DFS 遍历

#### 场景 C：常规 App / 新功能稿（无主流程 + 环节结构）

很多稿**不是**课程类产品，而是 App 新功能、后台模块、简单迭代，结构常见为：

- 若干**页面/状态**（每个 FRAME 对应一屏或一态）
- 页面内交互写在各帧的 `functionalDescription` / `texts`
- 路由与跳转靠 `from[]` / `to[]` 串联

**写 PRD 时**：先识别稿风，**必须用 AskQuestion 向用户确认**：「识别到的稿风为 `<稿风类型>`（识别线索：`<线索>`），需求清单将按 `<组织方式>` 组织。是否认可？」选项：A）认可；B）调整稿风类型。**禁止**无证据时硬套「主流程 + 环节」叙事。

| 稿风倾向 | 识别线索 | 需求清单组织方式 |
|----------|----------|------------------|
| **流程课 / 大环节** | 存在「主流程」节点、多「模版」根、深 `children` | 主流程优先、环节融合（见 3.1、3.2） |
| **常规功能 / 多页面** | 根节点多为独立页面名、强依赖 `from`/`to`、无统一主流程 FRAME | 按用户路径或页面分列需求 |
| **小需求** | 少量 FRAME、规格短 | 精简表格，仍保证验收标准完整 |

#### 3.1 主流程节点的识别与处理

在 Figma 交互稿中，产品经理通常用两种结构描述一个功能：

| 结构 | name 特征 | 内容 | PRD 中的角色 |
|------|----------|------|-------------|
| **模版节点** | `xxx-模版`、`xxx-几个模版` | 单个模版的数据字段、布局规格、变体 | 定义"每个模版长什么样" |
| **主流程节点** | `xxx主流程` | 环节串联顺序、环节间过渡、分支条件、通用界面结构、动效 | 定义"环节之间怎么走" |

**常见遗漏风险**：只处理模版节点，忽略主流程节点，导致以下规格丢失：
1. 通用讲课界面（顶部环节名称、底部翻页组件、举手提问入口）
2. 学情询问与难度分支
3. 思考等待动效（AI 批改/生成内容时的加载状态和预制语）
4. 多状态结束页（如"已掌握"和"未掌握"两种结束页）
5. 环节间衔接规格

**处理流程**：
1. DFS 遍历时**同时扫描主流程节点和模版节点**
2. 主流程 children 中每个有 `functionalDescription` 的节点都要检查
3. 主流程中独有的环节必须单独成为需求项
4. 流程图以主流程为骨架

#### 3.2 需求清单顺序与「主流程 → 环节」融合

**适用条件**：稿中已识别为流程课 / 主流程 + 环节模版结构。常规多页面稿按用户路径或页面排序。

1. **排列顺序**：主流程相关需求排在最前；各环节按主流程定义的先后顺序排列
2. **融合而非省略**：主流程里作用于某一具体环节的规则，要**写进该环节**对应需求行的验收标准（可与模版 `functionalDescription` 合并），**不要**只写「见主流程」——环节行应**自洽可测**
3. **环节细化稿的侧重点**：生成环节需求时，必须**回看主流程**中与本环节相关的条目，把适用部分融入本节验收标准

---

### 四、写 PRD 的核心原则

1. **业务理解优先**：先结合截图 + `texts` 理解"这个产品是做什么的"，再写 PRD。禁止只做文案复读机
2. **每条信息只出现一次**：概述简练写业务目标，长规格只写在需求表的验收标准里，不要两处重复
3. **验收标准完整收录**：`functionalDescription` 必须逐条、按顺序、完整写入验收标准，禁止删减
4. **DFS 遍历整棵树**：不要只看 `elements` 第一层，`children` 里可能有大量规格
5. **只说 What 不说 How**：描述业务规则和期望行为，不写技术实现
6. **PRD 正文禁止出现技术 ID**：`7074:151072` 格式的 ID 不能出现。宽高比用"3 比 2"而非"3:2"
7. **functionalDescription 去噪**：混入的 UI 短文案排除在验收标准之外，聚焦多行规格说明（见 §2.4a）
8. **主流程与环节融合**（仅当稿中确实存在该结构时）：主流程节点的 `children` 含流程级规格，模版节点侧重画面。写 PRD 时凡主流程中对该环节生效的约束，应融合进该环节需求行的验收标准。若稿风为常规多页面功能则不要硬套（见场景 C）

---

### 五、输出格式（章节不得缺）

1. **标题**：`# {feature_name} - PRD`
2. **文首**：来源（Figma 结构化数据 + 截图）、日期、状态
3. **## 1. 概述**：业务目标、目标用户、范围
4. **## 2. 用户流程**：Mermaid flowchart（据 `from`/`to` 与截图绘制）
5. **## 3. 需求清单**：表列 ID、用户故事、验收标准、优先级、置信度
   - 验收标准须与 `functionalDescription` 逐条对齐，完整不删减
   - `texts` 和 `functionalDescription` 按 JSON 数组顺序写入
   - 置信度标记：`[已确认]` / `[推断]` / `[需确认]`
6. **## 4. 文案规范表**：关键固定文案、半固定文案
7. **## 5. 待确认表**
8. **## 6. 变更记录**

---

### 六、需求清单粒度与成稿自检

**生成时**：
1. **DFS 先枚举再落表**：遍历选定 section 整棵树，每个有 `functionalDescription` 的节点至少一行需求
2. **双线扫描**（仅当存在主流程/环节结构时）：先扫主流程 `children` 建立环节顺序与流程级规则，再扫模版节点产出各行；无主流程时以页面、`from`/`to` 为主
3. **一条交互范式 ≈ 一行需求**：同一模版的"数据字段 + 执行顺序"写在同一行验收标准里。共用能力首条写全，其余引用"同 Rxx"

**成稿自检**：
1. `functionalDescription` 长文完整收录，顺序与 JSON 一致；独立规格块数 ≥ 需求行数
2. 概述和用户故事写了业务理解（谁、什么场景、什么目标），不是纯抄 `texts`
3. 空态、错误态、加载态在验收标准中有覆盖
4. 全文无 Figma 技术 ID（`数字:数字` 格式）
5. `functionalDescription` 中的短文案（按钮标签、Tab 名称等）未被误写为验收标准
6. `from`/`to` 和 `sectionLevelHint` 均已落入需求或待确认
7. 若稿为主流程+环节结构：主流程 `children` 每个环节在需求清单中有对应行，主流程规则已融合进环节需求行的验收标准，环节行可独立验收；否则：页面/路由与 `from`/`to` 均在需求或流程图中有对应

---

### 七、渐进式生成（大型 Section）

当一个 Section 含多个大型子模块时，支持**分批选择子模块、逐步生成**，避免一次性发送超长 JSON 导致质量下降。

#### 8.1 识别渐进模式

当 section 内子模块数 ≥ 5 或根元素数 ≥ 15 时，**必须 AskQuestion** 询问：「该 section 较大（<N> 个子模块），建议分批渐进生成。如何处理？」选项：A）渐进生成（分批选子模块）；B）一次性全量生成。

用户 query 中可能包含：
- `【渐进生成模式】` — 分批生成的首轮
- `现在补充以下子模块` — 后续轮次
- JSON 中的 `_hint` 字段 — 标记为 `将在后续轮次展开` 或 `已生成`

#### 8.2 首轮生成（骨架 + 首批子模块）

1. **生成完整 PRD 骨架**：概述、流程图框架、需求清单目录
2. **详写选中子模块的验收标准**：完整收录 `functionalDescription`
3. **为未选中子模块创建占位行**：标记 `[待补充：将在后续轮次展开]`
4. **流程图先画主干**，未展开分支用虚线或 `[待补充]` 标记

#### 8.3 后续轮次（补充子模块）

1. **展开对应需求行的验收标准**：将 `[待补充]` 替换为完整 `functionalDescription` 内容
2. **更新流程图**：补充与新模块相关的分支和节点
3. **保持已完成部分不变**：不整段重写前序轮次已写好的模块
4. **输出完整 PRD 全文**（非差异/摘要），以便直接替换上一版

#### 8.4 汇总合并（最终轮）

1. 整合流程图为完整版（去除 `[待补充]` 标记）
2. 检查需求编号连续性
3. 补充文案规范表和待确认表
4. 输出最终完整版 PRD

---

## Guardrails

- **状态机门禁（G1→G4）是 ASSERTION**：任何状态未完成 → 只能 AskQuestion，不得生成 PRD。凡需要用户交互的步骤，必须停下等用户明确回复。禁止跳过、合并或替用户做决定。
- **G1 缺失信息必须询问**：缺少数据源、版本、section 任一时，必须 AskQuestion
- **G3 未完成 → 禁止生成 PRD**：section 选择是 GATE，未通过不得开始写
- **验收标准完整**：`functionalDescription` 必须逐条、按顺序、完整写入
- **DFS 遍历整棵树**
- **禁止技术 ID**：PRD 正文禁止出现 Figma 技术 ID
- **只处理指定 section**：不得混入其他 section 的内容
- ❌ 不得将 UI 短文案误写为验收标准
- ❌ 不得无证据硬套「主流程 + 环节」结构（见场景 C）

## 与下游 Skill 的衔接

✅ PRD 已保存后，可执行 `/sdx-trd-generator` 生成 TRD，或 `/sdx-propose`（`/sdx-guided`）创建完整变更。
