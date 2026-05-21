# seedpacespec

Spec-driven development CLI for AI coding assistants.

文档驱动 AI 编码的结构化开发框架。核心命题：**让 AI 按人类工程师的节奏写代码——先理解架构，再做设计，最后精确到代码实体**。

---

## 安装

### 全局安装（推荐）

```bash
npm i seedpacespec@latest -g --registry=https://artifactory.gz.cvte.cn/artifactory/api/npm/cvte-npm-registry/
```

### 项目内安装

```bash
npm i seedpacespec --save-dev --registry=https://artifactory.gz.cvte.cn/artifactory/api/npm/cvte-npm-registry/
```

### 使用 npx（无需全局安装）

```bash
npx --no-install seedpacespec <command>
# 或
npm exec seedpacespec <command>
```

---

## CLI 命令

| 命令 | 功能 | 示例 |
|------|------|------|
| `init [--force] [--force-hooks]` | 初始化项目；若存在 `.git` 会安装 **pre-push** 钩子（控制台输出） | `seedpacespec init` |
| `hooks install [--force]` | 单独安装/覆盖 **pre-push** 钩子 | `seedpacespec hooks install` |
| `new change "<name>"` | 创建新变更 | `seedpacespec new change "feat-login"` |
| `status --change "<name>" [--json]` | 查看变更产物状态 | `seedpacespec status --change "feat-login"` |
| `instructions <id> --change "<name>"` | 获取产物生成指令 | `seedpacespec instructions trd --change "feat-login"` |
| `list [--json]` | 列出所有活跃变更 | `seedpacespec list` |
| `update` | 重新生成 .cursor/ 和 .claude/ | `seedpacespec update` |
| `--version, -v` | 显示版本 | `seedpacespec -v` |
| `--help, -h` | 显示帮助 | `seedpacespec --help` |
| `--where` | 显示 CLI 路径（排查安装问题） | `seedpacespec --where` |

### Git `pre-push`（控制台自检）

- `init` 或 `hooks install` 会在 `.git/hooks/pre-push` 写入由 seedpacespec 管理的脚本：**先 `cat` 消费 Git 传入的 stdin**，再执行 `seedpacespec pre-push`，避免管道阻塞。
- 行为由 `seedpacespec/config.yaml` 的 `gitHooks.prePush` 控制：
  - **`mode: print`（默认）**：每次 `git push` 在**控制台 stderr** 打印「缺陷自检提示」（diff 列表 + 引导 `/sdx-detect`）与「文档漂移提示」（依赖 `driftDetection.enabled` 与 `src/` 变更），**不读标准输入**，IDE 内置 Git 一般也不会卡住。
  - **`mode: menu`**： 在支持 `/dev/tty` 的环境（如系统终端）下，**分别询问**是否输出上述两块；**不建议在 CI 使用**。
- 若已有**非 seedpacespec 管理**的 `pre-push`（文件中无 `# seedpacespec-managed`），默认**不覆盖**；使用 `hooks install --force` 或 `init --force-hooks` 强制覆盖。

---

## Cursor / Claude 指令

在 Cursor IDE 或 Claude Code 中使用以下指令触发 Skill：

| 指令 | 功能 |
|------|------|
| `/sdx-analyzer-project` | 分析项目架构，生成 architecture.md |
| `/sdx-trd-generator` | 基于 PRD 生成技术方案文档（TRD） |
| `/sdx-propose` | 提议新变更，生成 PRD + Design + TRD + Tasks |
| `/sdx-apply` | 执行变更，写代码实现 |
| `/sdx-update-task` | 更新任务/TRD/Design（不改代码） |
| `/sdx-test-plan` | 为公共模块生成单元测试 |
| `/sdx-detect` | 执行业务缺陷检测 |
| `/sdx-archive` | 归档已完成的变更 |
| `/sdx-explore` | 探索模式——发散想法、排查问题 |
| `/sdx-figma-prd` | 从 Figma 生成 PRD |
| `/sdx-figma-style` | 从 Figma 提取样式上下文 |
| `/sdx-design-module` | 纯逻辑模块设计（无需 PRD/视觉稿） |

---

## 推荐流程

```
1. seedpacespec init                    # 初始化项目

2. /sdx-analyzer-project                # 分析项目架构
   或
   /sdx-trd-generator                    # 在已有 PRD 时直接生成 TRD

3. /sdx-propose "你的需求描述"           # 创建变更并生成设计文档

4. /sdx-apply                           # 执行变更，写代码实现

5. /sdx-test-plan                       # (可选) 生成单元测试

6. /sdx-detect                          # (可选) 缺陷检测

7. /sdx-archive                         # 归档已完成的变更
```

---

## 项目结构

```
seedpacespec/
├── config.yaml              # 项目配置
├── global-specs/            # 全局规格（项目背景、需求，帮助 AI 理解项目）
│   └── *.md (项目 README、PRD、需求文档等)
├── changes/
│   ├── active-change/       # 活跃变更
│   │   └── <change-name>/
│   │       ├── proposal.md
│   │       ├── specs/       # 变更专属规格
│   │       ├── design.md
│   │       ├── trds/
│   │       ├── tasks.md
│   │       └── defect-report.md
│   └── archive/             # 已归档变更
└── README.md                # 项目 README 副本（自动复制）

.cursor/                     # Cursor IDE 配置
├── skills/                  # 13 个 Skill
└── commands/                # 12 个指令绑定

.claude/                     # Claude Code 配置（内容一致）
├── skills/
└── commands/

architecture.md              # (可选) 项目架构文档（根目录）
```

### 关于 `seedpacespec/global-specs/`（全局规格）

**用途**：存放**项目级**的规格文档，帮助 AI 理解"这是什么项目"——项目背景、全局需求、业务规则等。

**与变更级 specs/ 的区别**：
| 目录 | 级别 | 内容 | 创建时机 |
|------|------|------|----------|
| `global-specs/` | 项目级 | 项目背景、整体需求、业务规则、全局约定 | init 创建，手动维护 |
| `changes/<name>/specs/` | 变更级 | 具体变更的详细需求规格 | propose/figma-to-prd 生成 |

**建议用法**：
```
global-specs/
├── README.md                # 项目介绍（init 时自动复制根目录 README）
├── product-requirements.md  # 产品需求文档（整体）
├── user-stories.md          # 用户故事（全局）
├── business-rules.md        # 业务规则
└── api-guidelines.md        # API 设计指南（全局约定）
```

**AI 使用场景**：
- 首次接触项目时，AI 读取 `global-specs/` 快速了解项目背景
- 生成变更级规格时，参考全局业务规则保持一致性

---

## 配置

`seedpacespec/config.yaml`：

```yaml
schema: spec-driven

# 文档漂移检测
driftDetection:
  enabled: false
  # activeChange: ""      # 指定当前聚焦的变更名

# 插件配置
# plugins:
#   override:
#     # apply: path/to/custom-apply.md
#   slots:
#     - skill: apply
#       slot: ui_render
#       run: path/to/custom-ui-render.md
```

---

## 更多信息

- [架构设计文档](./ARCHITECTURE-DESIGN.md) - 详细技术架构
- [版本历史](./CHANGELOG.md) - 版本更新记录

---


