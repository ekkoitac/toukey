# seedpacespec-figma-to-prd Scripts

`.fig` 文件逆向解析脚本

核心 PRD 生成逻辑（`fig-to-prd.ts`）来自 `fig-prd-exporter/sdk/fig-to-prd.ts`，
保证两个项目输出完全一致。

## 文件结构

| 文件 | 说明 |
|------|------|
| `types.ts` | TypeScript 类型定义（与 `fig-prd-exporter/sdk/lib/figma-types.ts` 同步） |
| `parser.ts` | .fig 文件解析核心（ZIP 解压、Kiwi 解码） |
| `tree-builder.ts` | 扁平节点列表 → 树形结构 |
| `fig-to-prd.ts` | **核心引擎**：从树提取 Sections/Elements，文本吸附，生成 PRD JSON（来自 SDK） |
| `cli.ts` | 命令行工具（`npx tsx cli.ts design.fig "1.0.7" -o output.json`） |
| `index.ts` | 统一导出入口 |

## 依赖

```bash
npm install fzstd kiwi-schema uzip
```

## 标准调用方式

详见 `SKILL.md` 中「脚本调用」一节。核心函数从 `index.ts` 导出：

- `parseFigFile(buffer)` — 解析 .fig 二进制
- `generatePrdFromFig(buffer, options?)` — 从 .fig buffer 直接生成 PRD JSON
- `listPageVersions(buffer)` — 列出页面版本
- `extractFigImages(buffer)` — 提取 ZIP 内嵌图片
- `pruneForDify(output)` — 精简数据

## 与 fig-prd-exporter SDK 的关系

| 文件 | SDK 源文件 |
|------|-----------|
| `fig-to-prd.ts` | `sdk/fig-to-prd.ts`（完整复制，仅调整 import 路径） |
| `parser.ts` | `sdk/lib/fig-parser.ts` |
| `tree-builder.ts` | `sdk/lib/figma-tree-builder.ts` |
| `types.ts` | `sdk/lib/figma-types.ts` |

**同步规则**：当 SDK 更新时，将 `fig-to-prd.ts` 重新复制并调整 import：
- `'./lib/fig-parser'` → `'./parser'`
- `'./lib/figma-tree-builder'` → `'./tree-builder'`
- `'./lib/figma-types'` → `'./types'`
