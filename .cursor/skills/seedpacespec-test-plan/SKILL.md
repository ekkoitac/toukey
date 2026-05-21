---
name: seedpacespec-test-plan
id: seedpacespec-test-plan
category: Quality
description: >
  为变更涉及的公共模块生成单元测试，支持运行测试和回归检测。
  TRIGGER when: （当前会话已使用过 seedpacespec/sdx 工作流，或用户消息明确提到 seedpacespec/sdx）且用户说"补个测试"、"写单测"、"生成测试用例"、"跑一下测试"。
  SKIP: 用户想做业务缺陷检测不是写测试（用 sdx-detect）；用户还没开始实现代码（先用 sdx-apply）。
  requires: seedpacespec/changes/active-change/<name>/ 下存在 TRD + 已实现的代码。
  output: 单元测试文件 + 可选的运行结果报告。
  examples: "给这次变更的公共组件补测试" → 触发；"怎么写 Jest 测试" → 不触发。
---

为 seedpacespec 变更涉及的**公共模块**生成**单元测试**。

**核心定位**：单元测试聚焦**公共模块**——公共组件、公共工具函数、公共逻辑类、共享服务等被多处业务依赖的模块。这些模块修改后波及面广，测试 ROI 最高。普通业务逻辑（仅在单一业务域内使用的组件、页面、流程）不在本 skill 的测试范围内。

## Plugin Protocol

执行本 skill 前，先读取 `seedpacespec/config.yaml` 的 `plugins` 配置。

**override**：若 `plugins.override.test-plan` 存在 → **停止执行本文件**，改为加载指定文件。

**slots**：本 skill 暴露以下插槽，可在 `config.yaml` 的 `plugins.slots` 中挂载自定义 skill：

| 插槽名 | 位置 | 类型 | 说明 |
|--------|------|------|------|
| `after_targets_identified` | 可测目标确认后，测试生成前（Step 2 之后） | hook | 可用于自定义筛选规则、额外测试目标注入 |
| `test_generation_strategy` | Step 3 测试生成策略（3.1 ~ 3.3） | content | 可替换默认的测试生成原则和结构 |
| `after_tests_executed` | 测试运行完毕后（Step 4 之后） | hook | 可用于测试报告后处理、覆盖率上报 |

**执行规则**：流程中遇到 `<!-- slot:名字 -->` 标记时，检查 `plugins.slots` 是否有匹配的 `skill: test-plan` + `slot: 名字` 条目 → 有则加载 `run` 指定的文件执行，完毕后回到主流程继续 → 无则跳过。对于 content slot（`<!-- slot:xxx -->...<!-- /slot:xxx -->`），有匹配时用外部文件内容替换包裹的默认内容。

若无 `plugins` 配置 → 正常执行，无任何变化。

---

## State Machine Gates

**任何状态未完成 → 只能 AskQuestion，不得跳入后续步骤。**

| # | 状态 | 完成条件 |
|---|------|---------|
| G1 | `inputs_collected` | 变更已选定、PRD/TRD 路径已确认 |
| G2 | `targets_identified` | 可测目标已识别，用户已确认测试范围 |
| G3 | `tests_generated` | 测试代码已生成 |
| G4 | `tests_executed` | 测试已运行（可选），结果已报告 |

G1→G2→G3→G4 单向推进。G4 为可选步骤。


**🚫 禁止编造跳过理由**：AI 不得以任何自创名义（如恢复协议、追加模式、精简流程、复用已有产物、简化模式等）跳过门禁。所有门禁必须逐一通过并产出可验证输出。如果你发现自己正在向用户提议跳过某个门禁——立即停止并按正常流程执行。
---

## Step 1. 收集输入（→ G1）

缺失时用 **AskQuestion** 收集：

| 信息 | 来源 | 必需 |
|------|------|------|
| **变更名** | 用户提供 或 `seedpacespec list --json` 选择 | ✅ |
| **Git 比较基准** | 用户提供（如 `main`、`HEAD~5`），或从变更产物推断 | ✅ |
| **PRD 路径** | 变更目录下自动探测 | 可选（有则用于手动测试用例的业务背景描述） |
| **TRD 路径** | 变更目录下自动探测 | 可选（有则辅助识别变更意图；无则纯依赖 git diff） |
| **测试框架** | 从 architecture.md 或项目配置自动识别 | 自动 |

