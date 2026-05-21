/**
 * seedpacespec-figma-to-prd 脚本入口
 *
 * 核心逻辑来自 fig-prd-exporter/sdk，保证输出一致。
 *
 * 核心功能：
 * 1. parseFigFile - 解析 .fig 二进制文件
 * 2. generatePrdFromFig - 从 .fig buffer 生成 PRD 结构化 JSON
 * 3. extractFigImages - 提取图片资源
 * 4. listPageVersions - 检测多版本页面
 * 5. pruneForDify - 精简数据用于 AI 处理
 *
 * 使用示例：
 * ```typescript
 * import { generatePrdFromFig, listPageVersions } from './index'
 *
 * const buffer = fs.readFileSync('design.fig')
 * const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
 *
 * // 列出版本
 * const versions = listPageVersions(ab)
 *
 * // 生成 PRD JSON
 * const prd = generatePrdFromFig(ab, { version: '1.0.7', baseName: 'design' })
 *
 * // 精简
 * const pruned = pruneForDify(prd)
 * ```
 */

// Parser exports
export {
  parseFigFile,
  listFigImages,
} from './parser'

// Tree Builder exports
export {
  buildTree,
  guidToString,
  isUserPage,
  collectSymbolTree,
  findNodeByGuid,
  flattenTree,
} from './tree-builder'

// fig-to-prd exports (核心 PRD 生成逻辑，与 fig-prd-exporter SDK 完全一致)
export {
  generatePrdFromFig,
  listPageVersions,
  extractFigImages,
  pruneForDify,
  extractStyleContext,
  dedupeStyleContextByContent,
  extractStyleContextDedupByContent,
  listStyleSubModuleCandidates,
} from './fig-to-prd'

export type {
  FigToPrdOutput,
  FigToPrdOptions,
  StyleNode,
  StyleTextEntry,
  StyleAreaEntry,
  StyleFrameEntry,
  StyleAreaTreeNode,
  StyleFrameElementTree,
  StyleContextOutput,
  StyleContentDedupOutput,
  StyleSubModuleCandidate,
} from './fig-to-prd'

// Type exports
export type {
  FigmaGUID,
  FigmaParentIndex,
  FigmaVector,
  FigmaMatrix,
  FigmaNodeChange,
  FigmaNodeType,
  FigmaDecodedFile,
  FigmaTextData,
  FigmaFontName,
  TreeNode,
  ParseFigOptions,
} from './types'
