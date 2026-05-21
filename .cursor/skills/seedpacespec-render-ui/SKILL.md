---
name: seedpacespec-render-ui
description: >
  sdx-apply 的子技能——根据截图和 style-context JSON 精确还原 UI 视觉层，只做样式还原不处理业务逻辑。
  TRIGGER when: 由 sdx-apply 在执行 UI 类任务时内部调用。不应被用户直接触发。
  SKIP: 任何用户直接请求——用户说"还原UI"应通过 sdx-apply 进入，由 apply 判断是否需要加载本子技能。
  requires: figma_data/screens/ 下的截图 + style-context.cleaned.json + 正在执行的 sdx-apply 会话。
  output: 精确还原视觉的组件代码（仅样式层）。
  examples: sdx-apply 执行 UI 任务时自动加载 → 正确；用户直接说"还原UI" → 不直接触发本 skill，走 sdx-apply。
license: MIT
compatibility: 通用，需配合 style-context JSON 和截图素材。
metadata:
  author: seedpacespec
  version: "3.0"
  generatedBy: "seedpacespec"
---

**UI 还原专用 skill**。输入：截图（`figma_data/screens/`）+ `style-context.cleaned.json`；输出：精确还原视觉的组件代码。

---

## 核心原则（先记住）

| 原则 | 含义 | 违反后果 |
|------|------|---------|
| **截图决定存在** | 截图有 → 写 HTML 元素；截图没有 → 不写 | 写了多余元素/漏写元素 |
| **素材包含不复现** | 素材有 → 不 CSS 绘制；素材无 → 查 JSON | 重复渲染/素材拆分 |
| **JSON 定尺寸** | 用 `at[2,3]` 做 width/height | 尺寸不对 |
| **JSON 定坐标** | `at`/`rel` 已合并所有 override，可直接用 | 定位漂移 |
| **父容器定内部** | 子元素在父容器内用 Flex/rel，避免坐标系错配 | 双重坐标系冲突 |

---

## 数据模型

### 字段定义

| 字段 | 含义 | 可信度 | 用途 |
|------|------|--------|------|
| `at[0,1]` | x, y frame 内绝对坐标 | ✓ 始终可信 | CSS 绝对定位 left/top |
| `at[2,3]` | w, h 尺寸 | ✓ 始终可信 | CSS width/height |
| `rel[0,1]` | dx, dy 相对直接父位移 | ✓ 始终可信 | Figma 面板 X/Y、Flex 内偏移 |
| `layout` | Flex 语义（dir/gap/pad/main/cross） | ✓ 始终可信 | Flex/Grid 还原 |
| `isSwap` / `isFromSwapParent` | 该节点（或祖先）是设计师 swap 进来的 | — | **仅语义提示**，不影响坐标可信度 |
| `relAnchorId` | swap 节点最近的非 swap 祖先 area id | — | 仅人工 review 溯源 |

> **关于 swap 标记**：`flatCollect` 已合并 3 处位置数据（自身 transform + SYMBOL 内子节点 transform + INSTANCE.derivedSymbolData / symbolOverrides），并按 horizontal/verticalConstraint 处理 INSTANCE size 覆盖。无论是否 swap 节点，`at/rel` 都与 Figma 设计面板一致。`isSwap` / `isFromSwapParent` 保留下来仅供"想知道哪些节点是设计师替换进来的"时人工查阅，**不要据此切换到截图兜底或父容器重算**。

### 节点状态速查

| 来源 | at | rel | layout | 处理策略 |
|------|----|----|--------|---------|
| 任意节点（普通 / swap / swap 内部） | ✓ | ✓ | ✓ | 直接用——按场景择优：绝对定位用 `at`，Flex 内用 `rel`/`layout` |

---

## 工作流程

### 步骤 1：素材审查（编码前必须）

**逐张查看素材内容，建立映射表：**

```
素材文件名 → 包含内容 → 是否整体使用
bg_xxx.png → 完整背景(含渐变/黑板) → 直接做容器背景，不拆
按钮.png → 按钮+文字 → 整体<img>，不拆文字
标题.png → 图标+文字 → 整体<img>，不拆文字
卡片.png → 背景+胶带 → 背景用素材，文字CSS
```

**正确流程（视觉稿驱动）：**

```
看视觉稿识别元素 → 查素材是否包含该元素 → 是则整体用，不重复实现
```

**示例：**

| 视觉稿元素 | 素材检查 | 错误做法 | 正确做法 |
|-----------|---------|---------|---------|
| "立即开始"按钮 | 操作按钮.png 已含文字+背景 | 素材+额外文字div | 整体`<img>`，不拆文字 |
| 黑板背景 | bg.png 已是完整背景 | 素材+.blackboard+gradient | 直接`background:url(bg.png)` |
| 标题"我的目标" | 标题.png 已含图标+文字 | 分开写img+h1 | 整体`<img>` |
| 卡片背景 | 卡片.png 只含背景 | 素材+不写字 | 素材背景+CSS文字 |