**自动探测**：
```
变更目录 = seedpacespec/changes/active-change/<变更名>/
PRD: specs/*-prd.md → *_prd.md → AskQuestion
TRD: trds/*.md → *_trd.md → AskQuestion
```

**测试框架识别**：

1. 检查项目是否已安装测试框架：
   - 查看 `pubspec.yaml` 的 dev_dependencies / `package.json` 的 devDependencies / `pyproject.toml` 等
   - 查看是否已有 `test/` 目录和测试文件

2. **已安装** → 若检测到**单一**框架（如只有 jest 或只有 vitest），直接使用。若检测到**多个**测试框架并存（如 jest + vitest），**必须 AskQuestion** 让用户选择使用哪个：
   - Flutter/Dart → `flutter_test` / `mockito` / `bloc_test`
   - React/Vue → `jest` / `vitest` / `testing-library`
   - Python → `pytest`
   - Go → `testing`（内置，无需安装）

3. **未安装** → **AskQuestion**：
   ```
   当前项目未检测到单元测试框架。要生成测试需要先安装。

     A) 帮我安装推荐的测试框架（{根据技术栈推荐}）
     B) 我自己安装，告诉我需要装什么
     C) 跳过测试生成
   ```
   - 选 A → 自动执行安装命令（如 `flutter pub add --dev mockito build_runner`、`npm install -D jest`），创建基础配置文件
   - 选 B → 列出推荐的依赖和配置步骤，等用户装好后继续
   - 选 C → 流程终止

---

## Step 2. 识别公共模块测试目标（→ G2）

从**实际代码变更**出发，结合 architecture.md 风险热点和公共模块数据，筛选出需要测试的目标。

### 2.1 获取实际变更文件列表（第一优先级：git 工作区）

本 skill 的典型使用场景是 **apply 完成后**（代码已改），因此**以 git 实际变更为第一数据源**：

```bash
# 已 commit 的变更（相对于变更起点）
git diff <base>..HEAD --name-only

# 未 commit 的变更（工作区 + 暂存区）
git diff --name-only
git diff --cached --name-only
```

**base 的确定**：
1. 用户指定（如 `main`、某个 commit hash）→ 直接使用
2. 未指定 → 读取变更目录 TRD/design 中的基准信息，或 **AskQuestion** 让用户选择比较起点（展示最近分支和 commit 列表，同 defect-detect Step 1 的交互方式）

**取三者并集**（已 commit + 未 commit + 暂存），去重后得到本次变更的全部文件列表。

**若 git diff 为空**（如刚 propose 还没 apply）：退回从设计文档推断，但标注「基于设计文档推断，非实际代码变更」：

1. 读取 **design.md**「模块与文件结构（树状图）」章节，提取树中标注为 `[新增]` 或 `[修改]` 的文件路径；若无标注则取树中所有文件
2. 读取 **TRD** 各 §4.x 章节中引用的文件路径（如 `src/utils/formatter.ts`、`lib/core/api_client.dart`），提取所有出现的源码文件路径
3. 两者取并集作为「预计变更文件列表」
4. 后续流程照常与 architecture.md 做交集筛选，但在用户确认步骤中标注「⚠️ 以下为设计文档推断，实际变更以代码为准」

### 2.2 公共模块筛选（利用 architecture.md）

**必读 architecture.md 以下章节**：

| 章节 | 用途 |
|------|------|
| **§9.2 公共模块被引用 TOP 10** | 直接获取项目中最关键的公共模块清单及引用方 |
| **§9.2 全局状态依赖** | 识别被多处消费的全局状态对象 |
| **§9.2 耦合热点** | 被引用次数 TOP 15 的文件——高耦合 = 高测试 ROI |
| **§9.5 交叉风险矩阵** | 命中 ≥2 项风险信号的文件——最需要测试保护 |
| **§9.4 高频变更文件** | 频繁修改的公共模块更需要回归测试 |

**将 2.1 的变更文件列表与 architecture.md 做交叉匹配**，分为两类输出：

**A. 公共模块（生成自动化单元测试）**

满足任一判定规则即为公共模块：
- 出现在 architecture.md §9.2 公共模块被引用 TOP 10 中
- 出现在 architecture.md §9.2 耦合热点中（被引用 ≥5 次）
- 位于项目公共目录（如 `utils/`、`common/`、`shared/`、`components/common/`、`lib/core/` 等）
- 是基类（base class）、Mixin、共享接口
- 被 ≥3 个不同业务域引用（从 §9.2 跨域依赖中交叉验证）

**B. 风险热点文件（生成手动测试用例）**

变更文件命中 architecture.md §9 任一风险热点：
- §9.1 大文件（>500 行）
- §9.2 耦合热点（不满足公共模块条件但被引用较多）
- §9.5 交叉风险矩阵命中 ≥2 项

**不作为测试目标**的文件：
- 仅在单一页面/业务域内使用的组件、Hook、Bloc（且未命中任何风险热点）
- 普通业务页面的渲染逻辑
- 直接透传的 repository / API 调用

### 2.3 按优先级排序

| 优先级 | 条件 | 说明 |
|--------|------|------|
| **P0 必测** | 命中 §9.5 交叉风险矩阵（≥2 项风险信号） | 高风险公共模块，修改后最易引发回归 |
| **P0 必测** | 出现在 §9.2 TOP 10 且本次有签名/语义变更 | 被广泛依赖的公共模块发生接口变更 |
| **P1 推荐** | 出现在 §9.2 耦合热点 | 高耦合但本次变更较小 |
| **P1 推荐** | 公共工具函数/数据转换（fromJson/toJson、格式化、计算） | 易出错且影响面广 |
| **P2 可选** | 其他符合公共模块判定规则的目标 | 低风险公共模块 |

对每个公共模块目标，从 architecture.md §9.2 获取其**引用方列表**，作为后续测试契约验证的依据。

### 2.4 用户确认

用 **AskQuestion** 展示识别结果（分两类），让用户确认/调整：

```
本次变更共涉及 15 个文件，其中：

📦 公共模块（生成自动化单元测试）：

🔴 P0 必测（高风险/高依赖）：
  1. DateFormatter (utils/date_formatter.ts) — 被 12 处引用，本次修改了 format() 签名
     命中: §9.2 TOP 10 + §9.5 交叉矩阵 3 项
  2. BaseApiClient (core/api_client.ts) — 被 8 处引用，新增重试逻辑
     命中: §9.2 TOP 10

🟡 P1 推荐：
  3. PriceCalculator (utils/price.ts) — 被 5 处引用
  4. PermissionChecker (core/permission.ts) — 被 6 处引用

⚠️ 风险热点文件（生成手动测试用例）：
  5. OrderDetailPage — 命中 §9.1 大文件（新增了 BottomSheet，涉及 pop 逻辑）
  6. PaymentBloc — 命中 §9.4 高频变更（异步支付流程）
  7. NotificationService — 命中 §9.2 耦合热点（新增事件监听方）

ℹ️ 已排除 8 个普通业务文件（无公共模块特征、未命中风险热点）

请选择：
  A) 全部生成（公共模块单元测试 + 风险热点手动用例）（推荐）
  B) 仅公共模块单元测试
  C) 仅手动测试用例
  D) 自选
```

> **📋 测试范围 用户可见文案模板**（禁止显示"D) 自选"等简写）：
> - question: "本次变更涉及以下模块，请选择测试生成范围："
> - option 1: label="全部生成（推荐）" description="同时生成公共模块的单元测试和风险热点的手动测试用例"
> - option 2: label="仅生成单元测试" description="只为公共模块生成自动化单元测试"
> - option 3: label="仅生成手动测试用例" description="只为风险热点生成手动验证清单"
> - option 4: label="自己选择测试目标" description="手动指定要为哪些模块生成测试"

<!-- slot:after_targets_identified -->

---

## Step 3. 生成单元测试（→ G3）

<!-- slot:test_generation_strategy -->
### 3.1 测试生成原则

- **一个公共模块一个测试文件**；测试文件目录：优先从项目已有测试文件推断目录结构（同目录 `__tests__/` 或根级 `test/` 镜像）；若项目无已有测试文件可参考，**必须 AskQuestion**：「测试文件放在哪里？」选项：A）与源文件同目录；B）`test/` 镜像目录；C）自定义路径

> **📋 测试文件位置 用户可见文案模板**：
> - question: "测试文件放在哪里？"
> - option 1: label="与源文件同目录" description="在源文件旁边创建 __tests__ 目录"
> - option 2: label="test/ 镜像目录" description="在项目根目录的 test/ 下按源码目录结构镜像"
> - option 3: label="自定义路径" description="指定一个自定义的测试文件存放路径"