**原则：** 素材包含该元素**全部视觉内容** → 整体使用；素材只含部分 → 补充实现缺失部分

### 步骤 2：元素识别（截图驱动）

**看截图 → 列元素清单：**

```
截图可见元素：
1. 返回按钮（左上，圆形）
2. 设置按钮（右上）
3. 标题"我的目标"（顶部）
4. 副标题文字
5. 三个卡片
...
```

**查 JSON → 找精确数据：**

1. **按文字定位**（最可靠）
2. **按 comp 辅助**（组件变体名）
3. **按坐标兜底**（无文字元素）

### 步骤 3：定位策略选择

`at` / `rel` / `layout` 都可信，按场景择优：

| 场景 | 推荐字段 | 写法 |
|------|---------|------|
| 顶层容器 / 跨容器节点的绝对定位 | `at[0,1]` | `position:absolute; left:at[0]; top:at[1]` |
| 父容器内的子元素，且父用 Flex/Grid | 不写坐标，让 layout 排 | 父容器写 `display:flex` + `gap` + `pad`；子写尺寸 |
| 子元素相对父的偏移（父非 Flex） | `rel[0,1]` | `position:absolute; left:rel[0]; top:rel[1]`（父需 `position:relative`） |
| 两个非父子节点的相对距离 | 用 `at` 计算差值 | `delta = b.at[0] - a.at[0]` |

> **swap 节点没有特殊待遇**——直接当普通节点处理。无需向上找"非 swap 祖先"或做"链式偏差兜底"。

### 步骤 3.5：层级链追溯（关键防漏）

**目标节点确定后，必须完成层级链追溯：**

```
目标节点（如按钮）
    ↓
查看 parentId → 找到直接父节点
    ↓
记录该节点信息（name/at/layout）
    ↓
重复直到 depth=0（顶层容器）
    ↓
生成层级映射表
```

**层级映射表（必填）：**

| 层级 | 节点 ID | 节点名称 | 尺寸 | 是否有 layout | 代码对应 |
|------|---------|----------|------|---------------|----------|
| 顶层 | f0-a1 | 无形象对话 | 1104x240 | ❌ | `.bottom-actions` |
| 中间 | f0-a2 | 1个矩形按钮 | 818x88 | ✅ main:center | `.button-container` |
| 目标 | f0-a3 | 操作按钮 | 160x64 | - | `.start-btn` |

**⚠️ 遗漏层级的后果：**
- 代码层级数 < JSON 层级数 → 布局错乱
- 跳过带 `layout` 的节点 → flex/grid 用在错误容器
- 直接拿子节点的 `at` 当坐标 → 定位基准错误

**红线规则：**
- ❌ **禁止跳过任何层级节点**（无论是否有 layout）
- ❌ **禁止给无 layout 的节点加 flex/justify/align**
- ✅ **代码层级数必须等于 JSON 层级数**

### 步骤 4：文字节点处理

**文字节点 `texts: [{t: "...", at: [...]}]` 禁止直接渲染！**

```
发现文字节点
        ↓
向上找父容器（FRAME/INSTANCE）
        ↓
检查素材是否包含该文字
        ↓
├─ 素材包含 → 整体用素材，不写文字节点
│   例：操作按钮.png 含"立即开始" → 只放<img>
│
└─ 素材不包含 → 用父容器尺寸 + CSS 写文字
    尺寸取父容器 at[2,3]，不是文字 at[2,3]
```

**文字节点错误：**
```css
/* ❌ 错：直接用文字的 at */
.text {
  left: 419px;  /* 这是文字排版位置 */
  width: 62px;  /* 这是文字宽度 */
}

/* ✅ 对：找父容器 */
.button {
  width: 160px;  /* 父容器尺寸 */
  height: 64px;
  /* 文字在内部自然居中 */
}
```

### 步骤 5：坐标换算

**每次用 at[0,1] 前回答：**

```
□ 这个坐标相对谁？（JSON 中 at 是 frame 原点）
□ CSS 定位上下文是谁？（最近 position:relative/absolute 祖先）
□ 两者一致吗？
   ├─ 一致 → 直接用 at[0,1]
   └─ 不一致 → 改用 rel[0,1]，或 css_left = el.at[0] - container.at[0]
□ 父容器已经定位了吗？→ 子元素用 Flex/rel，不再用全局坐标
```

---

## 布局与尺寸

### layout → CSS 映射

| layout | CSS |
|--------|-----|
| `dir: 'h'` | `flex-direction: row` |
| `dir: 'v'` | `flex-direction: column` |
| `gap` | `gap` |
| `pad: [t,r,b,l]` | `padding: t r b l` |
| `main: 'center'` | `justify-content: center` |
| `main: 'end'` | `justify-content: flex-end` |
| `cross: 'center'` | `align-items: center` |