- **测试用例聚焦公共契约**：公共模块的 API 签名、返回值类型、异常抛出、边界行为——这些是调用方依赖的契约
- **必须覆盖边界和异常**：空值、零值、最大值、无效输入、类型边界
- **命名清晰**：`test('format() 传入 null 时应返回空字符串', ...)`
- **Mock 外部依赖**，不 Mock 被测对象自身
- **遵循项目现有测试风格**（从已有测试文件推断 import 惯例、mock 方式、断言风格）

### 3.2 测试结构

对每个公共模块，生成以下结构的测试：

```
describe/group: {公共模块名}
  ├── 公共 API 契约验证
  │   ├── test: {方法 A 正常输入返回预期结果}
  │   ├── test: {方法 B 正常输入返回预期结果}
  │   └── ...
  ├── 边界与防御
  │   ├── test: 空值/null/undefined 处理
  │   ├── test: 极端值/最大最小值
  │   ├── test: 类型边界（如空数组、空对象）
  │   └── test: 无效输入不崩溃（graceful degradation）
  ├── 回归保护（本次变更相关）
  │   ├── test: 修改前行为仍然正确（防回归）
  │   └── test: 新增/修改的行为正确
  └── 调用方兼容性（从 architecture.md §9.2 获取引用方信息）
      ├── test: 签名变更后，典型调用模式仍然兼容
      └── test: 默认值变更后，未传参调用方行为不变
```

### 3.3 公共模块测试重点

根据公共模块类型，测试侧重点不同：

| 公共模块类型 | 测试重点 | 测试信号来源 |
|-------------|---------|-------------|
| **工具函数（utils/helpers）** | 输入输出契约、边界处理、幂等性 | architecture.md §9.2 引用方列表 |
| **基类/Mixin** | 子类契约不变、扩展点行为、抽象方法签名 | architecture.md §4 核心业务域关键抽象 |
| **公共组件** | Props/参数契约、事件回调签名、默认行为 | architecture.md §9.2 耦合热点引用方 |
| **共享服务/状态** | 状态转换正确性、事件处理、并发安全 | architecture.md §9.2 全局状态依赖 |
| **数据模型（共享）** | 序列化/反序列化、字段默认值、向后兼容 | architecture.md §4 核心业务域领域模型 |

**回归保护（每个公共模块必做）**：
- 先测试**修改前的行为仍然正确**——从 architecture.md §9.2 获取引用方列表，确保引用方依赖的行为未被破坏
- 再测试**本次变更新增/修改的行为**
- 若本次有**签名变更**或**默认值变更**——必须添加调用方兼容性测试
<!-- /slot:test_generation_strategy -->

### 3.4 手动测试用例（无法自动化的场景）

对 Step 2.2 B 类（风险热点文件）中命中的场景，生成**结构化手动测试用例**，写入变更目录的 `manual-test-cases.md`。

这些场景涉及运行时上下文（导航栈、弹层交互、异步时序、全局事件、生命周期等），单元测试无法覆盖，需要用户手动验证。

**手动测试用例的来源**：
- 变更文件中实际存在的运行时上下文依赖（如 `pop()`、`emit()`、未 await 的异步调用、未检查 mounted 的回调等代码模式），需实际 grep 变更文件确认
- architecture.md §9.3 平台/环境差异分支——变更文件若命中，生成多环境测试用例

**手动测试用例格式**：

```markdown
# 手动测试用例 — <change-name>

> 以下场景无法通过单元测试自动验证，需人工操作确认。
> 来源：TRD + 变更文件中的运行时上下文依赖模式

## 场景 1: <场景名称>

**风险类型**: 导航栈依赖 / 执行顺序依赖 / 隐式监听耦合 / 生命周期跨越
**涉及文件**: `path/to/file.ts:functionName`
**关联需求**: R-XXX

**前置条件**:
- <操作步骤 1>
- <操作步骤 2>

**测试步骤**:
1. <具体操作>
2. <具体操作>
3. <具体操作>

**预期结果**:
- <应该发生什么>

**风险场景（重点关注）**:
- <什么情况下可能出错，如：新增了 BottomSheet 后，原有双次 pop 是否错位>
```

**生成规则**：
- 从变更文件中 grep 运行时上下文依赖模式（如 `pop(`、`emit(`、未 await 的异步调用），与本次 git 变更文件交叉匹配
- **必须 grep 变更文件的实际代码**确认风险模式存在（如 `pop(`、`emit(`、异步调用链），不凭 architecture.md 记录猜测
- 每个场景的测试步骤必须**具体到用户操作**（点击什么按钮、进入什么页面、在什么时机做什么），不能是抽象描述
- 风险场景要说明**为什么可能出错**（如"新增弹层改变了栈深度""异步操作未 await 导致时序错误"）
- 若变更文件命中多个风险子类，合并到同一场景中（避免重复操作路径）