### 尺寸优先级

1. **素材 = JSON 尺寸** → 直接用 JSON at[2,3]
2. **素材 ≠ JSON 尺寸** → 以素材为准，调整定位
3. **仅 JSON 无素材** → 用 JSON at[2,3]，⚠️ 报告

### 父容器边界

- 顶层容器（depth=0）→ 用 at[2,3] 定页面大小
- 子节点溢出父节点 → 忽略，不影响外层

---

## 风险报告（强制输出）

实现完成后必须扫描所有节点，发现以下情况即报告。

> **注意**：v3.0 起 swap 不再属于风险类型——位置已合并所有 override，可直接信任。剩余风险全是"素材/数据本身的问题"。

**常见风险类型：**

| 类型 | 触发条件 | 报告示例 |
|------|---------|---------|
| 素材尺寸不匹配 | 素材尺寸 ≠ JSON at[2,3] | ⚠️ f0-a7(讲话随机): 素材(400x600)≠JSON(292x490)<br>代码位置: `.teacher-image` ~L230<br>处理: 以素材为准 |
| 负坐标 | at[0]或 at[1] < 0 | ⚠️ f0-a7(讲话随机): at[0]=-140（设计上有意溢出）<br>代码位置: `.teacher-image img` ~L244<br>处理: 调整为0或裁剪显示 |
| 无素材 | 仅有 JSON 无素材 | ⚠️ f0-a32(左图标): 无素材<br>代码位置: 未引用素材<br>处理: CSS自绘或补充素材 |
| 文字/容器混淆 | 直接用文字 at | ⚠️ f0-a31(内容): 文字at直接渲染<br>代码位置: `.btn-text`<br>处理: 改用父容器 at[2,3] |
| 父级无 layout 但需排子 | 子元素需要 Flex 排列但父级缺 `layout` | ⚠️ f0-a1(无形象对话): 无 layout，子用 at-at 反推差值<br>代码位置: `.dialog-container` ~L164<br>处理: 用绝对定位 + at 差值，已校对截图 |

**报告模板：**

```
⚠️ UI 实现风险报告
═══════════════════════════════════════════════════════════════════════

### 风险扫描结果概览

| 节点ID | 节点名称 | 风险类型 | 代码位置 | 状态 |
|--------|---------|---------|----------|------|
| f0-a7  | 讲话随机 | 素材尺寸不匹配 | `.teacher-image` ~L230 | ✅ 已处理 |
| f0-a32 | 左图标   | 无素材         | 未引用      | ⚠️ 需用户确认 |

### 详细说明

① f0-a7 节点（讲话随机）
节点名称: 讲话随机
风险类型: 素材尺寸不匹配
JSON: at=[-140, 220, 528, 810]
素材: teacher.png (400x600)

【代码位置】
文件: GoalPage.html
行号: ~230
CSS选择器: .teacher-image

AI处理: 以素材尺寸 400x600 为准，按截图视觉对齐
建议: 请确认讲师形象完整显示，无明显裁剪

═══════════════════════════════════════════════════════════════════════
```

**报告输出规范：**

1. **节点标识**: 必须同时输出 `节点ID` 和 `节点名称`（从 JSON name 字段获取）
2. **代码位置**: 必须包含：
   - 文件路径
   - 行号范围（用 `~L123` 表示）
   - CSS选择器（如 `.start-btn`）
3. **定位代码片段**: 展示实际使用的 CSS/JSX 代码，并标注数据来源（如 `/* f0-a1 at[0] */`）

---

## 自检清单

### 编码前（全部 ✓ 才能写）

```
□ 逐张查看素材，建立映射表
□ 截图元素清单已列出，与 JSON 节点一一对应
□ 所有文字节点已追溯父容器
□ 层级链追溯完成（关键）
  □ 目标节点到顶层节点的完整链条已记录
  □ 层级映射表已填写（含 layout 标记）
  □ 代码层级数 = JSON 层级数
□ 父容器边界校验（确认顶层容器尺寸）
```

### 编码中（每条都要检查）

```
□ 截图有 → 写了 HTML 元素
□ 素材有 → 没 CSS 绘制
□ 素材=完整背景 → 没加 .blackboard/.gradient
□ 文字节点 → 用的父容器 at[2,3]
□ 坐标换算 → 减了容器偏移，或改用 rel
□ 尺寸 → 来自 at[2,3] 或素材
```

### 编码后（全部 ✓ 才算完成）

```
□ 素材与 JSON 尺寸不一致处已调整
□ 所有素材用 <img> 引入，无 CSS/SVG 自造
□ 坐标换算正确
□ 无文字 at 直接渲染
□ 风险报告已输出（含所有风险点）
□ 自检清单回答已记录
```