**若无需手动测试的场景**：不生成此文件，在输出摘要中说明"未发现需手动测试的场景"。

### 3.5 生成输出

测试文件写入项目中（遵循项目的测试目录结构），并展示摘要：

```
✅ 公共模块单元测试已生成

自动化测试：
  ├── test/utils/date_formatter_test.dart (10 cases) — 被 12 处引用
  ├── test/core/api_client_test.dart (8 cases) — 被 8 处引用
  └── test/utils/price_calculator_test.dart (6 cases) — 被 5 处引用

总计: 3 个公共模块, 24 个测试用例
  - API 契约验证: 12
  - 边界与防御: 7
  - 回归保护: 3
  - 调用方兼容性: 2

⚠️ 手动测试用例（需人工验证）：
  └── manual-test-cases.md (3 个场景)
      - 场景 1: 新增 BottomSheet 后 pop 栈深度验证（导航栈依赖）
      - 场景 2: 保存后刷新的异步时序（执行顺序依赖）
      - 场景 3: 页面销毁后网络回调安全性（生命周期跨越）
```

---

## Step 4. 运行测试（→ G4，可选）

生成完毕后 **AskQuestion**：

```
测试已生成，是否现在运行？

  A) 运行全部新生成的测试
  B) 运行项目全部测试（含已有测试，检查回归）
  C) 暂不运行
```

> **📋 运行测试 用户可见文案模板**：
> - question: "测试文件已生成，是否现在运行？"
> - option 1: label="运行新生成的测试" description="只运行本次新生成的测试文件"
> - option 2: label="运行全部测试" description="运行项目中所有测试，检查是否有回归"
> - option 3: label="暂不运行" description="稍后手动运行测试"

### 4.1 执行

根据技术栈执行对应命令：
- Flutter: `flutter test {test_files}`（仅新生成）或 `flutter test`（全部）
- JS/TS: `npx jest {test_files}` 或 `npx jest`
- Python: `pytest {test_files}` 或 `pytest`
- Go: `go test {packages}`

### 4.2 结果报告

```
✅ 测试运行完成

结果: 19 passed, 0 failed, 0 skipped

或：

⚠️ 测试运行完成

结果: 17 passed, 2 failed, 0 skipped

失败的测试：
  ❌ PriceCalculator: '当折扣为0时应返回原价' — Expected 100, got 0
  ❌ HomeBloc: '初始状态应为loading' — Expected HomeLoading, got HomeInitial

可能原因：
  - PriceCalculator: 折扣为0时的边界条件未处理
  - HomeBloc: 初始状态与 TRD 规格不一致
```

若有失败，**AskQuestion**：
```
有 2 个测试失败，可能是代码缺陷或测试预期需要调整。

  A) 查看失败详情，分析是代码问题还是测试问题
  B) 修复代码中的问题（转入 /sdx-apply 流程）
  C) 调整测试预期（如果是测试写错了）
  D) 暂时跳过，稍后处理
```

<!-- slot:after_tests_executed -->

---

## 与 /sdx-apply 的集成

当 `/sdx-apply` 完成任务后，如果变更目录下已有单元测试（由本 skill 生成），apply 流程中 **AskQuestion**：

```
检测到该变更已有单元测试（N 个文件，M 个 case）。
本次修改可能影响测试结果，是否运行一下？

  A) 运行全部测试（检查回归）
  B) 暂不运行
```

这确保每次修改后都有机会跑测试验证，及时发现回归。

---

## Guardrails

- **状态机 G1→G4 是 ASSERTION**：G1 未完成 → 禁止生成测试
- **仅测试公共模块**：公共组件、公共工具函数、公共逻辑类、共享服务、基类/Mixin。普通业务逻辑（仅在单一业务域内使用的组件、页面、流程）不生成单元测试
- **必须利用 architecture.md 数据**：§9.2 耦合热点确定哪些是公共模块及其引用方，§9 风险热点确定测试优先级。未读 architecture.md 不得进入 G2
- **聚焦单元测试**：不生成 UI 测试、集成测试、E2E 测试
- **遵循项目现有测试风格**：import 惯例、mock 方式、断言库、目录结构
- **G4 为可选**：用户可以选择不运行
- **测试失败不自动修复代码**：报告结果，由用户决定下一步