---

## Guardrails（红线）

1. **截图决定存在** → JSON 有但截图没有，禁止渲染
2. **素材包含不复现** → 素材已有，不 CSS 绘制
3. **素材=完整设计** → 直接做背景，不加中间元素
4. **JSON 定尺寸** → at[2,3] 始终可信
5. **JSON 定坐标** → at/rel/layout 已合并所有 override，按场景择优；swap 节点无需特殊处理
6. **父容器定内部** → 子元素用 Flex/rel，不重复用父级全局坐标
7. **文字追父容器** → 不直接用文字 at
8. **处理即风险** → 任何 AI 介入处理（素材尺寸不一致、负坐标、缺素材等）都要报告

---

## 错误案例（防再犯）

### 案例 1：背景元素重复实现
```
错误：bg_1V1提升课800.png 已是完整背景
      我又加 .container gradient + .blackboard

正确：直接 background: url(bg.png)，其他都不要
```

### 案例 2：文字 坐标 误用
```
错误：文字节点 at=[419,676,62,30]
      我直接用在 .text { left:419px; width:62px }

正确：向上找父容器 at[2,3]=160x64
      用父容器尺寸，素材含文字整体用
```

### 案例 3：父级坐标复用
```
错误：父容器 top:560px
      子元素又写 top:560px（相对父应该是 0）

正确：父容器 top:560px
      子元素在父内部用 Flex/rel，不写 top
      或写 top:0 / 用 rel[1]（相对父）
```

### 案例 4：误以为 swap 节点要特殊处理
```
错误：节点 isSwap=true，我假设它的 at 不可信，
      跑去找非 swap 祖先 + layout 兜底，反而搞错位置

正确：v3.0 起 at/rel 已合并 swap override 与 INSTANCE size 覆盖，
      swap 节点直接当普通节点用 at/rel 即可。
      isSwap 标记仅作语义提示。
```

### 案例 5：跳过层级导致布局错误（本例）

**JSON 结构（三层）：**
```
f0-a1 (无 layout, at=[164,560,1104,240]) 
  └── f0-a2 (有 layout={main:center}, at=[307,676,818,88])
        └── f0-a3 (目标按钮, at=[307,676,160,64])
```

**❌ 错误代码（两层，跳过 f0-a2）：**
```css
.bottom-actions {  /* f0-a1 本无 layout */
    position: absolute;
    left: 164px;
    top: 560px;
    width: 1104px;
    height: 240px;
    display: flex;           /* 错误：越级加 flex */
    justify-content: center; /* 错误：这是 f0-a2 的 layout */
}
.start-btn {        /* f0-a3 */
    width: 160px;
    height: 64px;
}
```

**✅ 正确代码（三层匹配 JSON）：**
```css
.bottom-actions {      /* f0-a1 - 无 layout，普通容器 */
    position: absolute;
    left: 164px;
    top: 560px;
    width: 1104px;
    height: 240px;
}
.button-container {    /* f0-a2 - 有 layout，flex 居中 */
    position: absolute;
    left: 143px;  /* rel[0] */
    top: 116px;   /* rel[1] */
    width: 818px;
    height: 88px;
    display: flex;
    justify-content: center;
    align-items: center;
}
.start-btn {           /* f0-a3 - 按钮本身 */
    width: 160px;
    height: 64px;
}
```

**后果：**
- 跳过 `f0-a2` 导致 flex 布局加在错误的父容器上
- 按钮位置和居中行为不符合设计意图

---

## 输出示例

### 实现中输出
```
## 正在实现 UI 还原

素材映射：
- bg.png → 完整背景（直接做容器背景）
- 按钮.png → 按钮+文字（整体<img>）
- 卡片.png → 背景（文字CSS）

节点识别：
- 父级 f0-a1 at=[164,560,1104,240] layout={main:center,cross:center}
- 子按钮 f0-a3 at[2,3]=160x64，rel=[143,116]

处理策略：
- 父级用 at 全局定位
- 内部走父级 layout，子按钮按 rel 微调（或直接 Flex 居中）
- 素材整体使用
```

### 风险报告输出
```
⚠️ UI 实现风险报告
═══════════════════════════════════════════════════
发现 1 处风险：

① [GoalPage.html:89] 讲师形象
   风险: JSON at[0]=-140（负坐标，设计上有意溢出），素材尺寸≠JSON
   AI已处理: 以素材尺寸为准，left 从 -140 调整为 0
   建议: 请确认讲师完整显示，无截断
═══════════════════════════════════════════════════
```

### 零风险输出
```
✅ 实现风险扫描完成，未发现需要 AI 介入处理的风险点
   （所有尺寸、坐标、素材均与 JSON 一致）
```
