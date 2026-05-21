/**
 * fig-to-prd.ts — .fig 逆向解析核心模块
 * ═══════════════════════════════════════════════════════════════
 * 本文件包含两条独立的提取路线，共享底层基础设施：
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │                 共用基础设施 (L63~L1840)                     │
 * │  parseFigFile / buildTree / guidToString / TreeNode 类型     │
 * │  collectMainComponents / collectSymbolNodes                 │
 * │  collectSectionNodes / flattenWithBounds                    │
 * │  getTextContent / isFigmaTextLayerType                      │
 * │  getInstanceContent / symbolOverride 文字读取                │
 * │  hasSubModuleMarker / stripNestMarkersFromTitle             │
 * └─────────────┬───────────────────────────┬───────────────────┘
 *               │                           │
 *  ┌────────────▼────────────┐  ┌───────────▼──────────────────┐
 *  │  路线A: PRD 提取         │  │  路线B: Style Context 提取    │
 *  │  (L1842~L3605)          │  │  (L3608~文件末尾)             │
 *  │                         │  │                              │
 *  │  入口: generatePrdFromFig│  │  入口: extractStyleContext    │
 *  │        pruneForDify      │  │        extractStyleContext    │
 *  │                         │  │         DedupByContent        │
 *  │  核心遍历:               │  │                              │
 *  │    flattenWithBounds     │  │  核心遍历:                   │
 *  │    classifyText          │  │    flatCollect               │
 *  │    attachFreeRectAbove   │  │    _resolveChildVisibility   │
 *  │    pickAboveAttachTarget │  │    _buildLibToLocalMap       │
 *  │                         │  │    resolveStyleTextLayer-     │
 *  │  关注: 文字分类 → 语义   │  │      Content                 │
 *  │    结构化 PRD JSON       │  │                              │
 *  │    (sections/elements)   │  │  关注: 视觉属性 + 组件树      │
 *  │                         │  │    (texts/areas/layout)       │
 *  │  不涉及: 组件可见性/     │  │                              │
 *  │    CPA/symbol swap      │  │  涉及: componentPropAssign-  │
 *  │                         │  │    ments / symbol swap /      │
 *  │                         │  │    forceVisible / lib→local   │
 *  │                         │  │    GUID 映射                  │
 *  └─────────────────────────┘  └──────────────────────────────┘
 *
 * 修改指南:
 *   - 改 PRD 提取逻辑 → 只动路线A区域，不碰 flatCollect 及其下游
 *   - 改 Style 提取逻辑 → 只动路线B区域，不碰 classifyText 及其下游
 *   - 改共用基础 → 需同时验证两条路线
 *
 * INSTANCE 展开模型 (路线B 专用):
 *   flatCollect 在遇到 INSTANCE 节点时：
 *   1. 通过 f.overriddenSymbolID / symbolData.symbolID 找到 SYMBOL 定义
 *   2. 若父级通过 symbolOverrides 做了 swap（overriddenSymbolID），
 *      使用 inheritedSwapSymbolId 替代原始 symbolID
 *   3. 通过 _resolveChildVisibility 决定 SYMBOL 哪些子节点可见:
 *      - symbolOverrides depth-1 visible:false → hidden
 *      - componentPropAssignments + componentPropRefs(VISIBLE) → hidden/forceVisible
 *   4. 通过 _buildLibToLocalMap 建立库 GUID→本地 GUID 映射
 *      （支持精确匹配、INSTANCE 子类型部分匹配、单子节点兜底）
 *   5. 将深层 overrides 按首 GUID 分组，递归传递给子 INSTANCE
 *
 * 纯浏览器 / Node.js 通用
 * Node.js 专用功能（CLI、extractFigImagesToDir）见 node.ts。
 */

// @ts-nocheck

// ╔═══════════════════════════════════════════════════════════════╗
// ║  共用基础设施 — 路线A(PRD) 和 路线B(Style) 共同依赖           ║
// ║  修改此区域需同时验证两条路线的输出                            ║
// ╚═══════════════════════════════════════════════════════════════╝

// ─── DEBUG 日志开关 ───
// 设为 true 开启文本分类详细日志；或在 DEBUG_TARGET_IDS 中加入感兴趣的 Figma 节点 id
const DEBUG_TEXT_CLASSIFY = false
const DEBUG_TARGET_IDS = new Set<string>([
])
function _dbg(...args: unknown[]) {
  if (DEBUG_TEXT_CLASSIFY) console.warn('[FIG-PRD-DBG]', ...args)
}
function _dbgId(id: string, ...args: unknown[]) {
  if (DEBUG_TARGET_IDS.has(id)) console.warn('[FIG-PRD-DBG]', `[${id}]`, ...args)
}
import { parseFigFile, listFigImages } from './parser'
import { buildTree, isUserPage, guidToString } from './tree-builder'
import type { FigmaNodeChange, FigmaGUID, FigmaMatrix, FigmaVector } from './types'

interface TreeNode {
  figma: FigmaNodeChange
  children: TreeNode[]
}

function getPos(f: FigmaNodeChange): { x: number; y: number } {
  if (f.transform) return { x: f.transform.m02, y: f.transform.m12 }
  return { x: 0, y: 0 }
}

function getSize(f: FigmaNodeChange): { w: number; h: number } {
  const s = f.size
  return { w: s?.x ?? 100, h: s?.y ?? 100 }
}

function getRotation(f: FigmaNodeChange): number {
  const t = f.transform
  if (!t) return 0
  return Math.atan2(t.m10, Math.abs(t.m00)) * (180 / Math.PI)
}

/** 点是否在矩形内 */
function pointInRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh
}

/** 点到矩形的最短距离（在内部为 0） */
function pointToRectDist(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const cx = Math.max(rx, Math.min(px, rx + rw))
  const cy = Math.max(ry, Math.min(py, ry + rh))
  return Math.hypot(px - cx, py - cy)
}

/** 连线端点与元素框的容差（像素），端点稍偏时仍能匹配到目标元素 */
const CONNECTOR_ENDPOINT_MARGIN = 24

/** 连线中点/中段附近用于「是/否」等分支标签的最大距离（像素） */
const CONNECTOR_LABEL_MAX_DIST = 100

/** 点到线段的最短距离 */
function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1e-6
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)))
  const qx = x1 + t * dx
  const qy = y1 + t * dy
  return Math.hypot(px - qx, py - qy)
}

/** 取连线中点附近、内容较短的 TEXT 作为该连线的分支标签（是/否等）；优先取落在连线附近的短文案 */
function getConnectorLabel(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  flat: Array<{ guid: string; type: string; node: { figma: FigmaNodeChange } }>,
  descendantGuids: Set<string>,
  boundsByGuid: Map<string, { x: number; y: number; w: number; h: number }>,
  getTextContent: (f: FigmaNodeChange) => string
): string | undefined {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  let best: { text: string; dist: number } | null = null
  for (const e of flat) {
    if (!isFigmaTextLayerType(e.type) || !descendantGuids.has(e.guid)) continue
    const b = boundsByGuid.get(e.guid)
    if (!b) continue
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const distToSegment = pointToSegmentDist(cx, cy, x1, y1, x2, y2)
    const distToMid = pointToRectDist(midX, midY, b.x, b.y, b.w, b.h)
    const dist = Math.min(distToSegment, distToMid)
    if (dist > CONNECTOR_LABEL_MAX_DIST) continue
    const text = getTextContent(e.node.figma).trim()
    if (text.length > 12) continue
    if (!best || dist < best.dist) best = { text, dist }
  }
  return best?.text || undefined
}

/** 将 endpointNodeId（可能是 FigmaGUID 或 string）转为 string，便于与 element id 比对 */
function endpointNodeIdToString(
  endpointNodeId: FigmaGUID | string | undefined,
  guidToStringFn: (g: FigmaGUID) => string
): string | undefined {
  if (endpointNodeId == null) return undefined
  if (typeof endpointNodeId === 'string') return endpointNodeId.trim() || undefined
  if (typeof endpointNodeId === 'object' && 'sessionID' in endpointNodeId && 'localID' in endpointNodeId) {
    return guidToStringFn(endpointNodeId as FigmaGUID)
  }
  return undefined
}

/** .fig 解码里 CONNECTOR 使用 endpointNodeID（大写 ID），Plugin API 用 endpointNodeId（小写），两处都读 */
function getEndpointNodeId(ep: { endpointNodeId?: FigmaGUID | string; endpointNodeID?: FigmaGUID } | undefined): string | undefined {
  if (!ep) return undefined
  const raw = (ep as Record<string, unknown>).endpointNodeID ?? (ep as Record<string, unknown>).endpointNodeId
  return endpointNodeIdToString(raw as FigmaGUID | string | undefined, guidToString)
}

/** CONNECTOR 若带 connectorStart/connectorEnd 的 endpointNodeId/endpointNodeID，则能精准得到起止节点 id */
function getConnectorAttachedNodes(f: FigmaNodeChange): { startId?: string; endId?: string } {
  const start = getEndpointNodeId(f.connectorStart as Record<string, unknown> | undefined)
  const end = getEndpointNodeId(f.connectorEnd as Record<string, unknown> | undefined)
  return { startId: start, endId: end }
}

/** CONNECTOR/LINE 的起点、终点（绝对坐标）。Figma 用 transform + size.x 表示线段长度与方向 */
function getConnectorEndpoints(f: FigmaNodeChange, absX: number, absY: number): { x1: number; y1: number; x2: number; y2: number } {
  const { w } = getSize(f)
  const rot = (getRotation(f) * Math.PI) / 180
  const x2 = absX + w * Math.cos(rot)
  const y2 = absY + w * Math.sin(rot)
  return { x1: absX, y1: absY, x2, y2 }
}

/** VECTOR 无 Connector 锚点；外接框很扁时按直线近似端点（轴对齐 bbox 中心线） */
const VECTOR_LINE_MAX_THICK = 16
const VECTOR_LINE_MIN_SPAN = 8

function isThinLineLikeVector(e: { type: string; absW: number; absH: number }): boolean {
  if (e.type !== 'VECTOR') return false
  const minD = Math.min(e.absW, e.absH)
  const maxD = Math.max(e.absW, e.absH)
  return maxD >= VECTOR_LINE_MIN_SPAN && minD <= VECTOR_LINE_MAX_THICK
}

function getThinVectorLineEndpoints(e: {
  absX: number
  absY: number
  absW: number
  absH: number
}): { x1: number; y1: number; x2: number; y2: number } {
  const { absX: x, absY: y, absW: w, absH: h } = e
  if (w >= h) {
    const midY = y + h / 2
    return { x1: x, y1: midY, x2: x + w, y2: midY }
  }
  const midX = x + w / 2
  return { x1: midX, y1: y, x2: midX, y2: y + h }
}

/** 仅对 Figma 默认命名的 Line / Line 349 等做 VECTOR 几何连线，避免其它矢量误当箭头 */
const FIGMA_LINE_LAYER_NAME_RE = /^Line(?:\s+\d+)?$/i

function isLineNamedThinVector(e: { type: string; name: string; absW: number; absH: number }): boolean {
  return (
    e.type === 'VECTOR' &&
    isThinLineLikeVector(e) &&
    FIGMA_LINE_LAYER_NAME_RE.test(e.name.trim())
  )
}

type EdgeRef = { id: string; name?: string; label?: string; blockId?: string }

function pushUniqueEdgeRef(arr: EdgeRef[], ref: EdgeRef): void {
  if (arr.some((x) => x.id === ref.id && x.label === ref.label && x.blockId === ref.blockId)) return
  arr.push(ref)
}

/** 递归打平整棵树，带绝对坐标（不包含 root 自身时，从 root 子节点开始算） */
function flattenWithBounds(
  node: TreeNode,
  parentAbsX: number,
  parentAbsY: number
): Array<{ node: TreeNode; guid: string; type: string; name: string; absX: number; absY: number; absW: number; absH: number }> {
  const out: Array<{ node: TreeNode; guid: string; type: string; name: string; absX: number; absY: number; absW: number; absH: number }> = []
  const f = node.figma
  const guid = f.guid ? guidToString(f.guid) : ''
  const type = f.type ?? 'NONE'
  const name = (f.name ?? guid).trim()
  const { x, y } = getPos(f)
  const { w, h } = getSize(f)
  const absX = parentAbsX + x
  const absY = parentAbsY + y
  out.push({ node, guid, type, name, absX, absY, absW: w, absH: h })
  for (const ch of node.children) {
    out.push(...flattenWithBounds(ch, absX, absY))
  }
  return out
}

function getTextContent(f: FigmaNodeChange): string {
  const s = f.textData?.characters
  return (typeof s === 'string' ? s : '')?.trim() ?? ''
}

/** 除 TEXT 外，Figma .fig 里「带 textData.characters」的图层（如带字形状、便签、代码块） */
function isFigmaTextLayerType(type: string | undefined): boolean {
  const t = type ?? 'NONE'
  return t === 'TEXT' || t === 'SHAPE_WITH_TEXT' || t === 'STICKY' || t === 'CODE_BLOCK'
}

const AUTO_NAME_RE_INSTANCE = /^(Frame|Rectangle|Ellipse|Line|Group|Vector|Image|Polygon|Path|Union|Subtract|Intersect|Exclude|instance|text|label)\s*\d*$/i

/** 从组件实例的 Content（Properties）拿文案：symbolOverrides / derivedSymbolData。
 *  增强：尝试利用主组件里被覆盖节点的 name 作为语义 key，输出 "key: value" 格式，
 *  便于下游理解每段文案的含义（如 "状态说明: 若对话中…"）。仅对有语义的 name 保留 key。
 */
function getInstanceContent(f: FigmaNodeChange, symbolIdToNode?: Map<string, TreeNode>): string {
  const parts: string[] = []

  const mainSymbolNode = symbolIdToNode && f.overriddenSymbolID
    ? symbolIdToNode.get(guidToString(f.overriddenSymbolID))
    : symbolIdToNode && f.symbolData?.symbolID
      ? symbolIdToNode.get(guidToString(f.symbolData.symbolID))
      : undefined

  const symDescendantNames = new Map<string, string>()
  if (mainSymbolNode) {
    function collectNames(node: TreeNode) {
      if (node.figma.guid) {
        const name = (node.figma.name ?? '').trim()
        if (name && !AUTO_NAME_RE_INSTANCE.test(name)) {
          symDescendantNames.set(guidToString(node.figma.guid), name)
        }
      }
      for (const ch of node.children) collectNames(ch)
    }
    collectNames(mainSymbolNode)
  }

  for (const ov of f.symbolData?.symbolOverrides ?? []) {
    const s = ov.textData?.characters
    if (typeof s !== 'string' || !s.trim()) continue
    const text = s.trim()
    const lastGuid = ov.guidPath?.guids?.length
      ? guidToString(ov.guidPath.guids[ov.guidPath.guids.length - 1])
      : undefined
    const keyName = lastGuid ? symDescendantNames.get(lastGuid) : undefined
    parts.push(keyName ? `${keyName}: ${text}` : text)
  }
  for (const d of f.derivedSymbolData ?? []) {
    const s = d.derivedTextData?.characters
    if (typeof s === 'string' && s.trim()) parts.push(s.trim())
  }

  if (parts.length === 0 && mainSymbolNode) {
    function collectDefaultText(node: TreeNode) {
      const type = node.figma.type ?? 'NONE'
      if (isFigmaTextLayerType(type)) {
        const t = (node.figma.textData?.characters ?? '').trim()
        if (t) parts.push(t)
      }
      for (const ch of node.children) collectDefaultText(ch)
    }
    collectDefaultText(mainSymbolNode)
  }

  return parts.join('\n')
}

/** 收集节点及其所有后代的 guid（含自身） */
function collectDescendantGuids(node: TreeNode, out: Set<string>): void {
  const guid = node.figma.guid ? guidToString(node.figma.guid) : ''
  if (guid) out.add(guid)
  for (const ch of node.children) collectDescendantGuids(ch, out)
}

/** nodeGuid 是否是 ancestorGuid 的后代（沿 parentMap 向上走能走到 ancestor） */
function isDescendantOf(
  nodeGuid: string,
  ancestorGuid: string,
  parentMap: Map<string, TreeNode>
): boolean {
  let current: string | undefined = nodeGuid
  while (current) {
    if (current === ancestorGuid) return true
    const parent = parentMap.get(current)
    current = parent?.figma.guid ? guidToString(parent.figma.guid) : undefined
  }
  return false
}

type FlatEntry = {
  guid: string
  type: string
  name: string
  node: TreeNode
  absX: number
  absY: number
  absW: number
  absH: number
}

/** 文本是否看起来有语义含义（状态说明、逻辑规则、规格描述等），而非纯 UI 标签 */
function isSemanticText(text: string): boolean {
  if (text.length >= 15) return true
  if (/[→←↑↓⟶⟵➜➝>＞]/.test(text)) return true
  if (/[\n\r]/.test(text)) return true
  if (/[：:；;，,]/.test(text) && text.length >= 8) return true
  if (/(?:状态|条件|规则|逻辑|说明|描述|流程|判断|触发|动作|默认|随机|循环|重复|播放|暂停|开始|结束|切换|跳转|返回|进入|退出|idle|start|end|loop|trigger|action|state|if|when|then)/i.test(text)) return true
  return false
}

/** 对游离 TEXT 分类：根据文本内容特征判断属于「状态/逻辑规则」还是「功能说明」 */
function classifySectionHint(text: string): string {
  if (/[→←↑↓⟶⟵➜➝]/.test(text) ||
      /(?:idle|start|end|loop|speak|trigger|action|state|play|pause|stop|reset)/i.test(text) ||
      /(?:状态|触发|动作|切换|跳转|播放|暂停|循环|随机|进入|退出|开始|结束|空闲)/.test(text) ||
      /_/.test(text) && text.length >= 8) {
    return '状态说明或交互逻辑规则，需精确收集到PRD'
  }
  if (/(?:条件|判断|若|如果|当|否则|then|if|when|else)/i.test(text) ||
      /[？?]/.test(text) && text.length >= 10) {
    return '条件/分支逻辑说明，需精确收集到PRD'
  }
  if (/(?:规则|规格|参数|配置|数值|比例|概率|权重|优先|频率|时长|间隔)/i.test(text) ||
      /\d+[%％]/.test(text) ||
      /\d+\s*[×xX*]\s*\d+/.test(text)) {
    return '技术规格或参数配置，需精确收集到PRD'
  }
  if (text.length >= 20 || /[\n\r]/.test(text)) {
    return '功能说明或业务规则描述'
  }
  return '可能为section整体说明'
}

/** 实例属性/语音条文案与已 walk 出的子树 TEXT 是否实质重复 */
function instanceContentIsRedundant(
  ic: string,
  subtreeTextEntries: Array<{ text: string }>
): boolean {
  const icNorm = ic.replace(/\s+/g, '')
  if (!icNorm) return true
  for (const t of subtreeTextEntries) {
    const tNorm = t.text.replace(/\s+/g, '')
    if (tNorm === icNorm) return true
    if (icNorm.length >= 4 && tNorm.includes(icNorm)) return true
    if (tNorm.length >= 4 && icNorm.includes(tNorm)) return true
  }
  return false
}

/** 实例上 symbolOverrides / derivedSymbolData 里针对某后代节点 guid 的文本（节点本体 textData 常为空） */
function getSymbolOverrideTextForDescendant(
  instFigma: FigmaNodeChange,
  nodeGuid: string
): string {
  for (const ov of instFigma.symbolData?.symbolOverrides ?? []) {
    const guids = ov.guidPath?.guids
    if (!guids?.length) continue
    if (!guids.some((gg) => guidToString(gg) === nodeGuid)) continue
    const s = ov.textData?.characters
    if (typeof s === 'string' && s.trim()) return s.trim()
  }
  for (const d of instFigma.derivedSymbolData ?? []) {
    const guids = d.guidPath?.guids
    if (!guids?.length) continue
    if (!guids.some((gg) => guidToString(gg) === nodeGuid)) continue
    const s = d.derivedTextData?.characters
    if (typeof s === 'string' && s.trim()) return s.trim()
  }
  return ''
}

function collectOverrideTextWithGuidPaths(
  instFigma: FigmaNodeChange
): Array<{ text: string; guids: string[] }> {
  const out: Array<{ text: string; guids: string[] }> = []
  for (const ov of instFigma.symbolData?.symbolOverrides ?? []) {
    const s = ov.textData?.characters
    const rawGuids = ov.guidPath?.guids ?? []
    if (typeof s !== 'string' || !s.trim() || rawGuids.length === 0) continue
    out.push({ text: s.trim(), guids: rawGuids.map((g) => guidToString(g)) })
  }
  for (const d of instFigma.derivedSymbolData ?? []) {
    const s = d.derivedTextData?.characters
    const rawGuids = d.guidPath?.guids ?? []
    if (typeof s !== 'string' || !s.trim() || rawGuids.length === 0) continue
    out.push({ text: s.trim(), guids: rawGuids.map((g) => guidToString(g)) })
  }
  return out
}

function isLikelyPlaceholderText(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  const lower = t.toLowerCase()
  if (['button', 'text', 'title', 'label', 'content', 'icon'].includes(lower)) return true
  if (/^(按钮|文本|标题|文案|内容|标签|图标)$/.test(t)) return true
  return false
}

function getNearestNonPlaceholderOverrideText(instanceStack: TreeNode[]): string {
  for (let i = instanceStack.length - 1; i >= 0; i--) {
    const carrierTexts = collectOverrideTextWithGuidPaths(instanceStack[i].figma).map((item) => item.text)
    for (const t of carrierTexts) {
      if (!isLikelyPlaceholderText(t)) return t
    }
  }
  return ''
}

function getStyleOverrideTextForDescendant(
  instFigma: FigmaNodeChange,
  nodeGuid: string,
  nodeGuidTrail: string[],
  allowTrailFallback: boolean
): string {
  const exact = getSymbolOverrideTextForDescendant(instFigma, nodeGuid)
  if (exact) return exact
  if (!allowTrailFallback || nodeGuidTrail.length === 0) return ''

  const carriers = collectOverrideTextWithGuidPaths(instFigma)
  let best: { text: string; trailDepth: number; pathLen: number } | null = null

  for (const carrier of carriers) {
    let matchedDepth = -1
    for (let i = nodeGuidTrail.length - 1; i >= 0; i--) {
      if (carrier.guids.includes(nodeGuidTrail[i])) {
        matchedDepth = i
        break
      }
    }
    if (matchedDepth < 0) continue

    if (
      !best ||
      matchedDepth > best.trailDepth ||
      (matchedDepth === best.trailDepth && carrier.guids.length > best.pathLen)
    ) {
      best = { text: carrier.text, trailDepth: matchedDepth, pathLen: carrier.guids.length }
    }
  }

  return best?.text ?? ''
}

function resolveTextLayerContent(
  ch: TreeNode,
  instanceStack: TreeNode[],
  getTextContentFn: (f: FigmaNodeChange) => string
): string {
  const direct = getTextContentFn(ch.figma).trim()
  if (direct) return direct
  const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
  if (!g) return ''
  for (let i = instanceStack.length - 1; i >= 0; i--) {
    const o = getSymbolOverrideTextForDescendant(instanceStack[i].figma, g)
    if (o) return o
  }
  return ''
}

/**
 * 为 FRAME/GROUP 聚合：标题、块内文字说明（带 TEXT 节点 id）、childIds。
 * 递归整棵子树收集所有 TEXT（含内层 FRAME/GROUP 内、组件实例子树内）；不再因「嵌套展开父框」跳过直接子容器内的字。
 * INSTANCE/SYMBOL：用 getInstanceContent 补语音/属性里的文案；子树无 TEXT 时必补一条，有 TEXT 时若不重复再追加一条。
 * SHAPE_WITH_TEXT / STICKY / CODE_BLOCK：与 TEXT 一样读 textData.characters（常见按钮「开始学习」在带字形状上而非子 TEXT）。
 * 组件内 TEXT 常见仅有实例覆盖、节点 characters 为空：沿 instanceStack 查 symbolOverrides，仍用该 TEXT 的 guid 输出，便于吸附与去重。
 */
function getFrameContent(
  frameNode: TreeNode,
  _flat: FlatEntry[],
  getTextContentFn: (f: FigmaNodeChange) => string,
  symbolIdToNode?: Map<string, TreeNode>
): { title: string; texts: Array<{ id: string; text: string }>; childIds: string[] } {
  const texts: Array<{ id: string; text: string }> = []
  const childIds: string[] = []
  const _frameGuid = frameNode.figma.guid ? guidToString(frameNode.figma.guid) : ''
  const _dbgWalk = DEBUG_TEXT_CLASSIFY && DEBUG_TARGET_IDS.has(_frameGuid)

  function walk(node: TreeNode, instanceStack: TreeNode[], depth: number) {
    for (const ch of node.children) {
      const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
      if (!g) continue
      const type = ch.figma.type ?? 'NONE'
      if (type === 'CONNECTOR' || type === 'LINE') continue

      const isInst = type === 'INSTANCE' || type === 'SYMBOL'
      const nextStack = isInst ? [...instanceStack, ch] : instanceStack
      const indent = '  '.repeat(depth)

      if (_dbgWalk) _dbg(`${indent}[walk] id=${g} type=${type} name="${ch.figma.name}" isInst=${isInst} children=${ch.children.length} instStackLen=${nextStack.length}`)

      const tRaw = isFigmaTextLayerType(type) && !isInst
        ? resolveTextLayerContent(ch, nextStack, getTextContentFn)
        : getTextContentFn(ch.figma).trim()

      if (_dbgWalk && (isFigmaTextLayerType(type) || tRaw)) {
        _dbg(`${indent}  tRaw="${(tRaw || '').slice(0, 80)}${(tRaw || '').length > 80 ? '...' : ''}" isTextLayer=${isFigmaTextLayerType(type)}`)
      }

      if (tRaw && !isInst) {
        texts.push({ id: g, text: tRaw })
        if (_dbgWalk) _dbg(`${indent}  → pushed to texts`)
      }

      if (isFigmaTextLayerType(type)) {
        walk(ch, nextStack, depth + 1)
        continue
      }

      childIds.push(g)
      const textsLenBefore = texts.length
      walk(ch, nextStack, depth + 1)
      if (isInst && symbolIdToNode) {
        const ic = getInstanceContent(ch.figma, symbolIdToNode).trim()
        const fromSubtree = texts.slice(textsLenBefore)
        if (_dbgWalk) _dbg(`${indent}  [INST] ic="${(ic || '').slice(0, 100)}${(ic || '').length > 100 ? '...' : ''}" subtreeTexts=${fromSubtree.length}`)
        if (ic) {
          if (!fromSubtree.length) { texts.push({ id: g, text: ic }); if (_dbgWalk) _dbg(`${indent}  → pushed ic (no subtree texts)`) }
          else if (!instanceContentIsRedundant(ic, fromSubtree)) { texts.push({ id: g, text: ic }); if (_dbgWalk) _dbg(`${indent}  → pushed ic (non-redundant)`) }
          else if (_dbgWalk) _dbg(`${indent}  → ic skipped (redundant with subtree)`)
        }
      }
    }
  }
  walk(frameNode, [], 0)

  const frameGuid = frameNode.figma.guid ? guidToString(frameNode.figma.guid) : ''
  if (DEBUG_TARGET_IDS.has(frameGuid)) {
    _dbg(`getFrameContent for [${frameGuid}] name="${frameNode.figma.name}"`)
    _dbg(`  collected ${texts.length} texts:`)
    for (const t of texts) {
      _dbg(`    id=${t.id} text="${t.text.slice(0, 60)}${t.text.length > 60 ? '...' : ''}"`)
    }
    _dbg(`  collected ${childIds.length} childIds:`, childIds)
  }

  const title = (frameNode.figma.name ?? '').trim()
  return { title, texts, childIds }
}

/* ============================================================
 * TEXT ABSORPTION (功能文字吸附)
 *
 * 核心规则：「视觉上说明文在图/模版块下面」→ 算作正上方那块的功能说明。
 *
 * 算法分 4 级回退：
 *   1. 文字中心落在某候选内 → 取面积最小（最贴合的局部子块）
 *   2. 最近上方块（块底 ≤ 字顶 + 容差，有足够横向重叠，取竖隙最小）
 *   3. X 投影列匹配（长说明整段在画板下方）
 *   4. 宽松兜底（仅限上方块，按 dx → vGap 排序）
 *   5. 极宽松（中心 Y 邻近）
 * ============================================================ */

const ABSORB_MAX_V_GAP = 1400
const ABSORB_V_OVERLAP_TOLERANCE = 200
const ABSORB_MIN_H_OVERLAP_PX = 24

/**
 * Node 吸附调试：
 * - FIG_PRD_DEBUG_ATTACH=1：对每个参与「框内 texts → 子块」吸附的 TEXT 打日志（量大）。
 * - FIG_PRD_DEBUG_ATTACH_IDS=4958:21382,4958:21388：只打这些 TEXT 节点 id（逗号/空格分隔）。
 * 排查「贴错块」时看：① pool-context（候选池为何只有某几个）；② Stage1/2 的 skip；③ early exit（无 bounds / 空池）。
 * 同一条 TEXT 若出现在多个父 FRAME 的 frameContent 里，会对每个父各跑一次；某父下若无该 TEXT 的 bounds 会 early exit。
 */
function attachDebugEnabled(textId: string): boolean {
  try {
    if (typeof process === 'undefined' || !(process as NodeJS.Process).env) return false
    const env = (process as NodeJS.Process).env
    const ids = env.FIG_PRD_DEBUG_ATTACH_IDS?.trim()
    if (ids) return ids.split(/[\s,]+/).filter(Boolean).includes(textId)
    return env.FIG_PRD_DEBUG_ATTACH === '1'
  } catch {
    return false
  }
}

type AttachDebugCtx = { textId: string; parentFrameId?: string; snippet?: string }

function horizontalRectOverlapPx(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
}

type BoundsRect = { x: number; y: number; w: number; h: number }

/**
 * 核心吸附函数：给定文字外接框与候选图块列表，返回最佳归属图块 id。
 * debug：传入时打印各阶段评分（需配合 attachDebugEnabled 在调用处传入 ctx）
 */
function pickPhysicalAboveByXProximity(
  anchorBounds: BoundsRect,
  boundsByGuid: Map<string, BoundsRect>,
  candidateIds: string[],
  debug?: AttachDebugCtx
): string | undefined {
  if (!candidateIds.length) {
    if (debug) {
      console.warn(
        '[FIG-PRD-ATTACH] early exit: candidateIds empty',
        'textId=',
        debug.textId,
        'parentFrame=',
        debug.parentFrameId ?? '(unknown)'
      )
    }
    return undefined
  }

  const cx = anchorBounds.x + anchorBounds.w / 2
  const cy = anchorBounds.y + anchorBounds.h / 2
  const textTop = anchorBounds.y
  const textMidX = anchorBounds.x + anchorBounds.w / 2
  const minHOverlap = Math.min(ABSORB_MIN_H_OVERLAP_PX, Math.max(12, anchorBounds.w * 0.18))

  const log = (...args: unknown[]) => {
    if (debug) console.warn('[FIG-PRD-ATTACH]', ...args)
  }
  if (debug) {
    log('textId=', debug.textId, 'parentFrame=', debug.parentFrameId ?? '(unknown)')
    log('snippet=', (debug.snippet ?? '').slice(0, 120).replace(/\n/g, '\\n'))
    log('anchorBounds=', JSON.stringify(anchorBounds))
    log('minHOverlap=', minHOverlap, 'cx,cy=', cx, cy, 'textTop=', textTop, 'ABSORB_V_TOL=', ABSORB_V_OVERLAP_TOLERANCE)
    log('candidate count=', candidateIds.length)
    for (const cid of candidateIds) {
      const b = boundsByGuid.get(cid)
      log('  candidate', cid, b ? JSON.stringify(b) : '(no bounds)')
    }
  }

  // Stage 1: 文字中心落在候选内 → 取面积最小
  let containBest: { id: string; area: number } | null = null
  const stage1Hits: Array<{ id: string; area: number }> = []
  for (const cid of candidateIds) {
    const b = boundsByGuid.get(cid)
    if (!b) continue
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      const area = b.w * b.h
      stage1Hits.push({ id: cid, area })
      if (!containBest || area < containBest.area) containBest = { id: cid, area }
    }
  }
  if (debug) {
    log(
      'Stage1 (center inside):',
      stage1Hits.length ? stage1Hits.sort((a, b) => a.area - b.area).map((h) => `${h.id} area=${h.area}`) : 'none'
    )
  }
  if (containBest) {
    if (debug) log('=> WINNER Stage1 (smallest area among center-inside):', containBest.id, 'area=', containBest.area)
    return containBest.id
  }

  // Stage 2: 最近上方块（块底 ≤ 字顶 + 容差，横向重叠，取 vGap 最小，再比 dx）
  let aboveBest: { id: string; vGap: number; dx: number } | null = null
  const stage2Rows: Array<{ id: string; hOv: number; frameBottom: number; skip: string; vGap?: number; dx?: number }> = []
  for (const cid of candidateIds) {
    const b = boundsByGuid.get(cid)
    if (!b) {
      if (debug) stage2Rows.push({ id: cid, hOv: 0, frameBottom: 0, skip: 'no bounds' })
      continue
    }
    const hOv = horizontalRectOverlapPx(anchorBounds, b)
    const frameBottom = b.y + b.h
    let skip = ''
    if (hOv < minHOverlap) skip = `hOv ${hOv} < min ${minHOverlap}`
    else if (frameBottom > textTop + ABSORB_V_OVERLAP_TOLERANCE) skip = `not above: frameBottom ${frameBottom} > textTop+tol ${textTop + ABSORB_V_OVERLAP_TOLERANCE}`
    else {
      const vGap = textTop - frameBottom
      if (vGap > ABSORB_MAX_V_GAP) skip = `vGap ${vGap} > MAX ${ABSORB_MAX_V_GAP}`
      else {
        const dx = Math.abs(textMidX - (b.x + b.w / 2))
        if (debug) stage2Rows.push({ id: cid, hOv, frameBottom, skip: 'eligible', vGap, dx })
        if (!aboveBest || vGap < aboveBest.vGap - 0.5 ||
            (Math.abs(vGap - aboveBest.vGap) < 0.5 && dx < aboveBest.dx - 0.5)) {
          aboveBest = { id: cid, vGap, dx }
        }
        continue
      }
    }
    if (debug) stage2Rows.push({ id: cid, hOv, frameBottom, skip })
  }
  if (debug) {
    log('Stage2 rows:', stage2Rows)
    log('Stage2 best:', aboveBest)
  }
  if (aboveBest) {
    if (debug) log('=> WINNER Stage2:', aboveBest.id, 'vGap=', aboveBest.vGap, 'dx=', aboveBest.dx)
    return aboveBest.id
  }

  // Stage 3: X 列匹配（max 横向投影重叠）—— 增加垂直约束，候选块须在文字上方或轻微重叠
  let colBest: { id: string; span: number; area: number } | null = null
  for (const cid of candidateIds) {
    const b = boundsByGuid.get(cid)
    if (!b) continue
    const frameBottom = b.y + b.h
    if (frameBottom > textTop + ABSORB_V_OVERLAP_TOLERANCE) continue
    const span = horizontalRectOverlapPx(anchorBounds, b)
    if (span < minHOverlap) continue
    const area = b.w * b.h
    if (!colBest || span > colBest.span + 0.5 ||
        (Math.abs(span - colBest.span) < 0.5 && area < colBest.area)) {
      colBest = { id: cid, span, area }
    }
  }
  if (debug) log('Stage3 best:', colBest)
  if (colBest) {
    if (debug) log('=> WINNER Stage3:', colBest.id, 'span=', colBest.span, 'area=', colBest.area)
    return colBest.id
  }

  // Stage 4: 宽松 — 上方块按 dx → vGap
  let looseBest: { id: string; dx: number; vGap: number } | null = null
  for (const cid of candidateIds) {
    const b = boundsByGuid.get(cid)
    if (!b) continue
    const frameBottom = b.y + b.h
    if (frameBottom > textTop + ABSORB_V_OVERLAP_TOLERANCE) continue
    const vGap = textTop - frameBottom
    if (vGap > ABSORB_MAX_V_GAP) continue
    const dx = Math.abs(textMidX - (b.x + b.w / 2))
    if (!looseBest || dx < looseBest.dx - 0.5 ||
        (Math.abs(dx - looseBest.dx) < 0.5 && vGap < looseBest.vGap)) {
      looseBest = { id: cid, dx, vGap }
    }
  }
  if (debug) log('Stage4 best:', looseBest)
  if (looseBest) {
    if (debug) log('=> WINNER Stage4:', looseBest.id)
    return looseBest.id
  }

  // Stage 5: 极宽松 — 中心 Y 邻近
  const textMidY = anchorBounds.y + anchorBounds.h / 2
  let ultraBest: { id: string; dx: number; dy: number } | null = null
  for (const cid of candidateIds) {
    const b = boundsByGuid.get(cid)
    if (!b) continue
    const dy = textMidY - (b.y + b.h / 2)
    if (dy < -80 || dy > ABSORB_MAX_V_GAP + anchorBounds.h) continue
    const dx = Math.abs(textMidX - (b.x + b.w / 2))
    if (!ultraBest || dx < ultraBest.dx - 0.5 ||
        (Math.abs(dx - ultraBest.dx) < 0.5 && dy < ultraBest.dy)) {
      ultraBest = { id: cid, dx, dy }
    }
  }
  if (debug) {
    log('Stage5 best:', ultraBest)
    if (ultraBest) log('=> WINNER Stage5:', ultraBest.id)
    else {
      log(
        '=> NO WINNER after Stages 1–5 — check Stage2 rows (hOv / not above / vGap), then Stage3/4; widen pool or adjust layout if the intended block was never a candidate'
      )
    }
  }
  return ultraBest?.id
}

/** 同父兄弟吸附：只看竖直上方 + 横向重叠 */
function filterSiblingsForAboveAttach(
  anchorRect: BoundsRect,
  boundsByGuid: Map<string, BoundsRect>,
  siblingIds: string[]
): string[] {
  const anchorTop = anchorRect.y
  const minOv = Math.min(ABSORB_MIN_H_OVERLAP_PX, Math.max(12, anchorRect.w * 0.18))
  return siblingIds.filter(id => {
    const b = boundsByGuid.get(id)
    if (!b) return false
    if (b.y + b.h > anchorTop + 6) return false
    return horizontalRectOverlapPx(anchorRect, b) >= minOv
  })
}

function getTextAttachedChildId(
  textNodeId: string,
  boundsByGuid: Map<string, BoundsRect>,
  childIds: string[],
  _maxBelowGapPx?: number,
  _horizontalSlackPx?: number,
  debugExtra?: { parentFrameId?: string; snippet?: string }
): string | undefined {
  const tb = boundsByGuid.get(textNodeId)
  if (!tb) {
    if (attachDebugEnabled(textNodeId)) {
      console.warn(
        '[FIG-PRD-ATTACH] early exit: no anchor bounds for TEXT (not in bounds map for this pass)',
        'textId=',
        textNodeId,
        'parentFrame=',
        debugExtra?.parentFrameId ?? '(unknown)',
        '| often: same TEXT id listed under another parent FRAME\'s frameContent; geometry is only keyed once'
      )
    }
    return undefined
  }
  const debug = attachDebugEnabled(textNodeId)
    ? { textId: textNodeId, parentFrameId: debugExtra?.parentFrameId, snippet: debugExtra?.snippet }
    : undefined
  if (debug && childIds.length === 0) {
    console.warn(
      '[FIG-PRD-ATTACH] early exit: attach pool empty',
      'textId=',
      textNodeId,
      'parentFrame=',
      debug.parentFrameId ?? '(unknown)',
      'anchorBounds=',
      JSON.stringify(tb)
    )
    return undefined
  }
  return pickPhysicalAboveByXProximity(tb, boundsByGuid, childIds, debug)
}

function getTextAttachedChildIdForRect(
  tb: BoundsRect,
  boundsByGuid: Map<string, BoundsRect>,
  childIds: string[],
  _maxBelowGapPx?: number,
  _horizontalSlackPx?: number
): string | undefined {
  return pickPhysicalAboveByXProximity(tb, boundsByGuid, childIds)
}

function attachFreeRectAbove(
  blockBounds: BoundsRect,
  boundsByGuid: Map<string, BoundsRect>,
  childIds: string[],
  _opts?: { skipContainCenter?: boolean }
): string | undefined {
  return pickPhysicalAboveByXProximity(blockBounds, boundsByGuid, childIds)
}

function pickAboveAttachTarget(
  textId: string,
  boundsByGuid: Map<string, BoundsRect>,
  childIds: string[],
  siblingNonTextIds: string[]
): string | undefined {
  const tb = boundsByGuid.get(textId)
  if (!tb) return undefined
  const seen = new Set<string>()
  const merged: string[] = []
  for (const cid of childIds) { if (!seen.has(cid)) { seen.add(cid); merged.push(cid) } }
  for (const cid of siblingNonTextIds) { if (!seen.has(cid)) { seen.add(cid); merged.push(cid) } }
  return pickPhysicalAboveByXProximity(tb, boundsByGuid, merged)
}

/** 可作为「图/模版行」参与 UI 文案吸附的节点类型（含实例） */
const VISUAL_BLOCK_EL_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'SYMBOL'])

/**
 * 导出 FRAME 下全部后代视觉块 id（深度优先；穿过非 TEXT 中间层）。
 * 用于多行文案各自吸附到**内层**行框（仅看直接子级时整列共用一个父 Group，会全吸到同一 id）。
 */
function collectDescendantVisualBlockIds(
  elements: Array<{ id: string; type: string }>,
  getParentGuid: (id: string) => string | undefined,
  rootId: string
): string[] {
  const out: string[] = []
  const visit = (parentId: string) => {
    for (const e of elements) {
      if (getParentGuid(e.id) !== parentId) continue
      if (VISUAL_BLOCK_EL_TYPES.has(e.type)) {
        out.push(e.id)
        visit(e.id)
      } else if (e.type !== 'TEXT') {
        visit(e.id)
      }
    }
  }
  visit(rootId)
  return out
}

/** 从 nodeId 沿 parent 链向上直到 stopExclusive（不含），得到祖先 guid（用于排除「包住该字的容器」作吸附目标） */
function collectStrictAncestorGuidsBetween(
  nodeId: string,
  stopExclusive: string,
  parentMap: Map<string, TreeNode>
): Set<string> {
  const s = new Set<string>()
  let cur: TreeNode | undefined = parentMap.get(nodeId)
  while (cur?.figma.guid) {
    const pg = guidToString(cur.figma.guid)
    if (pg === stopExclusive) break
    s.add(pg)
    cur = parentMap.get(pg)
  }
  return s
}

/** 直接子级全部为「纯文字图层」（TEXT / 带字形状等），常见于多段说明包一层 Group */
function isDirectTextOnlyContainerNode(node: TreeNode): boolean {
  if (!node.children.length) return false
  for (const ch of node.children) {
    if (!isFigmaTextLayerType(ch.figma.type)) return false
  }
  return true
}

/** 整棵子树只含 TEXT 和 FRAME/GROUP 容器（无 INSTANCE/IMAGE 等视觉元素），即纯标注帧 */
function isDeepTextOnlyNode(node: TreeNode): boolean {
  if (!node.children.length) return false
  let hasText = false
  function walk(n: TreeNode): boolean {
    for (const ch of n.children) {
      const t = ch.figma.type ?? 'NONE'
      if (isFigmaTextLayerType(t)) { hasText = true; continue }
      if (t === 'FRAME' || t === 'GROUP') {
        if (!walk(ch)) return false
        continue
      }
      return false
    }
    return true
  }
  return walk(node) && hasText
}

const BASIC_SHAPE_TYPES = new Set([
  'RECTANGLE', 'ROUNDED_RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR',
  'POLYGON', 'STAR', 'PATH', 'BOOLEAN_OPERATION', 'REGULAR_POLYGON',
  'UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE',
])

/**
 * 纯标注/标签帧：子树只含 TEXT + 基础形状（矩形/椭圆/线条等装饰）+ FRAME/GROUP 容器，
 * 不含 INSTANCE/IMAGE 等有实质 UI 内容的节点。这种帧不应吸附下方文字。
 */
function isAnnotationLikeFrame(node: TreeNode): boolean {
  if (!node.children.length) return false
  let hasText = false
  function walk(n: TreeNode): boolean {
    for (const ch of n.children) {
      const t = ch.figma.type ?? 'NONE'
      if (isFigmaTextLayerType(t)) { hasText = true; continue }
      if (t === 'FRAME' || t === 'GROUP') {
        if (!walk(ch)) return false
        continue
      }
      if (BASIC_SHAPE_TYPES.has(t)) continue
      return false
    }
    return true
  }
  return walk(node) && hasText
}

function collectDirectChildTextEntries(
  node: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string
): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  for (const ch of node.children) {
    if (!isFigmaTextLayerType(ch.figma.type)) continue
    const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
    const text = getTextContentFn(ch.figma)?.trim()
    if (g && text) out.push({ id: g, text })
  }
  return out
}

/** 从节点子树递归收集所有 TEXT 内容（拼接为单个字符串） */
function collectDeepTextFromNode(
  node: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string
): string {
  const parts: string[] = []
  function walk(n: TreeNode) {
    for (const ch of n.children) {
      if (isFigmaTextLayerType(ch.figma.type)) {
        const t = getTextContentFn(ch.figma)?.trim()
        if (t) parts.push(t)
      }
      walk(ch)
    }
  }
  walk(node)
  return parts.join(' ')
}

/**
 * 「混合文本容器」—— 直接子级由 TEXT + 少量非 TEXT（INSTANCE/SYMBOL/基础形状/嵌套文本容器）组成。
 * 比 isDirectTextOnlyContainerNode 更宽松：允许存在 INSTANCE 等带文字的非文字图层（常见的标签/反馈语组件）。
 */
function isMixedTextContainerNode(
  node: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string
): boolean {
  if (!node.children.length) return false
  let hasText = false
  for (const ch of node.children) {
    const t = ch.figma.type ?? 'NONE'
    if (isFigmaTextLayerType(t)) { hasText = true; continue }
    if (BASIC_SHAPE_TYPES.has(t)) continue
    if (t === 'FRAME' || t === 'GROUP') {
      if (isDeepTextOnlyNode(ch) || isAnnotationLikeFrame(ch)) continue
      if (isMixedTextContainerNode(ch, getTextContentFn)) {
        const deep = collectDeepTextFromNode(ch, getTextContentFn)
        if (deep) { hasText = true; continue }
      }
      return false
    }
    if (t === 'INSTANCE' || t === 'SYMBOL') {
      const deep = collectDeepTextFromNode(ch, getTextContentFn) || getInstanceContent(ch.figma).trim()
      if (deep) { hasText = true; continue }
      return false
    }
    return false
  }
  return hasText
}

/**
 * 从「混合文本容器」收集所有子级文本条目：
 * - TEXT 子级：直接取 textData
 * - INSTANCE/SYMBOL 子级：递归收集子树内所有 TEXT，合并为单条
 * - 嵌套 FRAME/GROUP 文本容器：递归收集其中的 TEXT
 * - 基础形状：跳过
 */
function collectMixedChildTextEntries(
  node: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string
): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  for (const ch of node.children) {
    const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
    if (!g) continue
    const t = ch.figma.type ?? 'NONE'
    if (isFigmaTextLayerType(t)) {
      const text = getTextContentFn(ch.figma)?.trim()
      if (text) out.push({ id: g, text })
    } else if (t === 'INSTANCE' || t === 'SYMBOL') {
      const text = collectDeepTextFromNode(ch, getTextContentFn) || getInstanceContent(ch.figma).trim()
      if (text) out.push({ id: g, text })
    } else if (t === 'FRAME' || t === 'GROUP') {
      const nested = collectDirectChildTextEntries(ch, getTextContentFn)
      if (nested.length) out.push(...nested)
      else {
        const mixedNested = collectMixedChildTextEntries(ch, getTextContentFn)
        if (mixedNested.length) out.push(...mixedNested)
        else {
          const deep = collectDeepTextFromNode(ch, getTextContentFn)
          if (deep) out.push({ id: g, text: deep })
        }
      }
    }
  }
  return out
}

/** 递归查找名称含「功能说明」的 FRAME/GROUP 子节点（画面内有大量 UI 文案时，只从该层收集说明） */
function findSpecNodes(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = []
  for (const ch of node.children) {
    const name = (ch.figma.name ?? '').trim()
    if ((ch.figma.type === 'FRAME' || ch.figma.type === 'GROUP') && name.includes('功能说明')) {
      result.push(ch)
    } else {
      result.push(...findSpecNodes(ch))
    }
  }
  return result
}

/**
 * 从各「功能说明」子树内收集带 id 的 TEXT（不含功能说明框外的内部 UI 文案）。
 * 与「frame 直接包一层说明文字」（走 getFrameContent）区分：仅当存在功能说明层时使用本函数结果。
 */
function getFunctionSpecTextsFromFrame(
  frameNode: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string
): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  for (const specNode of findSpecNodes(frameNode)) {
    function walk(n: TreeNode) {
      for (const ch of n.children) {
        if (isFigmaTextLayerType(ch.figma.type)) {
          const t = getTextContentFn(ch.figma)
          const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
          if (t && g) out.push({ id: g, text: t })
        }
        walk(ch)
      }
    }
    walk(specNode)
  }
  return out
}

/** 所有「功能说明」子树内的节点 guid（含功能说明框自身及后代），用于从 frame 内部 UI 文案中排除 */
function collectSpecSubtreeGuids(frameNode: TreeNode): Set<string> {
  const out = new Set<string>()
  for (const specRoot of findSpecNodes(frameNode)) {
    collectDescendantGuids(specRoot, out)
  }
  return out
}

/**
 * 已写入任一元素 functionalDescription 的 TEXT（下方吸附、兄弟说明等），不再保留为独立 TEXT 节点，避免 JSON 重复。
 * 递归处理 `children`，与嵌套展开结构一致。
 */
function dropTextNodesAdsorbedIntoFunctionalDescription<
  T extends {
    id: string
    type: string
    functionalDescription?: Array<{ id: string }>
    children?: T[]
  }
>(elements: T[]): T[] {
  const fdTextIds = new Set<string>()
  function collectFd(nodes: T[]) {
    for (const node of nodes) {
      for (const f of node.functionalDescription ?? []) {
        if (f.id) fdTextIds.add(f.id)
      }
      if (node.children?.length) collectFd(node.children)
    }
  }
  collectFd(elements)

  function filterLevel(nodes: T[]): T[] {
    return nodes
      .filter((node) => !isFigmaTextLayerType(node.type) || !fdTextIds.has(node.id))
      .map((node) => {
        if (!node.children?.length) return node
        return { ...node, children: filterLevel(node.children) }
      })
  }
  return filterLevel(elements)
}

/** 合并 functionalDescription 条目并按 id 去重（先 spec 后布局吸附） */
function mergeFunctionalDescription(
  ...parts: Array<Array<{ id: string; text: string; elementId?: string }> | undefined>
): Array<{ id: string; text: string; elementId?: string }> {
  const seen = new Set<string>()
  const out: Array<{ id: string; text: string; elementId?: string }> = []
  for (const part of parts) {
    if (!part?.length) continue
    for (const item of part) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/**
 * 按画布阅读顺序排序文案块：自上而下（Y 增大），同一水平带内从左到右（X）。
 * 无 bounds 的条目排在末尾，相互间保持原顺序。
 */
function sortTextEntriesByCanvasPosition<T extends { id: string }>(
  entries: T[],
  bounds: Map<string, { x: number; y: number; w: number; h: number }>
): T[] {
  return [...entries].sort((a, b) => {
    const ba = bounds.get(a.id)
    const bb = bounds.get(b.id)
    if (ba && bb) {
      const dy = ba.y - bb.y
      if (dy !== 0) return dy
      return ba.x - bb.x
    }
    if (ba && !bb) return -1
    if (!ba && bb) return 1
    return 0
  })
}

/** TEXT 的直接父节点 Figma type */
function getTextDirectParentType(textGuid: string, parentMap: Map<string, TreeNode>): string | undefined {
  return parentMap.get(textGuid)?.figma.type
}

/** 某 FRAME 直子中是否存在子 FRAME（如图框），用于识别「与图 frame 同层的说明 TEXT」 */
function frameHasDirectChildFrame(frameNode: TreeNode): boolean {
  return frameNode.children.some((c) => c.figma.type === 'FRAME')
}

/**
 * TEXT 作为「整个导出 FRAME」的功能说明：直接父节点就是当前导出的 frame，且该 frame 下同时有子 FRAME（图）与 TEXT。
 * 图 frame 内部的字仍算 UI，父节点为内层 frame → 不进此分支。
 *
 * 几何判定：计算所有直子 FRAME 的水平联合区域，若文本元素的起始 X 位于联合区域右侧
 * 则视为旁注说明（功能说明）；与联合区域有水平重叠则视为 UI 文案。
 * 这样既能正确识别屏幕右侧的规格文字、GROUP 包裹的多行说明文字，
 * 也不会误伤屏幕上方/下方的导航栏、底栏等 INSTANCE 组件。
 */
function isTextFunctionalBesideInnerFrame(
  textGuid: string,
  exportingFrameGuid: string,
  parentMap: Map<string, TreeNode>,
  exportingFrameNode: TreeNode,
  boundsMap?: Map<string, BoundsRect>
): boolean {
  const p = parentMap.get(textGuid)
  if (!p?.figma.guid || p.figma.type !== 'FRAME') {
    if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
      _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): false - parent not FRAME (type=${p?.figma.type})`)
    return false
  }
  if (guidToString(p.figma.guid) !== exportingFrameGuid) {
    if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
      _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): false - parent(${guidToString(p.figma.guid)}) != exportingFrame(${exportingFrameGuid})`)
    return false
  }
  const hasChildFrame = frameHasDirectChildFrame(exportingFrameNode)
  if (!hasChildFrame) {
    if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
      _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): false - no direct child FRAME`)
    return false
  }

  if (boundsMap) {
    const tb = boundsMap.get(textGuid)
    if (tb) {
      let unionRight = -Infinity
      let hasFrameBounds = false
      for (const ch of exportingFrameNode.children) {
        if (ch.figma.type !== 'FRAME') continue
        const chGuid = ch.figma.guid ? guidToString(ch.figma.guid) : ''
        const cb = boundsMap.get(chGuid)
        if (!cb) continue
        hasFrameBounds = true
        const right = cb.x + cb.w
        if (right > unionRight) unionRight = right
      }

      if (hasFrameBounds) {
        const textLeft = tb.x
        if (textLeft >= unionRight) {
          if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
            _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): true - textLeft(${textLeft}) >= unionRight(${unionRight}) → text is to the RIGHT of all child FRAMEs`)
          return true
        }
        if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
          _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): false - textLeft(${textLeft}) < unionRight(${unionRight}) → text overlaps horizontally with child FRAMEs → UI`)
        return false
      }
    }
  }

  if (DEBUG_TARGET_IDS.has(exportingFrameGuid)) {
    _dbg(`  isTextFunctionalBesideInnerFrame(${textGuid}): true (fallback, no bounds data)`)
  }
  return true
}

/** 元素无名称或为通用名（demo/图片、Frame 1 等）时需用下方文字补名称 */
function hasNoOrGenericName(el: { originName?: string; mainComponentName?: string }): boolean {
  const n = ((el.originName ?? '') + (el.mainComponentName ?? '')).trim()
  if (!n) return true
  if (/^Frame\s*\d*$/i.test(n) || /^Group\s*\d*$/i.test(n)) return true
  if (/demo[/\u002f]|^图片$|^image$/i.test(n)) return true
  return false
}

/**
 * 收集元素正下方的所有 TEXT（不只最近的一条）。
 * 返回按垂直间距排序（近→远）的全部匹配 TEXT。
 * allowedTextGuids 可选，限定只考虑该集合内的 TEXT。
 * maxGap 默认 TEXT_BELOW_MAX_GAP，子模块内部可传更大值。
 */
const TEXT_BELOW_MAX_GAP = 120
const TEXT_ONLY_FRAME_MAX_AREA = 200000

function getAllTextsBelowElement(
  elBounds: { x: number; y: number; w: number; h: number },
  flat: FlatEntry[],
  boundsByGuid: Map<string, { x: number; y: number; w: number; h: number }>,
  descendantGuids: Set<string>,
  getTextContentFn: (f: FigmaNodeChange) => string,
  allowedTextGuids?: Set<string>,
  maxGap: number = TEXT_BELOW_MAX_GAP
): Array<{ id: string; text: string }> {
  const elBottom = elBounds.y + elBounds.h
  const elLeft = elBounds.x
  const elRight = elBounds.x + elBounds.w
  const results: Array<{ id: string; text: string; gap: number }> = []
  for (const e of flat) {
    if (!isFigmaTextLayerType(e.type) || !descendantGuids.has(e.guid)) continue
    if (allowedTextGuids && !allowedTextGuids.has(e.guid)) continue
    const tb = boundsByGuid.get(e.guid)
    if (!tb) continue
    if (tb.y < elBottom) continue
    const gap = tb.y - elBottom
    if (gap > maxGap) continue
    const textCenterX = tb.x + tb.w / 2
    if (textCenterX < elLeft - 80 || textCenterX > elRight + 80) continue
    const text = getTextContentFn(e.node.figma)
    if (!text) continue
    results.push({ id: e.guid, text, gap })
  }
  return results
    .sort((a, b) => a.gap - b.gap)
    .map(({ id, text }) => ({ id, text }))
}

/**
 * 检测一个 FRAME/GROUP 是否为「纯文本容器」（所有直接子节点都是 TEXT），
 * 若是，则合并其内部所有文字，作为一个整体文本源参与吸附。
 */
function getTextOnlyFrameMergedContent(
  node: TreeNode,
  getTextContentFn: (f: FigmaNodeChange) => string,
  boundsByGuid: Map<string, { x: number; y: number; w: number; h: number }>
): { mergedText: string; firstId: string; allIds: string[] } | null {
  if (isDirectTextOnlyContainerNode(node)) {
    const entries = collectDirectChildTextEntries(node, getTextContentFn)
    if (entries.length === 0) return null
    const sorted = sortTextEntriesByCanvasPosition(entries, boundsByGuid)
    return {
      mergedText: sorted.map(t => t.text).join('\n'),
      firstId: sorted[0].id,
      allIds: sorted.map(t => t.id)
    }
  }
  if (isMixedTextContainerNode(node, getTextContentFn)) {
    const entries = collectMixedChildTextEntries(node, getTextContentFn)
    if (entries.length === 0) return null
    const sorted = sortTextEntriesByCanvasPosition(entries, boundsByGuid)
    return {
      mergedText: sorted.map(t => t.text).join('\n'),
      firstId: sorted[0].id,
      allIds: sorted.map(t => t.id)
    }
  }
  if (isAnnotationLikeFrame(node)) {
    const entries = collectMixedChildTextEntries(node, getTextContentFn)
    if (entries.length === 0) return null
    const sorted = sortTextEntriesByCanvasPosition(entries, boundsByGuid)
    return {
      mergedText: sorted.map(t => t.text).join('\n'),
      firstId: sorted[0].id,
      allIds: sorted.map(t => t.id)
    }
  }
  return null
}

/** 该 TEXT 是否在某个 FRAME/GROUP 内部（沿 parentMap 向上遇到 FRAME/GROUP 则为 true） */
function isTextInsideFrame(
  textGuid: string,
  parentMap: Map<string, TreeNode>,
  elementById: Map<string, { type: string }>
): boolean {
  let current: string | undefined = textGuid
  while (current) {
    const parent = parentMap.get(current)
    if (!parent?.figma.guid) break
    const parentGuid = guidToString(parent.figma.guid)
    const parentEl = elementById.get(parentGuid)
    if (parentEl && (parentEl.type === 'FRAME' || parentEl.type === 'GROUP')) return true
    current = parentGuid
  }
  return false
}

/**
 * 从 textGuid 沿 parentMap 向上走，若在到达 exportingFrameGuid 之前经过了某个 FRAME 节点
 * 则说明该 TEXT 在导出 FRAME 的某后代 FRAME 内部（属于 UI 模拟画面），不应被视为规格说明。
 */
function isTextInsideDescendantFrame(
  textGuid: string,
  exportingFrameGuid: string,
  parentMap: Map<string, TreeNode>
): boolean {
  let current: string | undefined = textGuid
  const chain: string[] = []
  while (current) {
    const parent = parentMap.get(current)
    if (!parent?.figma.guid) break
    const parentGuid = guidToString(parent.figma.guid)
    chain.push(`${parent.figma.type}(${parentGuid}/${parent.figma.name ?? ''})`)
    if (parentGuid === exportingFrameGuid) {
      if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
        _dbg(`    isTextInsideDescendantFrame(${textGuid}): false - reached exporting frame. Chain: ${chain.join(' → ')}`)
      return false
    }
    if (parent.figma.type === 'FRAME') {
      if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
        _dbg(`    isTextInsideDescendantFrame(${textGuid}): true - found intermediate FRAME. Chain: ${chain.join(' → ')}`)
      return true
    }
    current = parentGuid
  }
  if (DEBUG_TARGET_IDS.has(exportingFrameGuid))
    _dbg(`    isTextInsideDescendantFrame(${textGuid}): false - no parent chain to exporting frame. Chain: ${chain.join(' → ')}`)
  return false
}

type NestExpandMarkerEl = {
  type: string
  displayName?: string
  originName?: string
  frameContent?: { title: string }
}

/**
 * 从 TEXT 沿 parent 链向 section 走，遇到的第一层「含子模块展开标记」的 FRAME/GROUP（离该字最近的一层模块根）。
 */
function findInnermostNestScopeRootContainingText(
  textGuid: string,
  sectionGuid: string,
  parentMap: Map<string, TreeNode>,
  elementById: Map<string, NestExpandMarkerEl>,
  nestMarkers: string[]
): string | undefined {
  let cur: string | undefined = textGuid
  for (let i = 0; i < 400 && cur; i++) {
    const p = parentMap.get(cur)
    if (!p?.figma.guid) break
    const pg = guidToString(p.figma.guid)
    if (pg === sectionGuid) break
    const pel = elementById.get(pg)
    if (
      pel &&
      (pel.type === 'FRAME' || pel.type === 'GROUP') &&
      frameHasNestExpandMarker(pel, nestMarkers)
    ) {
      return pg
    }
    cur = pg
  }
  return undefined
}

/**
 * TEXT 是否挂在「模块根」下的版心外区域：沿父链上到 scopeRoot 的过程中不得经过其它 FRAME（允许经过 GROUP）。
 * 若已进入子模版 FRAME（如「列举目标」）则 false，与 section 下「只在多个顶层 frame 之间算游离」同构。
 */
function isLayoutSiblingUnderScopeRoot(
  textGuid: string,
  scopeRootGuid: string,
  parentMap: Map<string, TreeNode>,
  elementById: Map<string, { type: string }>
): boolean {
  let cur: string | undefined = textGuid
  for (let i = 0; i < 400 && cur; i++) {
    const p = parentMap.get(cur)
    if (!p?.figma.guid) return false
    const pg = guidToString(p.figma.guid)
    if (pg === scopeRootGuid) return true
    const pel = elementById.get(pg)
    if (pel?.type === 'FRAME') return false
    cur = pg
  }
  return false
}

/** 与 section 下「多 frame + 下方字」同一套吸附池：真·画布游离，或子模块根下未进子模版 FRAME 的字 */
function isTextEligibleForCrossFrameBelowAttach(
  textGuid: string,
  sectionGuid: string,
  parentMap: Map<string, TreeNode>,
  elementById: Map<string, NestExpandMarkerEl>,
  nestMarkers: string[]
): boolean {
  if (!isTextInsideFrame(textGuid, parentMap, elementById)) return true
  const nestRoot = findInnermostNestScopeRootContainingText(
    textGuid,
    sectionGuid,
    parentMap,
    elementById,
    nestMarkers
  )
  if (!nestRoot) return false
  return isLayoutSiblingUnderScopeRoot(textGuid, nestRoot, parentMap, elementById)
}

/** 构建 guid -> 父节点 的映射（仅对 root 的后代，root 自身不入表） */
function buildParentMap(root: TreeNode, out: Map<string, TreeNode>): void {
  for (const ch of root.children) {
    if (ch.figma.guid) out.set(guidToString(ch.figma.guid), root)
    buildParentMap(ch, out)
  }
}

/** 两矩形最小距离（不重叠时为最近两边的直线距离） */
function rectToRectDist(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h
  const bx2 = b.x + b.w
  const by2 = b.y + b.h
  const dx = Math.max(0, Math.max(a.x - bx2, b.x - ax2))
  const dy = Math.max(0, Math.max(a.y - by2, b.y - ay2))
  return Math.sqrt(dx * dx + dy * dy)
}

/** 与某节点同父级下的兄弟 TEXT（图与说明同在 FRAME 内、文字不是图的子层时常用这种结构） */
function collectSiblingTextsForElement(
  nodeGuid: string,
  parentMap: Map<string, TreeNode>,
  getTextContentFn: (f: FigmaNodeChange) => string
): Array<{ id: string; text: string }> {
  const parent = parentMap.get(nodeGuid)
  if (!parent) return []
  const out: Array<{ id: string; text: string }> = []
  for (const ch of parent.children) {
    const g = ch.figma.guid ? guidToString(ch.figma.guid) : ''
    if (!g || g === nodeGuid) continue
    if (!isFigmaTextLayerType(ch.figma.type)) continue
    const t = getTextContentFn(ch.figma)?.trim()
    if (t) out.push({ id: g, text: t })
  }
  return out
}

/** 与图片/实例框在布局上邻近的 TEXT（同 section、非图子树内、矩形间距 ≤ maxDist） */
function collectTextsNearImageBounds(
  imageGuid: string,
  imageBounds: { x: number; y: number; w: number; h: number },
  flat: FlatEntry[],
  boundsByGuid: Map<string, { x: number; y: number; w: number; h: number }>,
  descendantGuids: Set<string>,
  parentMap: Map<string, TreeNode>,
  getTextContentFn: (f: FigmaNodeChange) => string,
  maxDist: number
): Array<{ id: string; text: string }> {
  const seen = new Map<string, { id: string; text: string }>()
  for (const e of flat) {
    if (!isFigmaTextLayerType(e.type) || !descendantGuids.has(e.guid)) continue
    if (e.guid === imageGuid) continue
    if (isDescendantOf(e.guid, imageGuid, parentMap)) continue
    const tb = boundsByGuid.get(e.guid)
    if (!tb) continue
    if (rectToRectDist(imageBounds, tb) > maxDist) continue
    const t = getTextContentFn(e.node.figma)?.trim()
    if (t) seen.set(e.guid, { id: e.guid, text: t })
  }
  return [...seen.values()]
}

/** 全文档收集 SYMBOL：symbolId -> 组件名称 */
function collectMainComponents(root: TreeNode, out: Map<string, string>): void {
  if (root.figma.type === 'SYMBOL' && root.figma.guid) {
    const id = guidToString(root.figma.guid)
    const name = (root.figma.name ?? id).trim()
    if (name) out.set(id, name)
  }
  for (const ch of root.children) collectMainComponents(ch, out)
}

/** 收集所有 SYMBOL 节点（主组件），便于 INSTANCE 展开底层结构 */
function collectSymbolNodes(root: TreeNode, out: Map<string, TreeNode>): void {
  if (root.figma.type === 'SYMBOL' && root.figma.guid) {
    out.set(guidToString(root.figma.guid), root)
  }
  for (const ch of root.children) collectSymbolNodes(ch, out)
}

/** 若为组件实例，解析主组件 id 与名称 */
function getInstanceMainComponent(
  node: TreeNode,
  symbolIdToName: Map<string, string>
): { mainComponentId: string; mainComponentName: string } | null {
  const f = node.figma
  if (f.type !== 'INSTANCE' && f.type !== 'SYMBOL') return null
  const guid = f.type === 'INSTANCE'
    ? (f.overriddenSymbolID ?? f.symbolData?.symbolID)
    : f.guid
  if (!guid) return null
  const id = guidToString(guid)
  const name = symbolIdToName.get(id) ?? (f.type === 'SYMBOL' ? (f.name ?? id).trim() : null)
  if (!name) return null
  return { mainComponentId: id, mainComponentName: name }
}

/** 在树中递归收集所有 type === 'SECTION' 的节点 */
function collectSectionNodes(root: TreeNode, out: TreeNode[]): void {
  if (root.figma.type === 'SECTION' && root.figma.guid) out.push(root)
  for (const ch of root.children) collectSectionNodes(ch, out)
}

const MIN_SECTION_W = 60
const MIN_SECTION_H = 60

/**
 * 默认嵌套展开标记：仅「子模块」——图层名 / displayName / frame 标题含该子串时展开下一层子 FRAME/GROUP 为 children。
 * 需其它标记时通过 `nestedExpandMarkers` 覆盖。
 */
const DEFAULT_PRD_NEST_MARKERS = ['子模块']

function frameHasNestExpandMarker(
  el: { displayName?: string; originName?: string; frameContent?: { title: string } },
  markers: string[]
): boolean {
  if (!markers.length) return false
  const raw = (el.displayName ?? el.frameContent?.title ?? el.originName ?? '').trim()
  return markers.some((m) => m.length > 0 && raw.includes(m))
}

function stripNestMarkersFromTitle(title: string, markers: string[]): string {
  if (!markers.length) return title
  let s = title
  const uniq = [...new Set(markers.filter(Boolean))]
  uniq.sort((a, b) => b.length - a.length)
  for (const m of uniq) {
    if (m === '子模块') {
      s = s.replace(/[(（]\s*子模块\s*[)）]/g, '')
      s = s.split('子模块').join('')
    } else {
      s = s.split(m).join('')
    }
  }
  s = s.replace(/\(\s*\)/g, '').replace(/（\s*）/g, '')
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s || title
}

function hasSubModuleMarker(name: string | undefined): boolean {
  return (name ?? '').includes('子模块')
}

/**
 * TEXT 图层名含以下任一子串时，其功能说明保留在带嵌套展开标记的父容器上，不下推到子 FRAME。
 * 需在 Figma 里给对应 TEXT 图层命名（如「整体功能说明：xxx」）。
 */
const OVERALL_SECTION_FD_LAYER_MARKERS = ['整体功能说明', '[整体说明]', 'PRD_SECTION_FD', 'section整体说明']

/** 检查 FRAME/GROUP 名称是否标记为整体功能说明（不参与吸附，直接路由到 section/模块级 functionalDescription） */
function isFrameNamedOverallFd(name: string | undefined): boolean {
  const n = (name ?? '').trim()
  return OVERALL_SECTION_FD_LAYER_MARKERS.some((m) => n.includes(m))
}

function isTextLayerMarkedOverallSectionFd(
  textGuid: string,
  flatByGuid: Map<string, { name?: string; node: TreeNode }>
): boolean {
  const e = flatByGuid.get(textGuid)
  if (!e) return false
  const raw = `${e.name ?? ''} ${e.node?.figma?.name ?? ''}`
  return OVERALL_SECTION_FD_LAYER_MARKERS.some((m) => raw.includes(m))
}

type NestRedistTreeEl = {
  id: string
  type: string
  functionalDescription?: Array<{ id: string; text: string }>
  children?: NestRedistTreeEl[]
}

/** 输出树 children 上所有 FRAME/GROUP 的 id（深度优先） */
function collectDescendantFrameGroupIdsFromTreeEls(children: NestRedistTreeEl[]): string[] {
  const out: string[] = []
  function walk(nodes: NestRedistTreeEl[]) {
    for (const n of nodes) {
      if (n.type === 'FRAME' || n.type === 'GROUP') {
        out.push(n.id)
        if (n.children?.length) walk(n.children)
      }
    }
  }
  walk(children)
  return out
}

function findTreeElByIdInForest(roots: NestRedistTreeEl[], id: string): NestRedistTreeEl | undefined {
  for (const r of roots) {
    if (r.id === id) return r
    if (r.children?.length) {
      const hit = findTreeElByIdInForest(r.children, id)
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * 带嵌套展开标记的父节点：规范上不应承载子块说明；将 functionalDescription 下推到最近子 FRAME（几何 + 无脑回退），
 * 仅「整体功能说明」命名的 TEXT 保留在父级。
 */
function redistributeNestParentFunctionalDescriptions(
  roots: NestRedistTreeEl[],
  options: {
    elementById: Map<
      string,
      { type?: string; originName?: string; displayName?: string; frameContent?: { title: string } }
    >
    nestMarkers: string[]
    bounds: Map<string, { x: number; y: number; w: number; h: number }>
    flatByGuid: Map<string, { name?: string; node: TreeNode }>
  }
): void {
  const { elementById, nestMarkers, bounds, flatByGuid } = options

  function visit(node: NestRedistTreeEl): void {
    const el = elementById.get(node.id)
    if (
      el &&
      (el.type === 'FRAME' || el.type === 'GROUP') &&
      frameHasNestExpandMarker(el, nestMarkers) &&
      node.children?.length &&
      node.functionalDescription?.length
    ) {
      const stay: Array<{ id: string; text: string }> = []
      const move: Array<{ id: string; text: string }> = []
      for (const fd of node.functionalDescription) {
        if (isTextLayerMarkedOverallSectionFd(fd.id, flatByGuid)) stay.push(fd)
        else move.push(fd)
      }
      const childFrameIds = collectDescendantFrameGroupIdsFromTreeEls(node.children)
      const recovered: Array<{ id: string; text: string }> = []
      if (childFrameIds.length === 0) {
        node.functionalDescription = sortTextEntriesByCanvasPosition([...stay, ...move], bounds)
      } else {
        for (const fd of move) {
          const directIds = node.children
            .filter((c) => c.type === 'FRAME' || c.type === 'GROUP')
            .map((c) => c.id)
          let targetId =
            directIds.length > 0 ? getTextAttachedChildId(fd.id, bounds, directIds) : undefined
          if (!targetId) {
            const first = node.children.find((c) => c.type === 'FRAME' || c.type === 'GROUP')
            targetId = first?.id
          }
          const target = targetId ? findTreeElByIdInForest(node.children, targetId) : undefined
          if (target) {
            if (!target.functionalDescription) target.functionalDescription = []
            if (!target.functionalDescription.some((l) => l.id === fd.id)) {
              target.functionalDescription.push({ id: fd.id, text: fd.text })
            }
          } else {
            recovered.push(fd)
          }
        }
        const merged = [...stay, ...recovered]
        node.functionalDescription = merged.length
          ? sortTextEntriesByCanvasPosition(merged, bounds)
          : undefined
      }
    }
    for (const c of node.children ?? []) visit(c)
  }

  for (const r of roots) visit(r)

  function sortFdDeep(nodes: NestRedistTreeEl[]) {
    for (const n of nodes) {
      if (n.functionalDescription?.length) {
        n.functionalDescription = sortTextEntriesByCanvasPosition(n.functionalDescription, bounds)
      }
      if (n.children?.length) sortFdDeep(n.children)
    }
  }
  sortFdDeep(roots)
}

/** 解析选项，不传或传大值即不限制大小 */
const DEFAULT_PARSE_OPTIONS = {
  maxCompressedSize: 1024 * 1024 * 1024,
  maxUnzippedSize: 4 * 1024 * 1024 * 1024,
  maxImageSize: 200 * 1024 * 1024,
}

// ╔═══════════════════════════════════════════════════════════════╗
// ║  路线A: PRD 提取 (generatePrdFromFig / pruneForDify)          ║
// ║  从 .fig 提取结构化 PRD JSON (sections → elements → texts)    ║
// ║  核心遍历: flattenWithBounds → classifyText                   ║
// ║  不涉及: flatCollect / _resolveChildVisibility 等 Style 函数  ║
// ╚═══════════════════════════════════════════════════════════════╝

/** 仅解析 .fig 并返回页面名称列表（供版本选择），不限制大小时可传极大 parseOptions */
export function listPageVersions(
  buffer: ArrayBuffer,
  parseOptions?: { maxCompressedSize?: number; maxUnzippedSize?: number; maxImageSize?: number }
): { name: string; index: number }[] {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...parseOptions }
  const decoded = parseFigFile(buffer, opts)
  const tree = buildTree(decoded.nodeChanges)
  if (!tree) return []
  const pages = tree.children.filter(isUserPage)
  return pages.map((p, i) => ({ name: (p.figma.name ?? `Page ${i + 1}`).trim(), index: i }))
}

/** 从 .fig buffer 提取 images，返回 Map<fileName, Uint8Array>（浏览器/Node 通用） */
export function extractFigImages(
  buffer: ArrayBuffer,
  parseOptions?: { maxCompressedSize?: number; maxUnzippedSize?: number; maxImageSize?: number }
): Map<string, Uint8Array> {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...parseOptions }
  const decoded = parseFigFile(buffer, opts)
  const result = new Map<string, Uint8Array>()
  for (const [key, bytes] of decoded.imageFiles) {
    const fileName = key.includes('.') ? key : `${key}.png`
    result.set(fileName, new Uint8Array(bytes))
  }
  return result
}

export interface FigToPrdOptions {
  version?: string
  baseName?: string
  parseOptions?: { maxCompressedSize?: number; maxUnzippedSize?: number; maxImageSize?: number }
  /**
   * 嵌套展开标记：FRAME/GROUP 的 **图层名 / displayName** 含任一子串时，将其 **下一层** 子 FRAME/GROUP
   * 挂到该节点的 **`children`**（每条仍走完整抽取：吸附、框内/说明文案、连线）；子节点若也含标记则递归生成更深 `children`。
   * 默认为 `['子模块']`；传空数组 `[]` 关闭。
   */
  nestedExpandMarkers?: string[]
}

export interface FigToPrdOutput {
  documentName: string
  versionFilter: string | null
  pageName: string
  usageHint: string
  sections: Array<{
    id: string
    name: string
    bounds?: { x: number; y: number; w: number; h: number }
    /** 无可吸附到具体块上的游离说明，作为本 section 整体功能说明 */
    functionalDescription?: Array<{ id: string; text: string }>
    elements: unknown[]
  }>
}

/** 从 .fig buffer 生成 PRD JSON 对象，可被 CLI 或 Electron 等调用；不限制大小时传极大 parseOptions */
export function generatePrdFromFig(buffer: ArrayBuffer, options: FigToPrdOptions = {}): FigToPrdOutput {
  const versionArg = options.version
  const baseName = options.baseName ?? 'document'
  const parseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options.parseOptions }
  const nestMarkers =
    options.nestedExpandMarkers !== undefined ? options.nestedExpandMarkers : DEFAULT_PRD_NEST_MARKERS

  const decoded = parseFigFile(buffer, parseOptions)
  const tree = buildTree(decoded.nodeChanges)
  if (!tree) throw new Error('No document root in .fig')
  const pages = tree.children.filter(isUserPage)
  if (pages.length === 0) throw new Error('No user pages in .fig')
  let pageIndex = 0
  if (versionArg) {
    const i = pages.findIndex((p) => (p.figma.name ?? '').includes(versionArg))
    if (i >= 0) pageIndex = i
    else throw new Error(`Version "${versionArg}" not found in page names`)
  }
  const page = pages[pageIndex]
  const pageName = page.figma.name ?? `Page ${pageIndex + 1}`

  const symbolIdToName = new Map<string, string>()
  const symbolIdToNode = new Map<string, TreeNode>()
  for (const canvas of tree.children) {
    collectMainComponents(canvas, symbolIdToName)
    collectSymbolNodes(canvas, symbolIdToNode)
  }

  const flat = flattenWithBounds(page, 0, 0)
  const flatByGuid = new Map(flat.map((e) => [e.guid, e]))

  const parentMap = new Map<string, TreeNode>()
  buildParentMap(page, parentMap)

  // 1) Section = 图中「一大块」：优先用 Figma 的 SECTION 类型；没有则用页面下顶层 FRAME/GROUP
  const sectionCandidates: TreeNode[] = []
  collectSectionNodes(page, sectionCandidates)

  if (sectionCandidates.length === 0) {
    for (const ch of page.children) {
      if ((ch.figma.type === 'FRAME' || ch.figma.type === 'GROUP') && ch.figma.guid) {
        const e = flatByGuid.get(guidToString(ch.figma.guid))
        if (e && e.absW >= MIN_SECTION_W && e.absH >= MIN_SECTION_H) sectionCandidates.push(ch)
      }
    }
  }

  const sections: Array<{
    id: string
    name: string
    /** section 在画布上的包围框，便于裁剪 section 图或生成 sectionImage */
    bounds?: { x: number; y: number; w: number; h: number }
    functionalDescription?: Array<{ id: string; text: string }>
    elements: Array<Record<string, unknown> & { id: string; children?: unknown[] }>
  }> = []
  let connectorViaAttached = 0
  let connectorViaCoords = 0
  const connectorViaCoordsIds: string[] = []

  for (const sectionNode of sectionCandidates) {
    const sectionGuid = sectionNode.figma.guid ? guidToString(sectionNode.figma.guid) : ''
    const sectionName = (sectionNode.figma.name ?? sectionGuid).trim()
    if (!sectionGuid) continue

    const descendantGuids = new Set<string>()
    collectDescendantGuids(sectionNode, descendantGuids)
    descendantGuids.delete(sectionGuid)

    const boundsByGuid = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const e of flat) {
      if (!descendantGuids.has(e.guid)) continue
      boundsByGuid.set(e.guid, { x: e.absX, y: e.absY, w: e.absW, h: e.absH })
    }
    const elementGuids = new Set<string>()
    for (const e of flat) {
      if (!descendantGuids.has(e.guid) || e.type === 'CONNECTOR' || e.type === 'LINE') continue
      elementGuids.add(e.guid)
    }
    const boundsElementOnly = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const [guid, b] of boundsByGuid) {
      if (elementGuids.has(guid)) boundsElementOnly.set(guid, b)
    }

    type El = {
      id: string
      type: string
      originName?: string
      displayName?: string
      text?: string
      /** 功能说明：框外下方/兄弟/邻近说明等 */
      functionalDescription?: Array<{ id: string; text: string }>
      frameContent?: { title: string; texts: Array<{ id: string; text: string }> }
      /** 游离且未吸附到任何元素的 TEXT 标注：可能为整个 section 的整体功能说明或数据处理逻辑 */
      sectionLevelHint?: string
      isComponentInstance?: boolean
      mainComponentId?: string
      mainComponentName?: string
      from?: Array<{ id: string; name?: string; label?: string; blockId?: string }>
      to?: Array<{ id: string; name?: string; label?: string; blockId?: string }>
    }
    /** 输出：FRAME/GROUP 的 texts=框内 UI 文案；functionalDescription=功能说明（含「功能说明」子层全文 + 布局吸附说明） */
    type TreeEl = Omit<El, 'frameContent' | 'functionalDescription'> & {
      title?: string
      texts?: Array<{ id: string; text: string; elementId?: string }>
      functionalDescription?: Array<{ id: string; text: string; elementId?: string }>
      /** 名称含嵌套展开标记时：下一层子 FRAME/GROUP，结构与根级 element 相同，可继续嵌套 */
      children?: TreeEl[]
      fromMainComponent?: boolean
    }
    const elements: El[] = []
    const elementById = new Map<string, El>()
    for (const e of flat) {
      if (!descendantGuids.has(e.guid) || e.type === 'CONNECTOR' || e.type === 'LINE') continue
      const f = e.node.figma
      const type = e.type
      let name = e.name || undefined
      const textFromNode = isFigmaTextLayerType(type) ? getTextContent(f) : undefined
      const contentFromInstance = (type === 'INSTANCE' || type === 'SYMBOL') ? getInstanceContent(f, symbolIdToNode) : undefined
      const text = contentFromInstance || textFromNode

      const el: El = {
        id: e.guid,
        type,
        originName: name,
        ...(text && { text }),
      }
      if (type === 'FRAME' || type === 'GROUP') {
        const fc = getFrameContent(e.node, flat, getTextContent, symbolIdToNode)
        el.frameContent = { title: fc.title, texts: fc.texts }
        if (fc.title) el.displayName = fc.title
      }
      const main = getInstanceMainComponent(e.node, symbolIdToName)
      if (main) {
        el.isComponentInstance = true
        el.mainComponentId = main.mainComponentId
        el.mainComponentName = main.mainComponentName
      }
      elements.push(el)
      elementById.set(el.id, el)
    }

    /**
     * Step 0: 名为「整体功能说明」的 FRAME/GROUP → 不参与吸附逻辑，
     * 内容直接路由到 section 或子模块级 functionalDescription。
     */
    const overallFdForSection: Array<{ id: string; text: string }> = []
    const overallFdHandledIds = new Set<string>()
    {
      for (let idx = elements.length - 1; idx >= 0; idx--) {
        const el = elements[idx]
        if (el.type !== 'FRAME' && el.type !== 'GROUP') continue
        if (!isFrameNamedOverallFd(el.originName)) continue

        const entry = flatByGuid.get(el.id)
        if (!entry?.node) continue

        const pNode = parentMap.get(el.id)
        const pGuid = pNode?.figma.guid ? guidToString(pNode.figma.guid) : undefined
        const isDirectChildOfSection = pGuid === sectionGuid
        const pEl = pGuid ? elementById.get(pGuid) : undefined
        const isDirectChildOfNestModule = !!pEl
          && (pEl.type === 'FRAME' || pEl.type === 'GROUP')
          && frameHasNestExpandMarker(pEl, nestMarkers)

        if (!isDirectChildOfSection && !isDirectChildOfNestModule) continue

        const allTexts: Array<{ id: string; text: string }> = []
        const descGuids = new Set<string>()
        collectDescendantGuids(entry.node, descGuids)

        for (const dg of descGuids) {
          const fe = flatByGuid.get(dg)
          if (!fe) continue
          if (!isFigmaTextLayerType(fe.type)) continue
          const txt = getTextContent(fe.node.figma)
          if (txt) allTexts.push({ id: dg, text: txt })
        }

        if (!allTexts.length) continue

        const sorted = sortTextEntriesByCanvasPosition(allTexts, boundsElementOnly)
        const mergedText = sorted.map(t => t.text).join('\n')
        const canonId = sorted[0].id

        overallFdHandledIds.add(el.id)
        for (const dg of descGuids) overallFdHandledIds.add(dg)

        if (isDirectChildOfNestModule && pGuid) {
          const modEl = elementById.get(pGuid)
          if (modEl) {
            if (!modEl.functionalDescription) modEl.functionalDescription = []
            if (!modEl.functionalDescription.some(f => f.id === canonId)) {
              modEl.functionalDescription.push({ id: canonId, text: mergedText })
            }
          }
        } else {
          overallFdForSection.push({ id: canonId, text: mergedText })
        }

        elementById.delete(el.id)
        elements.splice(idx, 1)
      }
      if (overallFdHandledIds.size > 0) {
        for (let idx = elements.length - 1; idx >= 0; idx--) {
          if (overallFdHandledIds.has(elements[idx].id)) {
            elementById.delete(elements[idx].id)
            elements.splice(idx, 1)
          }
        }
      }
    }

    /** 嵌套父下：仅含多个直接子 TEXT 的子 FRAME/GROUP 合并为 \\n 块，按容器外框吸附到上方兄弟子块 */
    const textIdsHandledAsNestTextBundle = new Set<string>()
    for (const el of elements) {
      if (el.type !== 'FRAME' && el.type !== 'GROUP') continue
      if (!frameHasNestExpandMarker(el, nestMarkers)) continue
      const frameEntry = flatByGuid.get(el.id)
      if (!frameEntry) continue
      const specGuids = collectSpecSubtreeGuids(frameEntry.node)
      const childIds = elements
        .filter(
          (e) =>
            parentMap.get(e.id)?.figma.guid &&
            guidToString(parentMap.get(e.id)!.figma.guid) === el.id &&
            e.type !== 'TEXT'
        )
        .map((e) => e.id)
      if (!childIds.length) continue
      for (const childEl of elements) {
        if (childEl.type !== 'FRAME' && childEl.type !== 'GROUP') continue
        const p = parentMap.get(childEl.id)
        if (!p?.figma.guid || guidToString(p.figma.guid) !== el.id) continue
        const centry = flatByGuid.get(childEl.id)
        if (!centry) continue
        const isStrict = isDirectTextOnlyContainerNode(centry.node)
        const isMixed = !isStrict && isMixedTextContainerNode(centry.node, getTextContent)
        if (!isStrict && !isMixed) continue
        const textEntries = isStrict
          ? collectDirectChildTextEntries(centry.node, getTextContent)
          : collectMixedChildTextEntries(centry.node, getTextContent)
        if (textEntries.length < 2) continue
        if (textEntries.some((t) => specGuids.has(t.id))) continue
        const sorted = sortTextEntriesByCanvasPosition(textEntries, boundsElementOnly)
        const bundleBounds = boundsElementOnly.get(childEl.id)
        if (!bundleBounds) continue
        const attachChildIds = childIds.filter(cid => cid !== childEl.id)
        let targetId = getTextAttachedChildIdForRect(
          bundleBounds,
          boundsElementOnly,
          attachChildIds,
          TEXT_BELOW_MAX_GAP,
          80
        )
        if (!targetId) {
          targetId = attachFreeRectAbove(bundleBounds, boundsElementOnly, attachChildIds, {
            skipContainCenter: true,
          })
        }
        const mergedText = sorted.map((x) => x.text).join('\n')
        const canonId = sorted[0].id
        if (!targetId) {
          continue
        }
        const target = elementById.get(targetId)
        if (!target) {
          continue
        }
        if (!target.functionalDescription) target.functionalDescription = []
        if (!target.functionalDescription.some((l) => l.id === canonId)) {
          target.functionalDescription.push({ id: canonId, text: mergedText })
        }
        for (const x of sorted) textIdsHandledAsNestTextBundle.add(x.id)
        textIdsHandledAsNestTextBundle.add(childEl.id)
      }
    }

    /** 框内 UI 文案（非功能说明子树）若布局上贴近某子块，补到该子元素的 functionalDescription */
    for (const el of elements) {
      if (el.type !== 'FRAME' && el.type !== 'GROUP' || !el.frameContent?.texts.length) continue
      const frameEntry = flatByGuid.get(el.id)
      if (!frameEntry) continue
      const specGuids = collectSpecSubtreeGuids(frameEntry.node)
      const childIds = elements
        .filter(
          (e) =>
            parentMap.get(e.id)?.figma.guid &&
            guidToString(parentMap.get(e.id)!.figma.guid) === el.id &&
            e.type !== 'TEXT'
        )
        .map((e) => e.id)
      const getParentGuidEarly = (id: string): string | undefined => {
        const p = parentMap.get(id)
        return p?.figma.guid ? guidToString(p.figma.guid) : undefined
      }
      const descendantVisualEarly = collectDescendantVisualBlockIds(elements, getParentGuidEarly, el.id).filter(
        (id) => !specGuids.has(id)
      )
      for (const t of el.frameContent.texts) {
        if (textIdsHandledAsNestTextBundle.has(t.id)) continue
        if (specGuids.has(t.id)) continue
        const pType = getTextDirectParentType(t.id, parentMap)
        if (pType !== 'FRAME' && pType !== 'GROUP') continue
        const textParentNodeEarly = parentMap.get(t.id)
        if (
          textParentNodeEarly &&
          pType === 'FRAME' &&
          (isDirectTextOnlyContainerNode(textParentNodeEarly) || isMixedTextContainerNode(textParentNodeEarly, getTextContent)) &&
          textParentNodeEarly.figma.guid &&
          guidToString(textParentNodeEarly.figma.guid) !== el.id &&
          isTextInsideDescendantFrame(guidToString(textParentNodeEarly.figma.guid), el.id, parentMap)
        ) continue
        const ancestors = collectStrictAncestorGuidsBetween(t.id, el.id, parentMap)
        const attachPool =
          descendantVisualEarly.length > 0
            ? descendantVisualEarly.filter((id) => !ancestors.has(id))
            : childIds
        const pool = attachPool.length > 0 ? attachPool : childIds
        if (attachDebugEnabled(t.id)) {
          const nm = (eid: string) =>
            elementById.get(eid)?.displayName ??
            elementById.get(eid)?.originName ??
            elementById.get(eid)?.mainComponentName ??
            eid
          const parentLabel = el.displayName ?? el.originName ?? el.id
          const list = pool.map((id) => `${id} «${nm(id)}»`)
          const cap = 18
          const shown = list.length <= cap ? list.join('; ') : `${list.slice(0, cap).join('; ')} …(+${list.length - cap})`
          console.warn(
            '[FIG-PRD-ATTACH] pool-context:',
            'textId=',
            t.id,
            'parentFrame=',
            el.id,
            '«' + parentLabel + '»',
            '| descendantVisual=',
            descendantVisualEarly.length,
            'childIds=',
            childIds.length,
            'attachPool=',
            attachPool.length,
            'pool(fallback if attachPool empty)=',
            pool.length,
            '|',
            shown
          )
        }
        const elementId = getTextAttachedChildId(t.id, boundsElementOnly, pool, undefined, undefined, {
          parentFrameId: el.id,
          snippet: t.text,
        })
        if (attachDebugEnabled(t.id)) {
          const nm = (eid: string) =>
            elementById.get(eid)?.displayName ??
            elementById.get(eid)?.originName ??
            elementById.get(eid)?.mainComponentName ??
            eid
          console.warn(
            '[FIG-PRD-ATTACH] resolved:',
            t.id,
            'parentFrame=',
            el.id,
            '->',
            elementId ?? '(none)',
            elementId ? `name=${nm(elementId)}` : ''
          )
        }
        if (!elementId) {
          const tb = boundsElementOnly.get(t.id)
          const geoInside = tb && descendantVisualEarly.some((cid) => {
            const cb = boundsElementOnly.get(cid)
            if (!cb) return false
            const cEntry = flatByGuid.get(cid)
            if (cEntry?.node && (isDirectTextOnlyContainerNode(cEntry.node) || isDeepTextOnlyNode(cEntry.node) || isMixedTextContainerNode(cEntry.node, getTextContent))) return false
            return tb.x >= cb.x - 10 && tb.y >= cb.y - 10 && tb.x + tb.w <= cb.x + cb.w + 10 && tb.y + tb.h <= cb.y + cb.h + 10
          })
          if (!geoInside) {
            if (!el.functionalDescription) el.functionalDescription = []
            if (!el.functionalDescription.some((l) => l.id === t.id)) {
              el.functionalDescription.push({ id: t.id, text: t.text })
            }
          }
          continue
        }
        const child = elementById.get(elementId)
        if (!child) {
          const tb2 = boundsElementOnly.get(t.id)
          const geoInside2 = tb2 && descendantVisualEarly.some((cid) => {
            const cb = boundsElementOnly.get(cid)
            if (!cb) return false
            const cEntry2 = flatByGuid.get(cid)
            if (cEntry2?.node && (isDirectTextOnlyContainerNode(cEntry2.node) || isDeepTextOnlyNode(cEntry2.node) || isMixedTextContainerNode(cEntry2.node, getTextContent))) return false
            return tb2.x >= cb.x - 10 && tb2.y >= cb.y - 10 && tb2.x + tb2.w <= cb.x + cb.w + 10 && tb2.y + tb2.h <= cb.y + cb.h + 10
          })
          if (!geoInside2) {
            if (!el.functionalDescription) el.functionalDescription = []
            if (!el.functionalDescription.some((l) => l.id === t.id)) {
              el.functionalDescription.push({ id: t.id, text: t.text })
            }
          }
          continue
        }
        const has = child.functionalDescription?.some((l) => l.id === t.id)
        if (!has) {
          if (!child.functionalDescription) child.functionalDescription = []
          child.functionalDescription.push({ id: t.id, text: t.text })
        }
      }
    }

    const idToName = new Map(
      elements.map((el) => {
        const isDecisionOrAction =
          el.mainComponentName === '交互判断' || el.mainComponentName === '交互执行'
        const label =
          el.displayName ||
          (isDecisionOrAction && el.text ? el.text : el.originName) ||
          el.text ||
          el.id
        return [el.id, String(label).slice(0, 80)]
      })
    )
    /** 元素 id -> 其所在 FRAME/GROUP 的 id（整体块），用于 to/from 的 blockId */
    const containingFrameId = new Map<string, string>()
    for (const el of elements) {
      if (el.type === 'FRAME' || el.type === 'GROUP') continue
      let nodeGuid: string | undefined = el.id
      while (nodeGuid) {
        const parent = parentMap.get(nodeGuid)
        if (!parent?.figma.guid) break
        const parentGuid = guidToString(parent.figma.guid)
        const parentEl = elementById.get(parentGuid)
        if (parentEl && (parentEl.type === 'FRAME' || parentEl.type === 'GROUP')) {
          containingFrameId.set(el.id, parentGuid)
          break
        }
        nodeGuid = parentGuid
      }
    }
    /** 从每个「交互判断」已发出的连线数，用于无文案时默认标 是/否 */
    const decisionOutCount = new Map<string, number>()
    for (const e of flat) {
      if (!descendantGuids.has(e.guid)) continue
      const isConnOrLine = e.type === 'CONNECTOR' || e.type === 'LINE'
      const isVectorLine = isLineNamedThinVector(e)
      if (!isConnOrLine && !isVectorLine) continue
      const entry = flatByGuid.get(e.guid)
      if (!entry) continue
      const { x1, y1, x2, y2 } = isConnOrLine
        ? getConnectorEndpoints(entry.node.figma, entry.absX, entry.absY)
        : getThinVectorLineEndpoints(entry)
      let connectorLabel = getConnectorLabel(
        x1,
        y1,
        x2,
        y2,
        flat,
        descendantGuids,
        boundsByGuid,
        getTextContent
      )
      const boundsForResolve = boundsElementOnly
      let fromId: string | undefined
      let toId: string | undefined
      const attached = isConnOrLine ? getConnectorAttachedNodes(entry.node.figma) : {}
      const useAttached =
        isConnOrLine &&
        attached.startId &&
        attached.endId &&
        boundsForResolve.has(attached.startId) &&
        boundsForResolve.has(attached.endId) &&
        attached.startId !== e.guid &&
        attached.endId !== e.guid
      if (useAttached) {
        fromId = attached.startId
        toId = attached.endId
      }
      if (!useAttached) {
        const margin = CONNECTOR_ENDPOINT_MARGIN
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid) continue
          if (pointInRect(x1, y1, b.x, b.y, b.w, b.h)) fromId = guid
          if (pointInRect(x2, y2, b.x, b.y, b.w, b.h)) toId = guid
        }
        if (!fromId) {
        let best: { guid: string; d: number } | null = null
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid) continue
          if (!pointInRect(x1, y1, b.x - margin, b.y - margin, b.w + 2 * margin, b.h + 2 * margin)) continue
          const d = pointToRectDist(x1, y1, b.x, b.y, b.w, b.h)
          if (!best || d < best.d) best = { guid, d }
        }
        if (best && best.d <= margin) fromId = best.guid
      }
      if (!toId) {
        let best: { guid: string; d: number } | null = null
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid || guid === fromId) continue
          if (!pointInRect(x2, y2, b.x - margin, b.y - margin, b.w + 2 * margin, b.h + 2 * margin)) continue
          const d = pointToRectDist(x2, y2, b.x, b.y, b.w, b.h)
          if (!best || d < best.d) best = { guid, d }
        }
        if (best && best.d <= margin) toId = best.guid
      }
      if (!toId && fromId) {
        let bestDist = Infinity
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid || guid === fromId) continue
          const d = pointToRectDist(x2, y2, b.x, b.y, b.w, b.h)
          if (d < bestDist) {
            bestDist = d
            toId = guid
          }
        }
        if (bestDist > 150) toId = undefined
      }
      if (fromId && toId === fromId) {
        toId = undefined
        let bestDist = Infinity
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid || guid === fromId) continue
          const d = pointToRectDist(x2, y2, b.x, b.y, b.w, b.h)
          if (d < bestDist) {
            bestDist = d
            toId = guid
          }
        }
        if (bestDist > 200) toId = undefined
      }
      if (!fromId) {
        let bestDist = Infinity
        for (const [guid, b] of boundsForResolve) {
          if (guid === e.guid) continue
          const d = pointToRectDist(x1, y1, b.x, b.y, b.w, b.h)
          if (d < bestDist) {
            bestDist = d
            fromId = guid
          }
        }
        if (bestDist > 150) fromId = undefined
      }
      }
      if (fromId && toId) {
        if (useAttached) connectorViaAttached++
        else {
          connectorViaCoords++
          connectorViaCoordsIds.push(e.guid)
        }
        const fromEl = elementById.get(fromId)
        if (!connectorLabel && fromEl?.mainComponentName === '交互判断') {
          const n = decisionOutCount.get(fromId) ?? 0
          connectorLabel = n === 0 ? '是' : '否'
          decisionOutCount.set(fromId, n + 1)
        }
        const toBlockId = containingFrameId.get(toId)
        const fromBlockId = containingFrameId.get(fromId)
        const toEntry = {
          id: toId,
          name: idToName.get(toId),
          ...(connectorLabel && { label: connectorLabel }),
          ...(toBlockId && toBlockId !== toId && { blockId: toBlockId }),
        }
        const fromEntry = {
          id: fromId,
          name: idToName.get(fromId),
          ...(connectorLabel && { label: connectorLabel }),
          ...(fromBlockId && fromBlockId !== fromId && { blockId: fromBlockId }),
        }
        if (elementById.has(fromId)) {
          const fromEl_ = elementById.get(fromId)!
          if (!fromEl_.to) fromEl_.to = []
          pushUniqueEdgeRef(fromEl_.to, toEntry)
        }
        if (elementById.has(toId)) {
          const toEl = elementById.get(toId)!
          if (!toEl.from) toEl.from = []
          pushUniqueEdgeRef(toEl.from, fromEntry)
        }
        /** 仅 Line 命名的细长 VECTOR：在本体上带 from/to（几何推断） */
        if (isVectorLine && elementById.has(e.guid)) {
          const vEl = elementById.get(e.guid)!
          if (!vEl.from) vEl.from = []
          if (!vEl.to) vEl.to = []
          pushUniqueEdgeRef(vEl.from, fromEntry)
          pushUniqueEdgeRef(vEl.to, toEntry)
        }
      }
    }

    /**
     * ============================================================
     * 跨 FRAME 文字吸附
     *
     * 规则：
     * 1. 识别 scope 内的「图块」（FRAME/GROUP 非纯文本容器）
     * 2. 识别 scope 内的「文字源」：
     *    a. 游离 TEXT（不在任何子 FRAME 内部）
     *    b. 纯文本容器 FRAME（所有直接子节点都是 TEXT）→ 合并内容当整体
     * 3. 对每个图块，收集其正下方的 **所有** 文字源（不限一条）
     * 4. 子模块（子模块）内部遵守同样的逻辑
     * ============================================================
     */

    // Step 1: 收集「游离 TEXT」—— 不在任何子模版 FRAME 内部的 TEXT
    const textGuidsNotInFrame = new Set<string>()
    for (const el of elements) {
      if (!isFigmaTextLayerType(el.type)) continue
      if (isTextEligibleForCrossFrameBelowAttach(el.id, sectionGuid, parentMap, elementById, nestMarkers)) {
        textGuidsNotInFrame.add(el.id)
      }
    }

    // Step 2: 识别「纯文本容器 FRAME」并准备合并内容
    // 纯文本容器不是「图块」—— 它们是文字说明源，不应被当作吸附目标。
    const textOnlyFrameSources = new Map<string, {
      canonId: string
      mergedText: string
      allChildTextIds: string[]
      bounds: BoundsRect
    }>()
    const textOnlyFrameChildIds = new Set<string>()
    for (const el of elements) {
      if (el.type !== 'FRAME' && el.type !== 'GROUP') continue
      const entry = flatByGuid.get(el.id)
      if (!entry?.node) continue
      const fb = boundsElementOnly.get(el.id)
      if (!fb) continue
      const merged = getTextOnlyFrameMergedContent(entry.node, getTextContent, boundsElementOnly)
      if (!merged) {
        continue
      }
      if (fb.w * fb.h > TEXT_ONLY_FRAME_MAX_AREA) continue
      if (merged.allIds.some(tid => textIdsHandledAsNestTextBundle.has(tid))) continue
      textOnlyFrameSources.set(el.id, {
        canonId: merged.firstId,
        mergedText: merged.mergedText,
        allChildTextIds: merged.allIds,
        bounds: fb
      })
      for (const tid of merged.allIds) textOnlyFrameChildIds.add(tid)
    }

    // Step 3: 对每个图块，链式吸附正下方的所有文字源（游离 TEXT + 纯文本容器 FRAME）
    // 将所有候选文字源按 Y 排序，从上到下逐个检查：若距有效底边 ≤ maxGap 就吸附，
    // 吸附后扩展有效底边，使链条上更远的文字源也能被连续吸附到同一图块。
    const usedTextGuidsInBelow = new Set<string>()
    const usedTextOnlyFrameIds = new Set<string>()

    for (const el of elements) {
      if (isFigmaTextLayerType(el.type)) continue
      if (textOnlyFrameSources.has(el.id)) continue
      if (textIdsHandledAsNestTextBundle.has(el.id)) continue
      const isFunctionBlock =
        el.type === 'FRAME' ||
        el.type === 'GROUP' ||
        (el.from?.length ?? 0) > 0 ||
        (el.to?.length ?? 0) > 0
      if (!isFunctionBlock) continue
      if (el.type === 'FRAME' || el.type === 'GROUP') {
        const entry = flatByGuid.get(el.id)
        if (entry?.node && (isAnnotationLikeFrame(entry.node) || isDeepTextOnlyNode(entry.node))) continue
      }
      const b = boundsElementOnly.get(el.id)
      if (!b) continue
      const blockBottom = b.y + b.h

      type BelowCandidate = { kind: 'text'; id: string; text: string; y: number; bottom: number }
        | { kind: 'container'; fid: string; canonId: string; mergedText: string; allChildTextIds: string[]; y: number; bottom: number }

      const candidates: BelowCandidate[] = []

      // 3a: 游离 TEXT 候选
      for (const e of flat) {
        if (!isFigmaTextLayerType(e.type) || !descendantGuids.has(e.guid)) continue
        if (textGuidsNotInFrame && !textGuidsNotInFrame.has(e.guid)) continue
        if (usedTextGuidsInBelow.has(e.guid)) continue
        const tb = boundsByGuid.get(e.guid)
        if (!tb || tb.y < blockBottom) continue
        const textCenterX = tb.x + tb.w / 2
        if (textCenterX < b.x - 80 || textCenterX > b.x + b.w + 80) continue
        const text = getTextContent(e.node.figma)
        if (!text) continue
        candidates.push({ kind: 'text', id: e.guid, text, y: tb.y, bottom: tb.y + tb.h })
      }

      // 3b: 纯文本容器候选
      for (const [fid, src] of textOnlyFrameSources) {
        if (usedTextOnlyFrameIds.has(fid)) continue
        if (src.bounds.y < blockBottom) continue
        const textCenterX = src.bounds.x + src.bounds.w / 2
        if (textCenterX < b.x - 80 || textCenterX > b.x + b.w + 80) continue
        candidates.push({
          kind: 'container', fid, canonId: src.canonId, mergedText: src.mergedText,
          allChildTextIds: src.allChildTextIds, y: src.bounds.y, bottom: src.bounds.y + src.bounds.h
        })
      }

      candidates.sort((a, b) => a.y - b.y)

      let effectiveBottom = blockBottom
      for (const c of candidates) {
        const gap = c.y - effectiveBottom
        if (gap > TEXT_BELOW_MAX_GAP) continue
        if (c.kind === 'text') {
          if (usedTextGuidsInBelow.has(c.id)) continue
          usedTextGuidsInBelow.add(c.id)
          if (!el.functionalDescription) el.functionalDescription = []
          if (!el.functionalDescription.some((l) => l.id === c.id)) {
            el.functionalDescription.push({ id: c.id, text: c.text })
          }
          if (hasNoOrGenericName(el)) {
            el.displayName = c.text.length > 80 ? c.text.slice(0, 80) + '…' : c.text
          }
        } else {
          if (usedTextOnlyFrameIds.has(c.fid)) continue
          usedTextOnlyFrameIds.add(c.fid)
          if (!el.functionalDescription) el.functionalDescription = []
          if (!el.functionalDescription.some((l) => l.id === c.canonId)) {
            el.functionalDescription.push({ id: c.canonId, text: c.mergedText })
          }
          for (const tid of c.allChildTextIds) usedTextGuidsInBelow.add(tid)
          if (hasNoOrGenericName(el)) {
            el.displayName = c.mergedText.length > 80 ? c.mergedText.slice(0, 80) + '…' : c.mergedText
          }
        }
        effectiveBottom = Math.max(effectiveBottom, c.bottom)
      }
    }

    // Step 4: 图/实例与说明同层：兄弟 TEXT + 布局邻近 TEXT → functionalDescription
    const NEAR_IMAGE_MAX_DIST = 120
    const imageLikeTypes = new Set(['IMAGE', 'INSTANCE', 'RECTANGLE', 'ROUNDED_RECTANGLE'])
    const pushFunctionalDesc = (target: El, item: { id: string; text: string }) => {
      if (usedTextGuidsInBelow.has(item.id)) return
      usedTextGuidsInBelow.add(item.id)
      if (!target.functionalDescription) target.functionalDescription = []
      if (target.functionalDescription.some((l) => l.id === item.id)) return
      target.functionalDescription.push({ id: item.id, text: item.text })
      if (hasNoOrGenericName(target)) {
        target.displayName = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text
      }
    }
    for (const el of elements) {
      if (!imageLikeTypes.has(el.type)) continue
      const b = boundsElementOnly.get(el.id)
      if (!b) continue
      for (const st of collectSiblingTextsForElement(el.id, parentMap, getTextContent)) {
        pushFunctionalDesc(el, st)
      }
      for (const nt of collectTextsNearImageBounds(
        el.id, b, flat, boundsByGuid, descendantGuids, parentMap, getTextContent, NEAR_IMAGE_MAX_DIST
      )) {
        pushFunctionalDesc(el, nt)
      }
    }

    // Step 5: 子模块根吸附兜底 — 仍未被吸附的游离 TEXT，按几何关系挂到最近的子模块根 FRAME
    const moduleOrphanAbsorbIds = new Set<string>()
    const nestModuleFrameIds = elements
      .filter(
        (e) =>
          (e.type === 'FRAME' || e.type === 'GROUP') && frameHasNestExpandMarker(e, nestMarkers)
      )
      .map((e) => e.id)
    if (nestModuleFrameIds.length > 0) {
      for (const el of elements) {
        if (!isFigmaTextLayerType(el.type)) continue
        if (!textGuidsNotInFrame.has(el.id)) continue
        if (usedTextGuidsInBelow.has(el.id)) continue
        const tb = boundsElementOnly.get(el.id)
        if (!tb) continue
        const modId = pickPhysicalAboveByXProximity(tb, boundsElementOnly, nestModuleFrameIds)
        if (!modId) continue
        const modEl = elementById.get(modId)
        if (!modEl) continue
        if (!modEl.functionalDescription) modEl.functionalDescription = []
        if (!modEl.functionalDescription.some((l) => l.id === el.id)) {
          modEl.functionalDescription.push({ id: el.id, text: el.text ?? '' })
        }
        moduleOrphanAbsorbIds.add(el.id)
      }
    }
    // 未吸附的纯文本容器也走子模块根兜底
    if (nestModuleFrameIds.length > 0) {
      for (const [fid, src] of textOnlyFrameSources) {
        if (usedTextOnlyFrameIds.has(fid)) continue
        const modId = pickPhysicalAboveByXProximity(src.bounds, boundsElementOnly, nestModuleFrameIds)
        if (!modId) continue
        const modEl = elementById.get(modId)
        if (!modEl) continue
        if (!modEl.functionalDescription) modEl.functionalDescription = []
        if (!modEl.functionalDescription.some((l) => l.id === src.canonId)) {
          modEl.functionalDescription.push({ id: src.canonId, text: src.mergedText })
        }
        usedTextOnlyFrameIds.add(fid)
        for (const tid of src.allChildTextIds) usedTextGuidsInBelow.add(tid)
        moduleOrphanAbsorbIds.add(fid)
      }
    }
    if (moduleOrphanAbsorbIds.size > 0) {
      for (let idx = elements.length - 1; idx >= 0; idx--) {
        if (moduleOrphanAbsorbIds.has(elements[idx].id)) {
          elementById.delete(elements[idx].id)
          elements.splice(idx, 1)
        }
      }
    }

    // 移除已被吸附的纯文本容器 FRAME（它们的内容已合并到目标图块的 functionalDescription）
    if (usedTextOnlyFrameIds.size > 0) {
      for (let idx = elements.length - 1; idx >= 0; idx--) {
        if (usedTextOnlyFrameIds.has(elements[idx].id)) {
          elementById.delete(elements[idx].id)
          elements.splice(idx, 1)
        }
      }
    }

    /** 游离且未吸附到任何元素的 TEXT：打 sectionLevelHint，随后写入 section.functionalDescription 并从 elements 移除 */
    for (const el of elements) {
      if (!isFigmaTextLayerType(el.type)) continue
      if (!textGuidsNotInFrame.has(el.id)) continue
      if (usedTextGuidsInBelow.has(el.id)) continue
      el.sectionLevelHint = classifySectionHint(el.text ?? '')
    }

    /** 多文本块聚合：游离 TEXT 如果垂直紧密排列（竖直间距 ≤ 行高 * 2），聚合为一段完整说明。
     *  典型场景：状态机规格说明跨多个 TEXT 节点竖排。聚合后保留首个节点、删除后续节点。 */
    const TEXT_MERGE_Y_GAP = 40
    const TEXT_MERGE_X_OVERLAP = 100
    const sectionHintEls = elements.filter((el) => el.sectionLevelHint)
    if (sectionHintEls.length > 1) {
      const withBounds = sectionHintEls
        .map((el) => ({ el, b: boundsByGuid.get(el.id) }))
        .filter((x): x is { el: El; b: { x: number; y: number; w: number; h: number } } => !!x.b)
        .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x)

      const merged = new Set<string>()
      for (let i = 0; i < withBounds.length; i++) {
        if (merged.has(withBounds[i].el.id)) continue
        const group = [withBounds[i]]
        for (let j = i + 1; j < withBounds.length; j++) {
          if (merged.has(withBounds[j].el.id)) continue
          const prev = group[group.length - 1]
          const curr = withBounds[j]
          const yGap = curr.b.y - (prev.b.y + prev.b.h)
          const xOverlap =
            Math.min(prev.b.x + prev.b.w, curr.b.x + curr.b.w) -
            Math.max(prev.b.x, curr.b.x)
          if (yGap >= 0 && yGap <= TEXT_MERGE_Y_GAP && xOverlap > -TEXT_MERGE_X_OVERLAP) {
            group.push(curr)
          }
        }
        if (group.length > 1) {
          const combinedText = group.map((g) => g.el.text ?? '').join('\n')
          group[0].el.text = combinedText
          for (let k = 1; k < group.length; k++) {
            merged.add(group[k].el.id)
          }
        }
      }
      if (merged.size > 0) {
        const mergedIds = merged
        for (let idx = elements.length - 1; idx >= 0; idx--) {
          if (mergedIds.has(elements[idx].id)) {
            elementById.delete(elements[idx].id)
            elements.splice(idx, 1)
          }
        }
      }
    }

    /** 画布上不在任何 FRAME 内、且未被他处吸附的 TEXT → 本节整体功能说明，并移出 elements 以免重复输出 */
    const sectionOrphanFunctional = sortTextEntriesByCanvasPosition(
      elements
        .filter((el) => isFigmaTextLayerType(el.type) && el.sectionLevelHint)
        .map((e) => ({ id: e.id, text: e.text ?? '' })),
      boundsByGuid
    )
    if (sectionOrphanFunctional.length > 0) {
      const absorbIds = new Set(sectionOrphanFunctional.map((x) => x.id))
      for (let idx = elements.length - 1; idx >= 0; idx--) {
        if (absorbIds.has(elements[idx].id)) {
          elementById.delete(elements[idx].id)
          elements.splice(idx, 1)
        }
      }
    }

    for (const fd of overallFdForSection) {
      if (!sectionOrphanFunctional.some(f => f.id === fd.id)) {
        sectionOrphanFunctional.push(fd)
      }
    }

    /**
     * 吸收"纯标注子元素"：auto-named、无 texts、无 sub-children 的子节点
     * 被视为标注帧（如"模版\n17\n总结"的紫色标签帧）。
     * 其 fd/texts 内容合并到最近的真实兄弟的 functionalDescription 前部，
     * 然后从 children 列表中移除。
     */
    function absorbAnnotationOnlyChildren(
      children: TreeEl[],
      boundsMap: Map<string, { x: number; y: number; w: number; h: number }>
    ): TreeEl[] {
      if (children.length <= 1) return children

      function isAnnotationOnly(ch: TreeEl): boolean {
        if (!isAutoName(ch.name)) return false
        if (ch.children?.length) return false
        if (!ch.texts?.length) return true
        const entry = ch.id ? flatByGuid.get(ch.id) : undefined
        if (!entry?.node) return false
        if (isDeepTextOnlyNode(entry.node)) return true
        return false
      }

      const kept: TreeEl[] = []
      const annotationQueue: Array<{ node: TreeEl; b: { x: number; y: number; w: number; h: number } }> = []

      for (const ch of children) {
        if (isAnnotationOnly(ch) && ch.id && boundsMap.has(ch.id)) {
          annotationQueue.push({ node: ch, b: boundsMap.get(ch.id)! })
        } else {
          kept.push(ch)
        }
      }

      if (DEBUG_TEXT_CLASSIFY) {
        _dbg(`absorbAnnotationOnlyChildren: ${children.length} children, ${annotationQueue.length} annotations, ${kept.length} kept`)
        for (const ann of annotationQueue) _dbg(`  annotation: [${ann.node.id}] "${ann.node.name}" fd=${ann.node.functionalDescription?.length ?? 0} texts=${ann.node.texts?.length ?? 0}`)
      }

      if (annotationQueue.length === 0) return children

      for (const ann of annotationQueue) {
        let bestTarget: TreeEl | null = null
        let bestDist = Infinity
        if (DEBUG_TEXT_CLASSIFY) _dbg(`  searching target for annotation [${ann.node.id}] at x=${ann.b.x} y=${ann.b.y} w=${ann.b.w} h=${ann.b.h}`)
        for (const real of kept) {
          if (!real.id) continue
          const rb = boundsMap.get(real.id)
          if (!rb) { if (DEBUG_TEXT_CLASSIFY) _dbg(`    skip [${real.id}] "${real.name}" - no bounds`); continue }
          const gap = rb.y - (ann.b.y + ann.b.h)
          if (gap < -ann.b.h * 2) { if (DEBUG_TEXT_CLASSIFY) _dbg(`    skip [${real.id}] "${real.name}" - too far above, gap=${gap}`); continue }
          const hOverlap = !(rb.x > ann.b.x + ann.b.w + 200 || ann.b.x > rb.x + rb.w + 200)
          if (!hOverlap) { if (DEBUG_TEXT_CLASSIFY) _dbg(`    skip [${real.id}] "${real.name}" - no h-overlap, real.x=${rb.x} real.w=${rb.w}`); continue }
          const dist = Math.abs(gap)
          if (DEBUG_TEXT_CLASSIFY) _dbg(`    candidate [${real.id}] "${real.name}" gap=${gap} dist=${dist}`)
          if (dist < bestDist) {
            bestDist = dist
            bestTarget = real
          }
        }

        if (bestTarget) {
          if (!bestTarget.functionalDescription) bestTarget.functionalDescription = []
          const existingIds = new Set(bestTarget.functionalDescription.map(f => f.id))
          const toAdd: Array<{ id: string; text: string }> = []
          for (const fd of ann.node.functionalDescription ?? []) {
            if (!existingIds.has(fd.id)) toAdd.push(fd)
          }
          for (const t of ann.node.texts ?? []) {
            if (!existingIds.has(t.id)) toAdd.push({ id: t.id, text: t.text })
          }
          bestTarget.functionalDescription = [...toAdd, ...bestTarget.functionalDescription]
        } else {
          kept.push(ann.node)
        }
      }

      kept.sort((a, b) => {
        const ab = a.id ? boundsMap.get(a.id) : undefined
        const bb = b.id ? boundsMap.get(b.id) : undefined
        if (!ab || !bb) return 0
        return ab.y - bb.y || ab.x - bb.x
      })

      return kept
    }

    /**
     * Section 输出：默认仅 section 下一层为 `elements` 根列表；带嵌套展开标记的 FRAME 在自身上挂 `children`（可递归）。
     * FRAME/GROUP：
     * - texts：框内 UI（内层子 FRAME 内、父为 FRAME 的字；排除「功能说明」子树；实例规则同 getFrameContent）。
     * - functionalDescription：①「功能说明」子层；② 父非 FRAME 的说明字；③ 父为当前导出 FRAME 且与同层子 FRAME（图）并列的 TEXT；④ 下方/兄弟/邻近吸附。
     * 无可吸附时记入当前 FRAME 或 section.functionalDescription；连线 to/from 。
     */
    function buildFlatSectionElements(
      elements: El[],
      sectionGuid: string,
      parentMap: Map<string, TreeNode>,
      bounds: Map<string, { x: number; y: number; w: number; h: number }>,
      nestMarkersArg: string[],
      nestTextBundleHandledIds: Set<string>
    ): TreeEl[] {
      const getParentGuid = (id: string): string | undefined => {
        const p = parentMap.get(id)
        return p?.figma.guid ? guidToString(p.figma.guid) : undefined
      }
      const sortByPosition = (a: El, b: El) => {
        const ba = bounds.get(a.id)
        const bb = bounds.get(b.id)
        const ax = ba ? ba.x + ba.w / 2 : 0
        const ay = ba ? ba.y + ba.h / 2 : 0
        const bx = bb ? bb.x + bb.w / 2 : 0
        const by = bb ? bb.y + bb.h / 2 : 0
        if (Math.abs(ax - bx) < 20) return ay - by
        return ax - bx
      }
      const rootsByParent = elements
        .filter((el) => getParentGuid(el.id) === sectionGuid)
        .sort(sortByPosition)
      const rootIds = new Set(rootsByParent.map((r) => r.id))
      const extraRoots = elements
        .filter((el) => el.sectionLevelHint && !rootIds.has(el.id))
        .sort(sortByPosition)

      /** 子节点已生成 JSON 里出现的 texts / functionalDescription 的 id（递归 children） */
      function collectEmittedContentIdsInSubtree(root: TreeEl): Set<string> {
        const out = new Set<string>()
        const walk = (n: TreeEl) => {
          for (const t of n.texts ?? []) out.add(t.id)
          for (const f of n.functionalDescription ?? []) out.add(f.id)
          for (const c of n.children ?? []) walk(c)
        }
        walk(root)
        return out
      }

      function elToTreeEl(el: El): TreeEl {
        const { frameContent } = el
        const rawName = (
          el.displayName ||
          frameContent?.title ||
          el.mainComponentName ||
          el.originName ||
          ''
        ).trim() || el.id
        const unifiedName = stripNestMarkersFromTitle(rawName, nestMarkersArg) || rawName

        const childIds = elements
          .filter((e) => getParentGuid(e.id) === el.id && e.type !== 'TEXT')
          .sort(sortByPosition)
          .map((e) => e.id)
        const directChildFrameIds = new Set(
          elements
            .filter(
              (e) =>
                getParentGuid(e.id) === el.id &&
                (e.type === 'FRAME' || e.type === 'GROUP')
            )
            .map((e) => e.id)
        )

        const selfParentGuid = getParentGuid(el.id)
        const siblingNonTextIds =
          selfParentGuid
            ? elements
                .filter(
                  (e) =>
                    getParentGuid(e.id) === selfParentGuid &&
                    e.type !== 'TEXT' &&
                    e.id !== el.id
                )
                .sort(sortByPosition)
                .map((e) => e.id)
            : []

        let textsOut: TreeEl['texts'] = undefined
        let specFunctionalOut: TreeEl['functionalDescription'] = undefined
        let nestedFunctionalOut: TreeEl['functionalDescription'] = undefined
        /** 无可吸附到子图/兄弟块时，记入当前导出 FRAME 的整体功能说明 */
        let orphanOverallFd: Array<{ id: string; text: string }> = []
        const directChildFrameIdList = [...directChildFrameIds]
        /** 规格/整段说明：仍只对「直接子 FRAME」吸附，避免长文被拆进最内层小框 */
        const attachSpecOrOuter = (textId: string): string | undefined => {
          const tb = bounds.get(textId)
          if (tb && directChildFrameIdList.length > 0) {
            const byFrames = pickPhysicalAboveByXProximity(tb, bounds, directChildFrameIdList)
            if (byFrames) return byFrames
          }
          return pickAboveAttachTarget(textId, bounds, childIds, siblingNonTextIds)
        }
        if ((el.type === 'FRAME' || el.type === 'GROUP') && frameContent) {
          if (DEBUG_TARGET_IDS.has(el.id)) {
            _dbg(`=== elToTreeEl processing [${el.id}] name="${unifiedName}" type=${el.type} ===`)
            _dbg(`  frameContent.texts count=${frameContent.texts.length}:`)
            for (const t of frameContent.texts) {
              _dbg(`    id=${t.id} text="${t.text.slice(0, 60)}${t.text.length > 60 ? '...' : ''}"`)
            }
            _dbg(`  directChildFrameIds:`, [...directChildFrameIds])
            _dbg(`  el.functionalDescription:`, el.functionalDescription?.map(f => ({ id: f.id, text: f.text.slice(0, 40) })))
          }
          const entry = flatByGuid.get(el.id)
          const frameTree = entry?.node
          const specGuids = frameTree ? collectSpecSubtreeGuids(frameTree) : new Set<string>()
          const hasSpecLayer = frameTree ? findSpecNodes(frameTree).length > 0 : false

          if (DEBUG_TARGET_IDS.has(el.id)) {
            _dbg(`  specGuids(${specGuids.size}):`, [...specGuids])
            _dbg(`  hasSpecLayer:`, hasSpecLayer)
          }

          /** 框内每行 UI 字：在整棵导出子树里找「上方的」内层行框，而不是只跟直接子 Group 比 */
          const descendantVisualForUiAttach = collectDescendantVisualBlockIds(
            elements,
            getParentGuid,
            el.id
          ).filter((id) => {
            if (specGuids.has(id)) return false
            const dEntry = flatByGuid.get(id)
            if (dEntry?.node && (isDirectTextOnlyContainerNode(dEntry.node) || isMixedTextContainerNode(dEntry.node, getTextContent))) return false
            return true
          })
          const attachUiTextToRowGraphic = (textId: string): string | undefined => {
            const tb = bounds.get(textId)
            const ancestors = collectStrictAncestorGuidsBetween(textId, el.id, parentMap)
            const pool =
              descendantVisualForUiAttach.length > 0
                ? descendantVisualForUiAttach.filter((id) => !ancestors.has(id))
                : directChildFrameIdList
            if (tb && pool.length > 0) {
              const hit = pickPhysicalAboveByXProximity(tb, bounds, pool)
              if (hit) return hit
            }
            return pickAboveAttachTarget(textId, bounds, childIds, siblingNonTextIds)
          }

          const internalRaw = frameContent.texts.filter((t) => {
            if (nestTextBundleHandledIds.has(t.id)) return false
            if (specGuids.has(t.id)) return false
            return true
          })

          if (DEBUG_TARGET_IDS.has(el.id)) {
            _dbg(`  internalRaw (after filter) count=${internalRaw.length}:`)
            for (const t of internalRaw) {
              _dbg(`    id=${t.id} text="${t.text.slice(0, 60)}${t.text.length > 60 ? '...' : ''}"`)
            }
          }

          /**
           * texts：框内 UI（内层图 frame 里的字、父为内层 FRAME 的题干等）。
           * functionalDescription（nested）：① 父非 FRAME（Group/实例等）内的说明字；② 父为当前导出 FRAME 且与同层子 FRAME（图框）并列的 TEXT → 整框功能说明。
           *
           * 几何辅助判断：若 TEXT 外接框完全落在某子图块（直接子 FRAME/INSTANCE 等）的边界内，
           * 说明它是该图块画面里的 UI 文案，即使层级树上父节点不是 FRAME 也归 UI。
           */
          const elBounds = bounds.get(el.id)

          /**
           * 几何判断：TEXT 外接框是否完全落在某后代视觉块（FRAME/GROUP/INSTANCE）内。
           * 扩大搜索范围：不再仅看 directChildFrameIdList，而是检查所有后代视觉块
           * （descendantVisualForUiAttach），这样深层嵌套子组件内的 UI 文字也能被正确识别。
           * 同时排除"纯文字容器"（只含 TEXT 的 FRAME），避免把标注框误判为图块。
           */
          const allVisualBlockIdsForGeoCheck = descendantVisualForUiAttach.length > 0
            ? descendantVisualForUiAttach
            : directChildFrameIdList
          const isTextGeometricallyInsideChildVisualBlock = (textId: string): boolean => {
            const tb = bounds.get(textId)
            if (!tb || !elBounds) return false
            for (const cid of allVisualBlockIdsForGeoCheck) {
              const cb = bounds.get(cid)
              if (!cb) continue
              const cEntry = flatByGuid.get(cid)
              if (cEntry?.node && (isDirectTextOnlyContainerNode(cEntry.node) || isDeepTextOnlyNode(cEntry.node) || isMixedTextContainerNode(cEntry.node, getTextContent))) continue
              if (
                tb.x >= cb.x - 10 &&
                tb.y >= cb.y - 10 &&
                tb.x + tb.w <= cb.x + cb.w + 10 &&
                tb.y + tb.h <= cb.y + cb.h + 10
              ) {
                if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    isTextGeometricallyInsideChildVisualBlock: text ${textId} inside visual block ${cid}`)
                return true
              }
            }
            return false
          }
          const uiTextEntries: typeof internalRaw = []
          const nestedNonFrameFunctional: typeof internalRaw = []
          for (const t of internalRaw) {
            const pType = getTextDirectParentType(t.id, parentMap)
            if (DEBUG_TARGET_IDS.has(el.id)) {
              const pNode = parentMap.get(t.id)
              const pGuid = pNode?.figma.guid ? guidToString(pNode.figma.guid) : '?'
              const pName = pNode?.figma.name ?? '?'
              _dbg(`  classifying text id=${t.id} text="${t.text.slice(0, 40)}..."`)
              _dbg(`    parentType=${pType} parentGuid=${pGuid} parentName="${pName}"`)
            }
            if (pType !== 'FRAME') {
              if (isTextInsideDescendantFrame(t.id, el.id, parentMap)) {
                if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → uiTextEntries (reason: parentType=${pType} !== FRAME, but text is inside a descendant FRAME → UI)`)
                uiTextEntries.push(t)
                continue
              }
              if (isTextGeometricallyInsideChildVisualBlock(t.id)) {
                if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → uiTextEntries (reason: parentType=${pType} !== FRAME, but text geometrically inside a child visual block → UI)`)
                uiTextEntries.push(t)
                continue
              }
              if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → nestedNonFrameFunctional (reason: parentType=${pType} !== FRAME)`)
              nestedNonFrameFunctional.push(t)
              continue
            }
            const textParentNode = parentMap.get(t.id)
            if (
              textParentNode &&
              (isDirectTextOnlyContainerNode(textParentNode) || isMixedTextContainerNode(textParentNode, getTextContent)) &&
              textParentNode.figma.guid &&
              guidToString(textParentNode.figma.guid) !== el.id
            ) {
              const containerGuid = guidToString(textParentNode.figma.guid)
              if (isTextInsideDescendantFrame(containerGuid, el.id, parentMap)) {
                if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → uiTextEntries (reason: parent is text-only container ${containerGuid}, but container is inside a descendant FRAME → UI)`)
                uiTextEntries.push(t)
                continue
              }
              if (isTextGeometricallyInsideChildVisualBlock(t.id)) {
                if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → uiTextEntries (reason: parent is text-only container ${containerGuid}, but text geometrically inside a child visual block → UI)`)
                uiTextEntries.push(t)
                continue
              }
              if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → nestedNonFrameFunctional (reason: parent is text-only container, parentGuid=${containerGuid} != el.id=${el.id})`)
              nestedNonFrameFunctional.push(t)
              continue
            }
            if (
              frameHasNestExpandMarker(el, nestMarkersArg) &&
              directChildFrameIds.size > 0 &&
              textParentNode?.figma.guid &&
              guidToString(textParentNode.figma.guid) === el.id
            ) {
              if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → nestedNonFrameFunctional (reason: nest-expand parent, text is direct child → treat as functional)`)
              nestedNonFrameFunctional.push(t)
              continue
            }
            if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`    → uiTextEntries (UI文案)`)
            uiTextEntries.push(t)
          }

          if (
            uiTextEntries.length === 0 &&
            nestedNonFrameFunctional.length > 0 &&
            directChildFrameIds.size === 0 &&
            !hasSpecLayer &&
            !(el.functionalDescription?.length)
          ) {
            if (DEBUG_TARGET_IDS.has(el.id)) _dbg(`  [FALLBACK] no UI texts, no child FRAMEs, no spec — reclassifying ${nestedNonFrameFunctional.length} functional entries as UI texts`)
            uiTextEntries.push(...nestedNonFrameFunctional)
            nestedNonFrameFunctional.length = 0
          }
          const uiSorted = sortTextEntriesByCanvasPosition(uiTextEntries, bounds)
          const nestedSorted = sortTextEntriesByCanvasPosition(nestedNonFrameFunctional, bounds)

          if (DEBUG_TARGET_IDS.has(el.id)) {
            _dbg(`  classification result:`)
            _dbg(`    uiTextEntries (→ texts): ${uiSorted.length}`)
            for (const t of uiSorted) _dbg(`      id=${t.id} text="${t.text.slice(0, 50)}"`)
            _dbg(`    nestedNonFrameFunctional (→ functionalDescription): ${nestedSorted.length}`)
            for (const t of nestedSorted) _dbg(`      id=${t.id} text="${t.text.slice(0, 50)}"`)
          }

          if (uiSorted.length > 0) {
            if (
              frameTree &&
              isDirectTextOnlyContainerNode(frameTree) &&
              uiSorted.length > 1
            ) {
              const mergedText = uiSorted.map((t) => t.text).join('\n')
              const bundleB = bounds.get(el.id)
              let attachIds = childIds.length > 0 ? childIds : siblingNonTextIds
              if (!childIds.length && bundleB && attachIds.length > 0) {
                attachIds = filterSiblingsForAboveAttach(bundleB, bounds, attachIds)
              }
              let elementId: string | undefined
              if (bundleB && attachIds.length > 0) {
                elementId = getTextAttachedChildIdForRect(
                  bundleB,
                  bounds,
                  attachIds,
                  TEXT_BELOW_MAX_GAP,
                  80
                )
                if (!elementId) {
                  elementId = attachFreeRectAbove(bundleB, bounds, attachIds, {
                    skipContainCenter: true,
                  })
                }
              }
              if (!elementId) elementId = attachUiTextToRowGraphic(uiSorted[0].id)
              if (elementId) {
                textsOut = [
                  {
                    id: uiSorted[0].id,
                    text: mergedText,
                    elementId,
                  },
                ]
              } else {
                orphanOverallFd.push({ id: uiSorted[0].id, text: mergedText })
              }
            } else {
              const rows: NonNullable<TreeEl['texts']> = []
              for (const t of uiSorted) {
                const elementId = attachUiTextToRowGraphic(t.id)
                if (elementId) rows.push({ id: t.id, text: t.text, elementId })
                else orphanOverallFd.push({ id: t.id, text: t.text })
              }
              if (rows.length) textsOut = rows
            }
          }

          if (nestedSorted.length > 0) {
            if (
              frameTree &&
              isDirectTextOnlyContainerNode(frameTree) &&
              nestedSorted.length > 1
            ) {
              const mergedText = nestedSorted.map((t) => t.text).join('\n')
              const bundleB = bounds.get(el.id)
              let attachIds = childIds.length > 0 ? childIds : siblingNonTextIds
              if (!childIds.length && bundleB && attachIds.length > 0) {
                attachIds = filterSiblingsForAboveAttach(bundleB, bounds, attachIds)
              }
              let elementId: string | undefined
              if (bundleB && attachIds.length > 0) {
                elementId = getTextAttachedChildIdForRect(
                  bundleB,
                  bounds,
                  attachIds,
                  TEXT_BELOW_MAX_GAP,
                  80
                )
                if (!elementId) {
                  elementId = attachFreeRectAbove(bundleB, bounds, attachIds, {
                    skipContainCenter: true,
                  })
                }
              }
              if (!elementId) elementId = attachUiTextToRowGraphic(nestedSorted[0].id)
              if (elementId) {
                nestedFunctionalOut = [
                  {
                    id: nestedSorted[0].id,
                    text: mergedText,
                    elementId,
                  },
                ]
              } else {
                orphanOverallFd.push({ id: nestedSorted[0].id, text: mergedText })
              }
            } else {
              nestedFunctionalOut = []
              for (const t of nestedSorted) {
                const elementId = attachUiTextToRowGraphic(t.id)
                if (elementId) {
                  nestedFunctionalOut.push({ id: t.id, text: t.text, elementId })
                } else {
                  orphanOverallFd.push({ id: t.id, text: t.text })
                }
              }
              if (!nestedFunctionalOut.length) nestedFunctionalOut = undefined
            }
          }

          if (hasSpecLayer && frameTree) {
            const raw = getFunctionSpecTextsFromFrame(frameTree, getTextContent)
            if (raw.length > 0) {
              const specSorted = sortTextEntriesByCanvasPosition(raw, bounds)
              specFunctionalOut = []
              for (const t of specSorted) {
                const elementId = attachSpecOrOuter(t.id)
                if (elementId) {
                  specFunctionalOut.push({ id: t.id, text: t.text, elementId })
                } else {
                  orphanOverallFd.push({ id: t.id, text: t.text })
                }
              }
              if (!specFunctionalOut.length) specFunctionalOut = undefined
            }
          }

          /**
           * 几何安全网：el.functionalDescription 中可能有被早期吸附算法错误归入的文字，
           * 如果它们几何上完全落在某后代视觉块内，说明实际是 UI 文案而非规格说明。
           * 将其从 functionalDescription 移到 texts。
           */
          if (el.functionalDescription?.length) {
            const rescued: typeof el.functionalDescription = []
            el.functionalDescription = el.functionalDescription.filter((fd) => {
              if (!isTextGeometricallyInsideChildVisualBlock(fd.id)) return true
              if (DEBUG_TARGET_IDS.has(el.id))
                _dbg(`  [FD-GEO-RESCUE] fd id=${fd.id} text="${fd.text.slice(0, 40)}" geometrically inside child visual block → move to texts`)
              rescued.push(fd)
              return false
            })
            if (rescued.length) {
              if (!textsOut) textsOut = []
              for (const r of rescued) textsOut.push({ id: r.id, text: r.text })
              textsOut = sortTextEntriesByCanvasPosition(textsOut, bounds)
            }
          }
        }

        const elFdFiltered = el.functionalDescription

        const externalFdIds = new Set(
          (elFdFiltered ?? []).map(f => f.id)
        )

        let mergedFunctional = sortTextEntriesByCanvasPosition(
          mergeFunctionalDescription(
            specFunctionalOut,
            nestedFunctionalOut,
            elFdFiltered,
            orphanOverallFd.length ? orphanOverallFd : undefined
          ),
          bounds
        )

        /** 将 functionalDescription 挂到子 FRAME，或与当前框同父的兄弟（与多段 TEXT 外包框的上方几何吸附一致） */
        if ((el.type === 'FRAME' || el.type === 'GROUP') && mergedFunctional.length > 0) {
          const stay: typeof mergedFunctional = []
          const selfParent = getParentGuid(el.id)
          for (const item of mergedFunctional) {
            if (externalFdIds.has(item.id)) {
              stay.push(item)
              continue
            }
            const tb = bounds.get(item.id)
            let targetId =
              tb && directChildFrameIdList.length > 0
                ? pickPhysicalAboveByXProximity(tb, bounds, directChildFrameIdList)
                : undefined
            if (!targetId) targetId = item.elementId
            if (!targetId) targetId = attachSpecOrOuter(item.id)
            const tgtEl = targetId ? elementById.get(targetId) : undefined
            const targetOk =
              !!targetId &&
              targetId !== el.id &&
              !!tgtEl &&
              tgtEl.type !== 'TEXT' &&
              (directChildFrameIds.has(targetId) ||
                (!!selfParent && getParentGuid(targetId) === selfParent))
            if (targetOk) {
              const childEl = elementById.get(targetId!)!
              if (!childEl.functionalDescription) childEl.functionalDescription = []
              if (!childEl.functionalDescription.some((l) => l.id === item.id)) {
                childEl.functionalDescription.push({ id: item.id, text: item.text })
              }
              continue
            }
            stay.push(item)
          }
          mergedFunctional = sortTextEntriesByCanvasPosition(stay, bounds)
        }

        const mergedForOutput = mergedFunctional.map(({ id, text }) => ({ id, text }))

        if (DEBUG_TARGET_IDS.has(el.id)) {
          _dbg(`  === FINAL OUTPUT for [${el.id}] ===`)
          _dbg(`  textsOut: ${textsOut?.length ?? 0}`, textsOut?.map(t => ({ id: t.id, text: t.text.slice(0, 40) })))
          _dbg(`  mergedForOutput (functionalDescription): ${mergedForOutput.length}`, mergedForOutput.map(f => ({ id: f.id, text: f.text.slice(0, 40) })))
          _dbg(`  orphanOverallFd: ${orphanOverallFd.length}`, orphanOverallFd.map(f => ({ id: f.id, text: f.text.slice(0, 40) })))
        }

        const node: TreeEl = {
          id: el.id,
          type: el.type,
          name: unifiedName,
          ...(el.text ? { text: el.text } : {}),
          ...(mergedForOutput.length ? { functionalDescription: mergedForOutput } : {}),
          ...(el.sectionLevelHint ? { sectionLevelHint: el.sectionLevelHint } : {}),
          ...(el.from?.length ? { from: el.from } : {}),
          ...(el.to?.length ? { to: el.to } : {}),
          ...(el.isComponentInstance
            ? {
                isComponentInstance: true,
                ...(el.mainComponentId ? { mainComponentId: el.mainComponentId } : {}),
                ...(el.mainComponentName ? { mainComponentName: el.mainComponentName } : {}),
              }
            : {}),
          ...((el.type === 'FRAME' || el.type === 'GROUP') && textsOut?.length ? { texts: textsOut } : {}),
        }

        const isEmpty = !node.texts?.length && !node.functionalDescription?.length && !node.text && !node.from?.length && !node.to?.length && !node.sectionLevelHint
        if (isEmpty && (el.type === 'FRAME' || el.type === 'GROUP')) {
          _dbg(`[EMPTY-FRAME] id=${el.id} type=${el.type} name="${unifiedName}" originName="${el.originName}" frameContent.texts=${frameContent?.texts.length ?? 0} el.fd=${el.functionalDescription?.length ?? 0}`)
        }
        if (DEBUG_TARGET_IDS.has(el.id)) {
          _dbg(`  node output:`, JSON.stringify(node, null, 2).slice(0, 500))
        }

        return node
      }

      /** 带嵌套展开标记的 FRAME：下一层子 FRAME/GROUP 写入 `children`（子名仍含标记则递归） */
      function buildTreeElWithNestedChildren(el: El): TreeEl {
        const node = elToTreeEl(el)
        if (
          (el.type === 'FRAME' || el.type === 'GROUP') &&
          frameHasNestExpandMarker(el, nestMarkersArg)
        ) {
          const kids = elements
            .filter(
              (e) =>
                getParentGuid(e.id) === el.id &&
                (e.type === 'FRAME' || e.type === 'GROUP')
            )
            .sort(sortByPosition)
          if (kids.length > 0) {
            node.children = kids
              .filter(k => !nestTextBundleHandledIds.has(k.id))
              .map((k) => buildTreeElWithNestedChildren(k))
            /**
             * 子树已在 children 各节点输出时，父级去掉**重复**条；若 Figma 里在子 FRAME 下但子节点 JSON 未收录（过滤/实例等），仍保留在父级，避免丢「开始学习」等。
             */
            const innerGuids = new Set<string>()
            for (const k of kids) {
              const ent = flatByGuid.get(k.id)
              if (ent?.node) collectDescendantGuids(ent.node, innerGuids)
            }
            const emittedInChildren = new Set<string>()
            for (const ch of node.children ?? []) {
              for (const id of collectEmittedContentIdsInSubtree(ch)) emittedInChildren.add(id)
            }
            const stripIfDuplicate = (id: string) =>
              emittedInChildren.has(id) && (innerGuids.has(id) || frameHasNestExpandMarker(el, nestMarkersArg))
            if (node.texts?.length) {
              const next = node.texts.filter((t) => !stripIfDuplicate(t.id))
              if (next.length) node.texts = next
              else delete node.texts
            }
            if (node.functionalDescription?.length) {
              const nextFd = node.functionalDescription.filter((l) => !stripIfDuplicate(l.id))
              if (nextFd.length) node.functionalDescription = nextFd
              else delete node.functionalDescription
            }

            node.children = absorbAnnotationOnlyChildren(node.children!, bounds)
            if (DEBUG_TEXT_CLASSIFY) _dbg(`absorbAnnotationOnlyChildren for "${el.originName}" → ${node.children!.length} children remaining`)
          }
        }
        return node
      }

      const out: TreeEl[] = []
      for (const el of rootsByParent) {
        if (nestTextBundleHandledIds.has(el.id)) continue
        out.push(buildTreeElWithNestedChildren(el))
      }
      for (const el of extraRoots) {
        if (nestTextBundleHandledIds.has(el.id)) continue
        out.push(elToTreeEl(el))
      }
      return out
    }

    const elementsTree = buildFlatSectionElements(
      elements,
      sectionGuid,
      parentMap,
      boundsElementOnly,
      nestMarkers,
      textIdsHandledAsNestTextBundle
    )
    redistributeNestParentFunctionalDescriptions(elementsTree as NestRedistTreeEl[], {
      elementById,
      nestMarkers,
      bounds: boundsElementOnly,
      flatByGuid,
    })
    const elementsDeduped = dropTextNodesAdsorbedIntoFunctionalDescription(elementsTree)
    const sectionEntry = flatByGuid.get(sectionGuid)
    const sectionBounds = sectionEntry
      ? { x: sectionEntry.absX, y: sectionEntry.absY, w: sectionEntry.absW, h: sectionEntry.absH }
      : undefined
    sections.push({
      id: sectionGuid,
      name: sectionName,
      ...(sectionBounds && { bounds: sectionBounds }),
      ...(sectionOrphanFunctional.length > 0 && {
        functionalDescription: sectionOrphanFunctional,
      }),
      elements: elementsDeduped,
    })
  }

  const out: FigToPrdOutput = {
    documentName: baseName,
    versionFilter: versionArg ?? null,
    pageName,
    usageHint: [
      '【整体】JSON 按 Figma Section（或大块 Frame）切成多个 section；每个 section 有 elements 列表，列表里主要是 FRAME/GROUP。',
      '【嵌套】若图层名含「展开标记」（默认子串「子模块」），其下一层子 FRAME/GROUP 会出现在该节点的 children 里，规则与根级相同；子名若仍含标记可继续嵌套。子模块内部遵守与 section 相同的吸附逻辑。写入 JSON 的 name 会去掉匹配到的标记。',
      '【texts】表示界面上的短文案（按钮、标题、列表项等），从该节点子树递归收集 TEXT；名为「功能说明」的子层里的字不进 texts。',
      '【functionalDescription】表示产品/交互说明（规格、流程、提示）。可来自：功能说明子层、与图块同层或下方的说明、几何吸附上的说明等。图块正下方的**所有**说明文字（不只最近一条）均会被吸附为该图块的 functionalDescription。纯文本容器 FRAME（所有子节点为 TEXT）的内容会被合并为一条说明后整体吸附。同一节点下多条说明按画布阅读顺序排列：先上后下，同一行从左到右。已进入 functionalDescription 的文案不会再单独占一条 element。',
      '【吸附落空】子模块根与 section 共用一套「版心外说明」规则：此类 TEXT 与 section 下多 frame 之间的游离字一样，参与「某 frame 正下方」吸附（全部收集）、再模块根几何兜底、最后 section.functionalDescription。已进入子模版 FRAME 内的字不走该池，仍按框内 texts/elementId 规则。',
      '【连线】CONNECTOR/LINE 在两端元素上写 from/to；名称形如 Line / Line n 且外框细长的 VECTOR 也会在自身写 from/to。可带 label、blockId；会去重。',
    ].join('\n'),
    sections,
  }
  return out
}

// 策略：
//   1. 删除纯装饰节点（无 text、无 functionalDescription、无 from/to 连线、无有效 children 的叶子 LINE/IMAGE/ELLIPSE/RECTANGLE/POLYGON/PATH）
//   2. 无意义的 FRAME/GROUP（空 children、空 texts、无 title、无 functionalDescription、无连线）递归移除
//   3. 仅保留 originName 中有意义的名称，过滤掉 Figma 自动命名（Frame 123、Rectangle 456 等）
//   4. 去除 id 字段（Dify 不需要 guid，节省大量字符）
//   5. 去除 fromMainComponent 标记
//   
// ---------------------------------------------------------------------------
const AUTO_NAME_RE = /^(Frame|Rectangle|Ellipse|Line|Group|Vector|Image|Polygon|Path|Union|Subtract|Intersect|Exclude|instance)\s*\d*$/i

function isAutoName(name?: string): boolean {
  if (!name) return true
  return AUTO_NAME_RE.test(name.trim())
}

interface PrunableNode {
  id?: string
  type?: string
  name?: string
  originName?: string
  displayName?: string
  text?: string
  functionalDescription?: Array<{ id?: string; text: string; elementId?: string }>
  title?: string
  texts?: Array<{ id?: string; text: string; elementId?: string }>
  children?: PrunableNode[]
  from?: unknown[]
  to?: unknown[]
  sectionLevelHint?: string
  fromMainComponent?: boolean
  mainComponentId?: string
  mainComponentName?: string
  isComponentInstance?: boolean
  [k: string]: unknown
}

function pruneTree(nodes: PrunableNode[]): PrunableNode[] {
  return nodes
    .map((node) => {
      const n = { ...node }
      if (n.children) n.children = pruneTree(n.children)

      delete n.id
      delete n.fromMainComponent
      if (isAutoName(n.name)) delete n.name
      if (isAutoName(n.originName)) delete n.originName
      if (n.functionalDescription)
        n.functionalDescription = n.functionalDescription.map(({ text, elementId }) => ({
          text,
          ...(elementId && { elementId }),
        }))
      if (n.texts) n.texts = n.texts.map(({ text, elementId }) => ({ text, ...(elementId && { elementId }) }))

      return n
    })
    .filter((n) => {
      if (n.sectionLevelHint) return true
      if (n.text && isSemanticText(n.text)) return true
      if (n.text) return true
      if (n.functionalDescription?.length) return true
      if ((n.from as unknown[])?.length || (n.to as unknown[])?.length) return true
      if (n.title) return true
      if (n.texts?.length) return true
      if (typeof n.name === 'string' && !isAutoName(n.name)) return true
      if (n.displayName && !isAutoName(n.displayName)) return true

      const decorTypes = new Set(['LINE', 'IMAGE', 'ELLIPSE', 'RECTANGLE', 'POLYGON', 'PATH', 'VECTOR'])
      if (decorTypes.has(n.type ?? '') && !(n.children?.length)) return false

      if ((n.type === 'FRAME' || n.type === 'GROUP') && !(n.children?.length)) {
        const nm = (n.name ?? n.originName) as string | undefined
        if (nm && !isAutoName(nm) && isSemanticText(nm)) return true
        return false
      }

      if (n.children?.length) return true

      if (n.isComponentInstance || n.mainComponentName) return true

      return false
    })
}

export function pruneForDify(prdOutput: FigToPrdOutput): unknown {
  const sections = prdOutput.sections.map((sec) => {
    const elements = pruneTree(sec.elements as PrunableNode[])
    const { id, bounds, ...rest } = sec as Record<string, unknown>
    return { ...rest, elements }
  })
  return {
    documentName: prdOutput.documentName,
    pageName: prdOutput.pageName,
    sections,
  }
}

// ╔═══════════════════════════════════════════════════════════════╗
// ║  路线B: Style Context 提取                                    ║
// ║  从 .fig 提取视觉样式上下文 JSON (texts + areas + layout)     ║
// ║  入口: extractStyleContext / extractStyleContextDedupByContent ║
// ║  核心遍历: flatCollect (递归展开 INSTANCE → SYMBOL)            ║
// ║  特有逻辑:                                                    ║
// ║    _resolveChildVisibility — CPA/propRef 控制子节点可见性      ║
// ║    _buildLibToLocalMap — 库GUID→本地GUID映射（symbol swap）    ║
// ║    resolveStyleTextLayerContent — 多层 override 文字解析       ║
// ║  不涉及: flattenWithBounds / classifyText 等 PRD 函数         ║
// ╚═══════════════════════════════════════════════════════════════╝

export interface StyleTextEntry {
  /** text content */
  t: string
  /** fontSize */
  s: number
  /** color */
  c?: string
  /** fontFamily */
  f?: string
  /** fontWeight (omitted for Regular) */
  w?: string
  /** lineHeight */
  lh?: number | string
  /** [x, y, w, h] relative to frame origin */
  at: [number, number, number, number]
}

export interface StyleAreaEntry {
  /** stable id within frame, used for nesting relation */
  id?: string
  /** parent area id within frame */
  parentId?: string
  /** nesting depth (root=0) */
  depth?: number
  /** figma node type */
  nodeType?: string
  /** area name */
  name: string
  /** component name (for INSTANCE) */
  comp?: string
  /** [x, y, w, h] relative to frame origin */
  at: [number, number, number, number]
  /** background color */
  bg?: string
  /** border radius */
  radius?: number | [number, number, number, number]
  /** opacity */
  opacity?: number
  /** shadow shorthand */
  shadow?: string
  /** layout (auto-layout) */
  layout?: {
    dir: 'h' | 'v'
    gap?: number
    pad?: [number, number, number, number]
    main?: string
    cross?: string
  }
  /** override texts from instance */
  overrides?: string[]
  
  /** [x, y] relative to direct parent container — from Figma Layout panel's Top/Left */
  rel?: [number, number]
  /**
   * 当前节点是被 swap 进来的 INSTANCE（设计师通过父级 symbolOverrides.overriddenSymbolID 替换的组件）。
   * 仅作为人工 review / 调试时的语义提示——区分"原生节点"与"swap 后节点"。
   * **at/rel 已合并 swap override，可直接信任**，不需要因此切换到截图兜底或父容器重算。
   */
  isSwap?: boolean
  /**
   * 当前节点的父级链中存在 swap INSTANCE。
   * 仅作为人工 review 提示，与 isSwap 同语义（继承标记，便于快速过滤"swap 子树"）。
   * **at/rel 已正确累加，可直接使用**。
   */
  isFromSwapParent?: boolean
  /**
   * isFromSwapParent 节点指向最近的非 swap 祖先 area id，便于人工溯源。
   * 历史用途："非 swap 父 + rel 反推子坐标" 的兜底锚点；现在 at/rel 已可信，仅作元信息保留。
   */
  relAnchorId?: string
}

export interface StyleContextOutput {
  documentName: string
  pageName: string
  section: string
  frames: StyleFrameEntry[]
}

export interface StyleFrameEntry {
  index: number
  name: string
  group: string | null
  size: [number, number]
  texts: StyleTextEntry[]
  areas: StyleAreaEntry[]
}

export interface StyleAreaTreeNode extends Omit<StyleAreaEntry, 'id'> {
  id: string
  depth: number
  texts: StyleTextEntry[]
  children: StyleAreaTreeNode[]
}

export interface StyleFrameElementTree {
  index: number
  name: string
  group: string | null
  size: [number, number]
  roots: StyleAreaTreeNode[]
  orphanTexts: StyleTextEntry[]
}

export interface StyleSubModuleCandidate {
  name: string
  count: number
}

export interface StyleContentDedupOutput {
  documentName: string
  pageName: string
  section: string
  /** per-frame element tree with nesting relation */
  frameTrees: StyleFrameElementTree[]
}

/** @deprecated kept for backwards compatibility, use StyleTextEntry/StyleAreaEntry */
export type StyleNode = StyleTextEntry | StyleAreaEntry

function figmaColorToString(c: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  if (c.a >= 0.999) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  return `rgba(${r},${g},${b},${parseFloat(c.a.toFixed(2))})`
}

const ALIGN_MAP: Record<string, string> = {
  MIN: 'start', CENTER: 'center', MAX: 'end',
  SPACE_EVENLY: 'space-evenly', BASELINE: 'baseline',
}

function rd(n: number): number { return Math.round(n * 100) / 100 }

function _extractLayout(f: FigmaNodeChange): StyleAreaEntry['layout'] | undefined {
  if (!f.stackMode || f.stackMode === 'NONE') return undefined
  const top = rd(f.stackVerticalPadding ?? f.stackPadding ?? 0)
  const left = rd(f.stackHorizontalPadding ?? f.stackPadding ?? 0)
  const bottom = rd(f.stackPaddingBottom ?? top)
  const right = rd(f.stackPaddingRight ?? left)
  const layout: NonNullable<StyleAreaEntry['layout']> = {
    dir: f.stackMode === 'HORIZONTAL' ? 'h' : 'v',
  }
  if (f.stackSpacing != null && f.stackSpacing !== 0) layout.gap = rd(f.stackSpacing)
  if (top || right || bottom || left) layout.pad = [top, right, bottom, left]
  if (f.stackPrimaryAlignItems) layout.main = ALIGN_MAP[f.stackPrimaryAlignItems] ?? f.stackPrimaryAlignItems
  if (f.stackCounterAlignItems) layout.cross = ALIGN_MAP[f.stackCounterAlignItems] ?? f.stackCounterAlignItems
  return layout
}

function _convertCornerRadius(f: FigmaNodeChange): number | [number, number, number, number] | undefined {
  if (f.rectangleCornerRadiiIndependent) {
    const tl = f.rectangleTopLeftCornerRadius ?? 0
    const tr = f.rectangleTopRightCornerRadius ?? 0
    const bl = f.rectangleBottomLeftCornerRadius ?? 0
    const br = f.rectangleBottomRightCornerRadius ?? 0
    if (tl === 0 && tr === 0 && bl === 0 && br === 0) return undefined
    if (tl === tr && tr === bl && bl === br) return tl
    return [tl, tr, bl, br]
  }
  return f.cornerRadius && f.cornerRadius > 0 ? f.cornerRadius : undefined
}

const STYLE_AUTO_NAME_RE = /^(Frame|Group|Rectangle|Line|Vector|Ellipse|Polygon|Path|Union|Subtract|Intersect|Exclude)\s*\d*$/i
function cleanName(name: string | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed || STYLE_AUTO_NAME_RE.test(trimmed)) return null
  return trimmed
}

function _getFirstSolidColor(paints?: any[]): string | undefined {
  if (!paints?.length) return undefined
  for (const fill of paints) {
    if (fill.visible !== false && fill.type === 'SOLID' && fill.color) return figmaColorToString(fill.color)
  }
  return undefined
}

function _getShadow(effects?: any[]): string | undefined {
  if (!effects?.length) return undefined
  const shadow = effects.find((e: any) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
  if (!shadow) return undefined
  const c = shadow.color ? figmaColorToString(shadow.color) : ''
  const ox = shadow.offset ? Math.round(shadow.offset.x) : 0
  const oy = shadow.offset ? Math.round(shadow.offset.y) : 0
  const r = shadow.radius ?? 0
  return `${ox} ${oy} ${r} ${c}`.trim()
}

function _collectOverrides(f: FigmaNodeChange): string[] {
  const texts: string[] = []
  for (const ov of f.symbolData?.symbolOverrides ?? []) {
    const s = ov.textData?.characters
    if (typeof s === 'string' && s.trim()) texts.push(s.trim())
  }
  for (const d of f.derivedSymbolData ?? []) {
    const s = d.derivedTextData?.characters
    if (typeof s === 'string' && s.trim()) texts.push(s.trim())
  }
  return texts
}

/**
 * style-context 专用文本读取：
 * 1) 优先 contentimage.png
 * 2) 兜底 textData.characters
 */
function getStyleTextContent(f: FigmaNodeChange): string {
  const content = (f as FigmaNodeChange & { content?: unknown }).content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (content && typeof content === 'object') {
    const maybeCharacters = (content as { characters?: unknown }).characters
    if (typeof maybeCharacters === 'string' && maybeCharacters.trim()) return maybeCharacters.trim()
    const maybeText = (content as { text?: unknown }).text
    if (typeof maybeText === 'string' && maybeText.trim()) return maybeText.trim()
  }

  const fromTextData = f.textData?.characters
  if (typeof fromTextData === 'string' && fromTextData.trim()) return fromTextData.trim()

  return ''
}

/**
 * style-context 文本解析优先级：
 * 1) 若位于实例上下文，优先取 symbolOverrides/derivedSymbolData 的覆盖文本
 * 2) 无覆盖时回退节点本体文本（textData.characters / content）
 */
function resolveStyleTextLayerContent(node: TreeNode, instanceStack: TreeNode[]): string {
  const direct = getStyleTextContent(node.figma)
  const g = node.figma.guid ? guidToString(node.figma.guid) : ''
  const trail = instanceStack
    .map((n) => (n.figma.guid ? guidToString(n.figma.guid) : ''))
    .filter(Boolean)
  if (g) {
    for (let i = instanceStack.length - 1; i >= 0; i--) {
      const allowTrailFallback = i === instanceStack.length - 1 && isLikelyPlaceholderText(direct)
      const overrideText = getStyleOverrideTextForDescendant(instanceStack[i].figma, g, trail, allowTrailFallback)
      if (overrideText) return overrideText
    }
  }
  if (isLikelyPlaceholderText(direct)) {
    const fallback = getNearestNonPlaceholderOverrideText(instanceStack)
    if (fallback) return fallback
  }
  return direct
}

const PRUNE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'LINE', 'POLYGON', 'PATH', 'STAR', 'ROUNDED_RECTANGLE', 'RECTANGLE'])

function getViewportIntersectionArea(
  at: [number, number, number, number],
  viewport: [number, number]
): number {
  const [x, y, w, h] = at
  const [vw, vh] = viewport
  const ix = Math.max(0, Math.min(x + w, vw) - Math.max(x, 0))
  const iy = Math.max(0, Math.min(y + h, vh) - Math.max(y, 0))
  return ix * iy
}

function getViewportVisibleRatio(
  at: [number, number, number, number],
  viewport: [number, number]
): number {
  const [, , w, h] = at
  if (w <= 0 || h <= 0) return 0
  return getViewportIntersectionArea(at, viewport) / (w * h)
}

function textCenterInViewport(
  at: [number, number, number, number],
  viewport: [number, number]
): boolean {
  const [x, y, w, h] = at
  const [vw, vh] = viewport
  const cx = x + w / 2
  const cy = y + h / 2
  return cx >= 0 && cx <= vw && cy >= 0 && cy <= vh
}

type SymbolNodeIndex = {
  rootId: string
  byId: Map<string, TreeNode>
  parentById: Map<string, string>
}

function buildSymbolNodeIndex(root: TreeNode): SymbolNodeIndex {
  const rootId = root.figma.guid ? guidToString(root.figma.guid) : ''
  const byId = new Map<string, TreeNode>()
  const parentById = new Map<string, string>()

  function walk(node: TreeNode, parentId: string): void {
    const id = node.figma.guid ? guidToString(node.figma.guid) : ''
    if (id) {
      byId.set(id, node)
      if (parentId) parentById.set(id, parentId)
      parentId = id
    }
    for (const ch of node.children) walk(ch, parentId)
  }

  walk(root, '')
  return { rootId, byId, parentById }
}

function getNodeLocalOffset(index: SymbolNodeIndex, nodeId: string): { x: number; y: number } {
  let x = 0
  let y = 0
  let cur = nodeId
  while (cur) {
    const n = index.byId.get(cur)
    if (!n) break
    x += n.figma.transform?.m02 ?? 0
    y += n.figma.transform?.m12 ?? 0
    cur = index.parentById.get(cur) ?? ''
  }
  return { x, y }
}

function isNodeAndAncestorsVisible(index: SymbolNodeIndex, nodeId: string): boolean {
  let cur = nodeId
  while (cur) {
    const n = index.byId.get(cur)
    if (!n) break
    if (n.figma.visible === false) return false
    cur = index.parentById.get(cur) ?? ''
  }
  return true
}

function resolveInstanceOverrideTargetAreas(
  f: FigmaNodeChange,
  compName: string | null,
  symbolId: string | null,
  symbolIndexes: Map<string, SymbolNodeIndex>,
  instAbsX: number,
  instAbsY: number,
  instW: number,
  instH: number,
  viewport: [number, number]
): StyleAreaEntry[] {
  if (!symbolId) return []
  const index = symbolIndexes.get(symbolId)
  if (!index) return []

  const overrideItems: Array<{ text: string; targetId: string }> = []
  for (const ov of f.symbolData?.symbolOverrides ?? []) {
    const text = ov.textData?.characters?.trim()
    const guids = ov.guidPath?.guids ?? []
    if (!text || guids.length === 0) continue
    overrideItems.push({ text, targetId: guidToString(guids[guids.length - 1]) })
  }
  for (const d of f.derivedSymbolData ?? []) {
    const text = d.derivedTextData?.characters?.trim()
    const guids = d.guidPath?.guids ?? []
    if (!text || guids.length === 0) continue
    overrideItems.push({ text, targetId: guidToString(guids[guids.length - 1]) })
  }

  const out: StyleAreaEntry[] = []
  const seen = new Set<string>()

  for (const item of overrideItems) {
    let anchorId = item.targetId
    if (!index.byId.has(anchorId)) continue

    while (anchorId) {
      const n = index.byId.get(anchorId)
      if (!n) break
      if (!isFigmaTextLayerType(n.figma.type)) break
      anchorId = index.parentById.get(anchorId) ?? ''
    }
    if (!anchorId) continue

    const anchor = index.byId.get(anchorId)
    if (!anchor) continue
    if (!isNodeAndAncestorsVisible(index, anchorId)) continue

    const aw = Math.round(anchor.figma.size?.x ?? 0)
    const ah = Math.round(anchor.figma.size?.y ?? 0)
    if (aw <= 0 || ah <= 0) continue

    // 目标是避免把 override 再次锚到整个大容器实例本身
    const isTooLarge = aw * ah >= instW * instH * 0.9
    if (isTooLarge) continue

    const { x: lx, y: ly } = getNodeLocalOffset(index, anchorId)
    const at: [number, number, number, number] = [Math.round(instAbsX + lx), Math.round(instAbsY + ly), aw, ah]
    if (getViewportVisibleRatio(at, viewport) < 0.7) continue

    const key = `${at.join(',')}|${item.text}`
    if (seen.has(key)) continue
    seen.add(key)

    const areaName = cleanName(anchor.figma.name ?? '') ?? cleanName(f.name ?? '') ?? 'override-target'
    const area: StyleAreaEntry = { name: areaName, at, overrides: [item.text] }
    if (compName) area.comp = compName
    const bg = _getFirstSolidColor(anchor.figma.fillPaints)
    if (bg) area.bg = bg
    const cr = _convertCornerRadius(anchor.figma)
    if (cr != null) area.radius = cr
    if (anchor.figma.opacity != null && anchor.figma.opacity < 0.999) area.opacity = parseFloat(anchor.figma.opacity.toFixed(2))
    const shadow = _getShadow(anchor.figma.effects)
    if (shadow) area.shadow = shadow
    const layout = _extractLayout(anchor.figma)
    if (layout) area.layout = layout
    out.push(area)
  }

  return out
}

type AreaIdState = {
  prefix: string
  next: number
}

function createAreaId(areaIdState: AreaIdState): string {
  const id = `${areaIdState.prefix}${areaIdState.next}`
  areaIdState.next += 1
  return id
}

function withAreaMeta(
  area: StyleAreaEntry,
  nodeType: string,
  depth: number,
  parentAreaId: string | null,
  areaIdState: AreaIdState,
  isFromSwapParent?: boolean,
  isSwap?: boolean
): StyleAreaEntry {
  area.id = createAreaId(areaIdState)
  area.depth = depth
  area.nodeType = nodeType
  if (parentAreaId) area.parentId = parentAreaId
  if (isFromSwapParent) area.isFromSwapParent = true
  if (isSwap) area.isSwap = true
  return area
}

/**
 * Resolve visibility for each SYMBOL child when expanding an INSTANCE.
 * Returns { hidden: children to skip, forceVisible: descendants to force-show }.
 */
function _resolveChildVisibility(
  overrides: ReadonlyArray<any>,
  cpas: ReadonlyArray<any>,
  symbolNode: TreeNode,
): { hidden: Set<string>; forceVisible: Set<string> } {
  const hidden = new Set<string>()
  const forceVisible = new Set<string>()
  for (const ov of overrides) {
    if ((ov as any).visible === false) {
      const guids = ov.guidPath?.guids ?? []
      if (guids.length === 1) hidden.add(guidToString(guids[0]))
    }
  }
  if (cpas.length > 0) {
    const boolMap = new Map<string, boolean>()
    for (const cpa of cpas) {
      if (cpa.value?.boolValue != null && cpa.defID)
        boolMap.set(`${cpa.defID.sessionID}:${cpa.defID.localID}`, cpa.value.boolValue)
    }
    if (boolMap.size > 0) {
      ;(function walk(n: TreeNode, ancestors: string[]) {
        for (const ref of ((n.figma as any).componentPropRefs ?? [])) {
          if (ref.componentPropNodeField === 'VISIBLE' && ref.defID) {
            const key = `${ref.defID.sessionID}:${ref.defID.localID}`
            if (boolMap.has(key)) {
              const id = n.figma.guid ? guidToString(n.figma.guid) : ''
              if (!id) continue
              if (!boolMap.get(key)) hidden.add(id)
              else if (n.figma.visible === false) {
                forceVisible.add(id)
                for (const a of ancestors) forceVisible.add(a)
              }
            }
          }
        }
        for (const ch of n.children) {
          const id = n.figma.guid ? guidToString(n.figma.guid) : ''
          walk(ch, id ? [...ancestors, id] : ancestors)
        }
      })(symbolNode, [])
    }
  }
  return { hidden, forceVisible }
}

/**
 * Build lib→local GUID map for INSTANCE expansion.
 * Uses derivedSymbolData depth-1 entries as the primary source (ordered 1:1 with SYMBOL children),
 * supplemented by overrides' guidPaths for additional lib GUIDs.
 */
function _buildLibToLocalMap(
  instanceFigma: FigmaNodeChange,
  overrides: ReadonlyArray<any>,
  symbolNode: TreeNode,
): Map<string, string> {
  const map = new Map<string, string>()
  const localChildren = symbolNode.children
  if (localChildren.length === 0) return map
  const localChildIds = localChildren.map(ch => ch.figma.guid ? guidToString(ch.figma.guid) : '').filter(Boolean)
  const localChildSet = new Set(localChildIds)
  const parseId = (g: string) => parseInt(g.split(':')[1])

  // Collect depth-1 lib GUIDs from derivedSymbolData (primary, ordered)
  const derivedDepth1Libs: string[] = []
  const seenDerived = new Set<string>()
  for (const d of instanceFigma.derivedSymbolData ?? []) {
    const guids = d.guidPath?.guids ?? []
    if (guids.length >= 1) {
      const g = guidToString(guids[0])
      if (!localChildSet.has(g) && !seenDerived.has(g)) {
        seenDerived.add(g)
        derivedDepth1Libs.push(g)
      }
    }
  }

  // Collect from overrides as supplement
  const allLibGuids = new Set(derivedDepth1Libs)
  for (const ov of overrides) {
    const guids = ov.guidPath?.guids ?? []
    if (guids.length >= 1) {
      const g = guidToString(guids[0])
      if (!localChildSet.has(g)) allLibGuids.add(g)
    }
  }
  if (allLibGuids.size === 0) return map

  // Strategy 1: exact match (lib count == local children count)
  const sortedLib = [...allLibGuids].sort((a, b) => parseId(a) - parseId(b))
  const sortedLocal = [...localChildSet].sort((a, b) => parseId(a) - parseId(b))
  if (allLibGuids.size === localChildren.length) {
    for (let i = 0; i < sortedLib.length && i < sortedLocal.length; i++) map.set(sortedLib[i], sortedLocal[i])
    return map
  }

  // Strategy 2: INSTANCE-type children only (skip VECTOR/PATH dividers)
  const instChildIds = localChildren
    .filter(ch => ch.figma.type === 'INSTANCE')
    .map(ch => ch.figma.guid ? guidToString(ch.figma.guid) : '')
    .filter(Boolean)
    .sort((a, b) => parseId(a) - parseId(b))
  if (allLibGuids.size === instChildIds.length && instChildIds.length > 0) {
    for (let i = 0; i < sortedLib.length && i < instChildIds.length; i++) map.set(sortedLib[i], instChildIds[i])
    return map
  }

  // Strategy 3: lib count > local — use derivedDepth1 order to map N:N where possible,
  // then add remaining overrides-only lib GUIDs with best-effort sorted mapping.
  if (derivedDepth1Libs.length >= localChildren.length) {
    const sortedD = [...derivedDepth1Libs].sort((a, b) => parseId(a) - parseId(b))
    for (let i = 0; i < sortedLocal.length && i < sortedD.length; i++) map.set(sortedD[i], sortedLocal[i])
    // Extra lib GUIDs (from overrides but not in derived) remain unmapped — translate returns self
    return map
  }

  // Strategy 4: single child fallback
  if (localChildren.length === 1) {
    const onlyId = localChildIds[0]
    if (onlyId) for (const lg of allLibGuids) map.set(lg, onlyId)
  }
  return map
}

function canExpandInstanceSymbol(symbolId: string | null, instanceSymbolTrail: string[]): boolean {
  if (!symbolId) return false
  return !instanceSymbolTrail.includes(symbolId)
}

/**
 * 当 INSTANCE 的 size 与 SYMBOL 的 size 不一致时，按子节点的 horizontal/verticalConstraint
 * 重算其 transform/size（仅对 SYMBOL 直接子节点应用一次）。
 *
 * Figma 的 constraint 语义（相对 SYMBOL 容器的边）：
 *   MIN     —— 距起点不变（默认）
 *   MAX     —— 距终点不变 → pos += delta
 *   CENTER  —— 距中线不变 → pos += delta/2
 *   STRETCH —— 距两端均不变 → size += delta
 *   SCALE   —— 等比例缩放 → pos *= ratio, size *= ratio
 *
 * 返回浅克隆后的 TreeNode（不污染原始树）；如未发生位移则原样返回 ch。
 */
function _applyInstanceSizeOverrideToChild(
  ch: TreeNode,
  instW: number,
  instH: number,
  symW: number,
  symH: number,
): TreeNode {
  if (symW <= 0 || symH <= 0) return ch
  const dW = instW - symW
  const dH = instH - symH
  if (dW === 0 && dH === 0) return ch

  const cf = ch.figma
  const tx = cf.transform?.m02 ?? 0
  const ty = cf.transform?.m12 ?? 0
  const cw = cf.size?.x ?? 0
  const chy = cf.size?.y ?? 0
  const hCon = (cf as any).horizontalConstraint as string | undefined
  const vCon = (cf as any).verticalConstraint as string | undefined

  let newTx = tx
  let newTy = ty
  let newCw = cw
  let newCh = chy

  switch (hCon) {
    case 'MAX': newTx = tx + dW; break
    case 'CENTER': newTx = tx + dW / 2; break
    case 'STRETCH': newCw = cw + dW; break
    case 'SCALE': {
      const r = symW === 0 ? 1 : instW / symW
      newTx = tx * r
      newCw = cw * r
      break
    }
    // MIN / undefined: 不动
  }
  switch (vCon) {
    case 'MAX': newTy = ty + dH; break
    case 'CENTER': newTy = ty + dH / 2; break
    case 'STRETCH': newCh = chy + dH; break
    case 'SCALE': {
      const r = symH === 0 ? 1 : instH / symH
      newTy = ty * r
      newCh = chy * r
      break
    }
  }

  if (newTx === tx && newTy === ty && newCw === cw && newCh === chy) return ch

  return {
    ...ch,
    figma: {
      ...cf,
      transform: cf.transform
        ? { ...cf.transform, m02: newTx, m12: newTy }
        : ({ m00: 1, m01: 0, m02: newTx, m10: 0, m11: 1, m12: newTy } as any),
      size: { x: newCw, y: newCh } as any,
    },
  }
}

/** 父级布局信息，用于子节点坐标校正 */
interface ParentLayoutInfo {
  /** 父容器坐标 [x, y, w, h] */
  at: [number, number, number, number]
  /** 父容器布局 */
  layout: {
    dir: 'h' | 'v'
    gap?: number
    pad?: [number, number, number, number]
    main?: string
    cross?: string
  } | undefined
  /** 当前处理到第几个可见子元素（用于计算 gap 累积） */
  visibleChildIndex: number
  /** 可见子元素总数 */
  visibleChildCount: number
}

/**
 * Walk node tree, collecting TEXT entries into `texts` and meaningful FRAME/INSTANCE into `areas`.
 * INSTANCE: expand via SYMBOL children to find inner TEXT nodes.
 * 
 * 每个 area 输出 rel 字段 [x, y]：相对直接父容器的偏移（对应 Figma Layout 面板的 Top/Left）。
 *
 * 位置计算覆盖三处合并：
 *   1) 节点自身 transform.m02/m12 累加到 ax/ay
 *   2) 进入 SYMBOL 子树时，子节点的 transform 继续累加（INSTANCE size 与 SYMBOL size 不一致时，
 *      按子节点 horizontal/verticalConstraint 自动重排——见 _applyInstanceSizeOverrideToChild）
 *   3) INSTANCE 上的 derivedSymbolData / symbolOverrides 透传给子节点作为 inheritedOverrides，
 *      swap 时切换到新 SYMBOL 子树继续展开
 * 因此 at/rel 即"Figma 实际渲染位置"，下游可直接信任。
 */
function flatCollect(
  node: TreeNode,
  symbolIdToName: Map<string, string>,
  symbolIdToNode: Map<string, TreeNode>,
  symbolIndexes: Map<string, SymbolNodeIndex>,
  accX: number,
  accY: number,
  texts: StyleTextEntry[],
  areas: StyleAreaEntry[],
  depth: number,
  maxDepth: number,
  viewport: [number, number],
  instanceStack: TreeNode[],
  instanceSymbolTrail: string[],
  parentAreaId: string | null,
  areaIdState: AreaIdState,
  inheritedSwapSymbolId?: any,
  inheritedOverrides?: ReadonlyArray<any>,
  forceVisibleIds?: Set<string>,
  parentLayoutInfo?: ParentLayoutInfo,
  indexInParent?: number,
  /** 用于计算 rel 的实际偏移量 [relToParentX, relToParentY]，由父级 autolayout 算出后传入 */
  relOverride?: [number, number],
  /** 标记当前节点的父级是否是被 swap 进来的 INSTANCE，用于下游判断 rel 可信度 */
  isFromSwapParent?: boolean,
) {
  const f = node.figma
  const nodeGuid = f.guid ? guidToString(f.guid) : ''
  if (f.visible === false && !(nodeGuid && forceVisibleIds?.has(nodeGuid))) return
  if (f.opacity != null && f.opacity <= 0.01) return
  if (PRUNE_TYPES.has(f.type ?? '') && !getStyleTextContent(f)) return
  if (depth > maxDepth) return

  const relX = f.transform ? f.transform.m02 : 0
  const relY = f.transform ? f.transform.m12 : 0
  const ax = accX + relX
  const ay = accY + relY
  const w = f.size ? Math.round(f.size.x) : 0
  const h = f.size ? Math.round(f.size.y) : 0
  const at: [number, number, number, number] = [Math.round(ax), Math.round(ay), w, h]
  const visibleRatio = getViewportVisibleRatio(at, viewport)

  if (isFigmaTextLayerType(f.type)) {
    const text = resolveStyleTextLayerContent(node, instanceStack)
    if (text && f.fontSize && textCenterInViewport(at, viewport)) {
      const entry: StyleTextEntry = { t: text, s: f.fontSize, at }
      const color = _getFirstSolidColor(f.fillPaints)
      if (color) entry.c = color
      if (f.fontName?.family) entry.f = f.fontName.family
      if (f.fontName?.style && f.fontName.style !== 'Regular') entry.w = f.fontName.style
      if (f.lineHeight?.value != null) entry.lh = f.lineHeight.units === 'PERCENT' ? `${f.lineHeight.value}%` : rd(f.lineHeight.value)
      texts.push(entry)
    }
    return
  }

  if (f.type === 'INSTANCE') {
    const wasSwapped = !!inheritedSwapSymbolId
    const symId = inheritedSwapSymbolId ?? f.overriddenSymbolID ?? f.symbolData?.symbolID
    const sid = symId ? guidToString(symId) : null
    const compName = sid ? symbolIdToName.get(sid) : null
    const rawName = (f.name ?? '').trim()
    const cname = wasSwapped && compName
      ? compName
      : (cleanName(rawName) ?? rawName) || (compName ?? 'INSTANCE')
    const overrides = _collectOverrides(f)
    let currentAreaId: string | null = parentAreaId

    if (w > 0 && h > 0 && visibleRatio > 0.01 && (cname || compName)) {
      const area: StyleAreaEntry = { name: cname || compName || '', at }
      if (compName) area.comp = compName
      const bg = _getFirstSolidColor(f.fillPaints)
      if (bg) area.bg = bg
      const cr = _convertCornerRadius(f)
      if (cr != null) area.radius = cr
      if (f.opacity != null && f.opacity < 0.999) area.opacity = parseFloat(f.opacity.toFixed(2))
      const shadow = _getShadow(f.effects)
      if (shadow) area.shadow = shadow
      const layout = _extractLayout(f)
      if (layout) area.layout = layout
      if (overrides.length) area.overrides = overrides
      
      if (relOverride) {
        area.rel = relOverride
      } else {
        area.rel = [Math.round(relX), Math.round(relY)]
      }
      
      withAreaMeta(area, f.type ?? 'INSTANCE', depth, parentAreaId, areaIdState, isFromSwapParent, wasSwapped)
      areas.push(area)
      currentAreaId = area.id ?? parentAreaId
    }

    if (canExpandInstanceSymbol(sid, instanceSymbolTrail)) {
      const symbolNode = sid ? symbolIdToNode.get(sid) : undefined
      if (symbolNode) {
        // Determine effective overrides + CPA for this expansion level.
        // When swapped, f's own data targets the OLD symbol → use inheritedOverrides.
        const effectiveOverrides: any[] = wasSwapped
          ? [...(inheritedOverrides ?? [])]
          : [...(f.symbolData?.symbolOverrides ?? []), ...(inheritedOverrides ?? [])]

        let effectiveCpas: any[] = (f as any).componentPropAssignments ?? []
        if (wasSwapped && inheritedOverrides?.length) {
          for (const ov of inheritedOverrides) {
            if ((ov.guidPath?.guids?.length ?? 0) === 0 && (ov as any).componentPropAssignments?.length) {
              effectiveCpas = (ov as any).componentPropAssignments
              break
            }
          }
        }

        const { hidden: hiddenChildIds, forceVisible: childForceVisible } =
          _resolveChildVisibility(effectiveOverrides, effectiveCpas, symbolNode)

        const libToLocal = _buildLibToLocalMap(f, effectiveOverrides, symbolNode)
        const translate = (g: string) => libToLocal.get(g) ?? g

        const childSwapMap = new Map<string, any>()
        const childOverrideMap = new Map<string, any[]>()

        for (const ov of effectiveOverrides) {
          const guids = ov.guidPath?.guids ?? []
          if (guids.length === 0) continue
          const firstLocal = translate(guidToString(guids[0]))

          if (guids.length === 1) {
            if ((ov as any).overriddenSymbolID) childSwapMap.set(firstLocal, (ov as any).overriddenSymbolID)
            if ((ov as any).visible === false) hiddenChildIds.add(firstLocal)
            const shifted = { ...ov, guidPath: { guids: [] } }
            let list = childOverrideMap.get(firstLocal)
            if (!list) { list = []; childOverrideMap.set(firstLocal, list) }
            list.push(shifted)
          } else {
            const shifted = { ...ov, guidPath: { guids: guids.slice(1) } }
            let list = childOverrideMap.get(firstLocal)
            if (!list) { list = []; childOverrideMap.set(firstLocal, list) }
            list.push(shifted)
          }
        }

        const nextInstanceStack = [...instanceStack, node]
        const nextInstanceSymbolTrail = sid ? [...instanceSymbolTrail, sid] : instanceSymbolTrail
        const mergedForceVisible = forceVisibleIds?.size
          ? new Set([...childForceVisible, ...forceVisibleIds])
          : childForceVisible.size ? childForceVisible : undefined

        const symStackMode = symbolNode.figma.stackMode as string | undefined
        const symStackSpacing = symbolNode.figma.stackSpacing ?? 0
        const symPadLeft = symbolNode.figma.stackPaddingLeft ?? symbolNode.figma.stackHorizontalPadding ?? 0
        const symPadTop = symbolNode.figma.stackPaddingTop ?? symbolNode.figma.stackVerticalPadding ?? 0
        const needRelayout = !!symStackMode
        
        // 构建父级布局信息，传递给子节点用于坐标校正
        const parentLayoutForChildren: ParentLayoutInfo | undefined = needRelayout ? {
          at: [Math.round(ax), Math.round(ay), w, h],
          layout: {
            dir: symStackMode === 'HORIZONTAL' ? 'h' : 'v',
            gap: symStackSpacing || undefined,
            pad: [symPadTop, symPadLeft, symPadTop, symPadLeft], // [top, right, bottom, left]
          },
          visibleChildIndex: 0,
          visibleChildCount: 0 // 先设为0，等统计完可见子元素再更新
        } : undefined
        
        // 统计可见子元素数量
        if (parentLayoutForChildren) {
          let visibleCount = 0
          for (const ch of symbolNode.children) {
            const chId = ch.figma.guid ? guidToString(ch.figma.guid) : ''
            if (!chId || !hiddenChildIds.has(chId)) visibleCount++
          }
          parentLayoutForChildren.visibleChildCount = visibleCount
        }

        let layoutCursor = symStackMode === 'HORIZONTAL' ? symPadLeft : symPadTop
        let visibleChildIndex = 0

        // INSTANCE size 覆盖检测：用于按 constraint 重排 SYMBOL 子节点（仅非 auto-layout 容器适用）
        const instW = f.size?.x ?? 0
        const instH = f.size?.y ?? 0
        const symW = symbolNode.figma.size?.x ?? 0
        const symH = symbolNode.figma.size?.y ?? 0
        const sizeOverridden = !needRelayout && (instW !== symW || instH !== symH)

        for (const ch of symbolNode.children) {
          const chId = ch.figma.guid ? guidToString(ch.figma.guid) : ''
          if (chId && hiddenChildIds.has(chId)) continue

          // 当 INSTANCE size 覆盖了 SYMBOL size 时，按子节点 constraint 重写其 transform/size
          const chForCall = sizeOverridden
            ? _applyInstanceSizeOverrideToChild(ch, instW, instH, symW, symH)
            : ch

          let childAccX = ax
          let childAccY = ay
          let childRelOverride: [number, number] | undefined
          if (needRelayout) {
            const chW = chForCall.figma.size ? Math.round(chForCall.figma.size.x) : 0
            const chH = chForCall.figma.size ? Math.round(chForCall.figma.size.y) : 0
            const chRelX = chForCall.figma.transform ? chForCall.figma.transform.m02 : 0
            const chRelY = chForCall.figma.transform ? chForCall.figma.transform.m12 : 0
            if (symStackMode === 'HORIZONTAL') {
              childAccX = ax + layoutCursor - chRelX
              childAccY = ay + symPadTop - chRelY
              childRelOverride = [Math.round(layoutCursor), Math.round(symPadTop)]
              layoutCursor += chW + symStackSpacing
            } else {
              childAccX = ax + symPadLeft - chRelX
              childAccY = ay + layoutCursor - chRelY
              childRelOverride = [Math.round(symPadLeft), Math.round(layoutCursor)]
              layoutCursor += chH + symStackSpacing
            }
          }

          const childParentLayout = parentLayoutForChildren ? {
            ...parentLayoutForChildren,
            visibleChildIndex
          } : undefined
          visibleChildIndex++

          flatCollect(
            chForCall,
            symbolIdToName,
            symbolIdToNode,
            symbolIndexes,
            childAccX,
            childAccY,
            texts,
            areas,
            depth + 1,
            maxDepth,
            viewport,
            nextInstanceStack,
            nextInstanceSymbolTrail,
            currentAreaId,
            areaIdState,
            chId ? childSwapMap.get(chId) : undefined,
            chId ? childOverrideMap.get(chId) : undefined,
            mergedForceVisible,
            childParentLayout,
            visibleChildIndex - 1,
            childRelOverride,
            // 如果当前 INSTANCE 是被 swap 的，或其父级已经是 swap 来的，则标记子节点
            wasSwapped || isFromSwapParent,
          )
        }
      }
    }

    const overrideTargetAreas = resolveInstanceOverrideTargetAreas(
      f,
      compName ?? null,
      sid,
      symbolIndexes,
      ax,
      ay,
      w,
      h,
      viewport
    )
    for (const a of overrideTargetAreas) {
      if (a.at[2] <= 0 || a.at[3] <= 0) continue
      if (getViewportVisibleRatio(a.at, viewport) <= 0.01) continue
      withAreaMeta(a, 'INSTANCE', depth + 1, currentAreaId, areaIdState, wasSwapped || isFromSwapParent)
      areas.push(a)
    }
    return
  }

  // FRAME / GROUP / SECTION
  const rawName = (f.name ?? '').trim()
  const cname = (cleanName(rawName) ?? rawName) || (f.type ?? 'FRAME')
  const bg = _getFirstSolidColor(f.fillPaints)
  const cr = _convertCornerRadius(f)
  const layout = _extractLayout(f)
  const shadow = _getShadow(f.effects)
  let currentAreaId: string | null = parentAreaId
  const viewportAccept = visibleRatio > 0.01
  if (w > 0 && h > 0 && cname && viewportAccept) {
    const area: StyleAreaEntry = { name: cname, at }
    if (bg) area.bg = bg
    if (cr != null) area.radius = cr
    if (f.opacity != null && f.opacity < 0.999) area.opacity = parseFloat(f.opacity.toFixed(2))
    if (shadow) area.shadow = shadow
    if (layout) area.layout = layout
    if (relOverride) {
      area.rel = relOverride
    } else {
      area.rel = [Math.round(relX), Math.round(relY)]
    }
    withAreaMeta(area, f.type ?? 'FRAME', depth, parentAreaId, areaIdState, isFromSwapParent)
    areas.push(area)
    currentAreaId = area.id ?? parentAreaId
  }

  // 对于 FRAME/GROUP/SECTION 节点，如果自身有 Autolayout，也需要传递布局信息给子节点
  const frameLayoutInfo: ParentLayoutInfo | undefined = layout ? {
    at: [Math.round(ax), Math.round(ay), w, h],
    layout,
    visibleChildIndex: 0,
    visibleChildCount: node.children.length
  } : parentLayoutInfo

  let childIdx = 0
  for (const ch of node.children) {
    flatCollect(
      ch,
      symbolIdToName,
      symbolIdToNode,
      symbolIndexes,
      ax,
      ay,
      texts,
      areas,
      depth + 1,
      maxDepth,
      viewport,
      instanceStack,
      instanceSymbolTrail,
      currentAreaId,
      areaIdState,
      undefined,
      undefined,
      forceVisibleIds,
      frameLayoutInfo ? { ...frameLayoutInfo, visibleChildIndex: childIdx } : undefined,
      childIdx,
      undefined,
      // 继承父级的 swap 状态
      isFromSwapParent,
    )
    childIdx++
  }
}

const COMMON_PAGE_WIDTHS = [375, 390, 393, 414, 428, 768, 1024, 1280, 1366, 1440, 1920]
function isStandardPageSize(w: number, h: number): boolean {
  return COMMON_PAGE_WIDTHS.some(pw => Math.abs(w - pw) < 10) && h > 400
}

/**
 * 从 .fig buffer 提取样式上下文 JSON（texts + areas）。
 *
 * - 子模块递归：section 下的 frame 若包含标准页面尺寸的子 frame，递归进入并拍平。
 * - INSTANCE 展开：使用 SYMBOL 定义获取内部 TEXT 节点样式。
 * 
 */
export function extractStyleContext(
  buffer: ArrayBuffer,
  options: {
    version?: string
    sectionName?: string
    subModuleName?: string
    maxDepth?: number
    parseOptions?: Partial<ParseFigOptions>
  } = {}
): StyleContextOutput {
  const parseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options.parseOptions }
  const decoded = parseFigFile(buffer, parseOptions)
  const tree = buildTree(decoded.nodeChanges)
  if (!tree) throw new Error('No document root in .fig')

  const pages = tree.children.filter(isUserPage)
  if (pages.length === 0) throw new Error('No user pages in .fig')

  let pageIndex = 0
  if (options.version) {
    const i = pages.findIndex((p) => (p.figma.name ?? '').includes(options.version!))
    if (i >= 0) pageIndex = i
    else throw new Error(`Version "${options.version}" not found in page names`)
  }
  const page = pages[pageIndex]
  const pageName = page.figma.name ?? `Page ${pageIndex + 1}`

  const symbolIdToName = new Map<string, string>()
  const symbolIdToNode = new Map<string, TreeNode>()
  for (const canvas of tree.children) {
    collectMainComponents(canvas, symbolIdToName)
    collectSymbolNodes(canvas, symbolIdToNode)
  }
  const symbolIndexes = new Map<string, SymbolNodeIndex>()
  for (const [sid, node] of symbolIdToNode) {
    symbolIndexes.set(sid, buildSymbolNodeIndex(node))
  }

  const maxD = options.maxDepth ?? 10

  function findSection(node: TreeNode, name: string): TreeNode | null {
    if (node.figma.type === 'SECTION' && (node.figma.name ?? '').includes(name)) return node
    for (const ch of node.children) {
      const found = findSection(ch, name)
      if (found) return found
    }
    return null
  }

  let sectionNode: TreeNode | null = null
  if (options.sectionName) {
    sectionNode = findSection(page, options.sectionName)
    if (!sectionNode) throw new Error(`Section "${options.sectionName}" not found`)
  } else {
    const candidates: TreeNode[] = []
    collectSectionNodes(page, candidates)
    if (candidates.length === 1) sectionNode = candidates[0]
    else if (candidates.length > 1) throw new Error(`Multiple sections found, specify sectionName. Available: ${candidates.map(s => s.figma.name).join(', ')}`)
    else throw new Error('No sections found in page')
  }

  const sectionName = (sectionNode.figma.name ?? '').trim()

  let searchRoot = sectionNode
  if (options.subModuleName) {
    function findByName(node: TreeNode, name: string): TreeNode | null {
      const currentName = (node.figma.name ?? '').trim()
      if (currentName.includes(name) && hasSubModuleMarker(currentName)) return node
      for (const ch of node.children) {
        const found = findByName(ch, name)
        if (found) return found
      }
      return null
    }
    const sub = findByName(sectionNode, options.subModuleName)
    if (!sub) throw new Error(`Sub-module "${options.subModuleName}" not found in section "${sectionName}" (only nodes with "子模块" marker are eligible)`)
    searchRoot = sub
  }

  type FrameEntry = { node: TreeNode; group: string | null }
  const pageFrames: FrameEntry[] = []

  function collectPageFrames(container: TreeNode, groupName: string | null) {
    for (const child of container.children) {
      if (child.figma.visible === false) continue
      const t = child.figma.type
      if (t !== 'FRAME' && t !== 'GROUP' && t !== 'SECTION') continue
      const cw = Math.round(child.figma.size?.x ?? 0)
      const ch2 = Math.round(child.figma.size?.y ?? 0)
      if (isStandardPageSize(cw, ch2)) {
        pageFrames.push({ node: child, group: groupName })
      } else {
        const hasPageChildren = child.children.some((gc: TreeNode) => {
          const gw = Math.round(gc.figma.size?.x ?? 0)
          const gh = Math.round(gc.figma.size?.y ?? 0)
          return isStandardPageSize(gw, gh)
        })
        if (hasPageChildren) {
          collectPageFrames(child, (child.figma.name ?? '').trim() || groupName)
        }
      }
    }
  }

  collectPageFrames(searchRoot, options.subModuleName ? (searchRoot.figma.name ?? '').trim() : null)

  const frames: StyleContextOutput['frames'] = []
  for (let i = 0; i < pageFrames.length; i++) {
    const { node: pf, group } = pageFrames[i]
    const w = Math.round(pf.figma.size?.x ?? 0)
    const h = Math.round(pf.figma.size?.y ?? 0)

    const texts: StyleTextEntry[] = []
    const areasList: StyleAreaEntry[] = []
    const areaIdState: AreaIdState = { prefix: `f${i}-a`, next: 1 }
    for (const ch of pf.children) {
      flatCollect(
        ch,
        symbolIdToName,
        symbolIdToNode,
        symbolIndexes,
        0,
        0,
        texts,
        areasList,
        0,
        maxD,
        [w, h],
        [],
        [],
        null,
        areaIdState,
        undefined, // inheritedSwapSymbolId
        undefined, // inheritedOverrides
        undefined, // forceVisibleIds
        undefined, // parentLayoutInfo
        0,         // indexInParent
        undefined, // relOverride
        false,     // isFromSwapParent (顶层节点默认不是 swap 来的)
      )
    }

    frames.push({
      index: i,
      name: (pf.figma.name ?? '').trim(),
      group,
      size: [w, h],
      texts,
      areas: areasList,
    })
  }

  return {
    documentName: tree.figma.name ?? 'document',
    pageName,
    section: sectionName,
    frames,
  }
}

export function listStyleSubModuleCandidates(
  buffer: ArrayBuffer,
  options: {
    version?: string
    sectionName: string
    parseOptions?: Partial<ParseFigOptions>
  }
): StyleSubModuleCandidate[] {
  const parseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options.parseOptions }
  const decoded = parseFigFile(buffer, parseOptions)
  const tree = buildTree(decoded.nodeChanges)
  if (!tree) throw new Error('No document root in .fig')

  const pages = tree.children.filter(isUserPage)
  if (pages.length === 0) throw new Error('No user pages in .fig')

  let pageIndex = 0
  if (options.version) {
    const i = pages.findIndex((p) => (p.figma.name ?? '').includes(options.version!))
    if (i >= 0) pageIndex = i
    else throw new Error(`Version "${options.version}" not found in page names`)
  }
  const page = pages[pageIndex]

  function findSection(node: TreeNode, name: string): TreeNode | null {
    if (node.figma.type === 'SECTION' && (node.figma.name ?? '').includes(name)) return node
    for (const ch of node.children) {
      const found = findSection(ch, name)
      if (found) return found
    }
    return null
  }

  const sectionNode = findSection(page, options.sectionName)
  if (!sectionNode) throw new Error(`Section "${options.sectionName}" not found`)

  const counts = new Map<string, number>()
  function walk(node: TreeNode): void {
    const name = (node.figma.name ?? '').trim()
    if (hasSubModuleMarker(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    for (const ch of node.children) walk(ch)
  }
  walk(sectionNode)

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

function styleTextCenterInArea(
  areaAt: [number, number, number, number],
  textAt: [number, number, number, number]
): boolean {
  const [ax, ay, aw, ah] = areaAt
  const [tx, ty, tw, th] = textAt
  const cx = tx + tw / 2
  const cy = ty + th / 2
  return cx >= ax && cx <= ax + aw && cy >= ay && cy <= ay + ah
}

/**
 * 将每条文本归属到“最小包含面积”的控件，避免大容器吞并子控件全部文本。
 * 若存在多个同面积最小控件（如同位图形层），文本会同时归属这些控件。
 */
function buildOwnedTextEntriesByArea(
  areas: StyleAreaEntry[],
  texts: StyleTextEntry[]
): {
  byAreaIndex: Map<number, StyleTextEntry[]>
  assignedTextIndexes: Set<number>
} {
  const byAreaIndex = new Map<number, StyleTextEntry[]>()
  const assignedTextIndexes = new Set<number>()
  const areaSizes = areas.map((a) => a.at[2] * a.at[3])

  for (let textIndex = 0; textIndex < texts.length; textIndex++) {
    const text = texts[textIndex]
    const containing: number[] = []
    for (let i = 0; i < areas.length; i++) {
      if (styleTextCenterInArea(areas[i].at, text.at)) containing.push(i)
    }
    if (containing.length === 0) continue

    let minSize = Number.POSITIVE_INFINITY
    for (const idx of containing) minSize = Math.min(minSize, areaSizes[idx])
    const winners = containing.filter((idx) => areaSizes[idx] === minSize)
    if (winners.length === 0) continue

    assignedTextIndexes.add(textIndex)
    for (const idx of winners) {
      const arr = byAreaIndex.get(idx) ?? []
      arr.push(text)
      byAreaIndex.set(idx, arr)
    }
  }

  return { byAreaIndex, assignedTextIndexes }
}

function compareStyleArea(a: Pick<StyleAreaEntry, 'at'>, b: Pick<StyleAreaEntry, 'at'>): number {
  const ay = a.at[1] - b.at[1]
  if (ay !== 0) return ay
  const ax = a.at[0] - b.at[0]
  if (ax !== 0) return ax
  const as = a.at[2] * a.at[3]
  const bs = b.at[2] * b.at[3]
  return as - bs
}

function buildFrameElementTrees(style: StyleContextOutput): StyleFrameElementTree[] {
  return style.frames.map((frame) => {
    const ownership = buildOwnedTextEntriesByArea(frame.areas, frame.texts)
    const nodeById = new Map<string, StyleAreaTreeNode>()
    const nodes: StyleAreaTreeNode[] = []

    for (let areaIndex = 0; areaIndex < frame.areas.length; areaIndex++) {
      const area = frame.areas[areaIndex]
      const id = area.id && area.id.trim() ? area.id : `f${frame.index}-a${areaIndex + 1}`
      const ownedTexts = ownership.byAreaIndex.get(areaIndex) ?? []
      const { id: _ignoreId, ...restArea } = area
      const node: StyleAreaTreeNode = {
        ...restArea,
        id,
        depth: area.depth ?? 0,
        texts: ownedTexts,
        children: [],
      }
      nodeById.set(id, node)
      nodes.push(node)
    }

    const roots: StyleAreaTreeNode[] = []
    for (const node of nodes) {
      const parentId = node.parentId
      if (parentId && parentId !== node.id) {
        const parent = nodeById.get(parentId)
        if (parent) {
          parent.children.push(node)
          continue
        }
      }
      roots.push(node)
    }

    function sortTree(nodesToSort: StyleAreaTreeNode[], depth: number, parentId?: string): void {
      nodesToSort.sort(compareStyleArea)
      for (const node of nodesToSort) {
        node.depth = depth
        if (parentId) node.parentId = parentId
        else delete node.parentId
        sortTree(node.children, depth + 1, node.id)
      }
    }

    function isGhostWrapper(node: StyleAreaTreeNode): boolean {
      if (node.children.length === 0) return false
      if (node.texts.length > 0) return false
      if ((node.overrides?.length ?? 0) > 0) return false
      if (node.comp) return false
      const hasVisualStyle = Boolean(node.bg) || node.radius != null || Boolean(node.shadow)
      if (hasVisualStyle) return false
      const frameArea = frame.size[0] * frame.size[1]
      const nodeArea = node.at[2] * node.at[3]
      const areaRatio = frameArea > 0 ? nodeArea / frameArea : 0
      return areaRatio >= 0.18 || node.at[2] >= frame.size[0] * 0.55 || node.at[3] >= frame.size[1] * 0.4
    }

    function hoistGhostWrappers(nodesToHoist: StyleAreaTreeNode[]): StyleAreaTreeNode[] {
      const out: StyleAreaTreeNode[] = []
      for (const node of nodesToHoist) {
        node.children = hoistGhostWrappers(node.children)
        if (isGhostWrapper(node)) {
          for (const child of node.children) out.push(child)
          continue
        }
        out.push(node)
      }
      return out
    }

    function pruneInvisibleLeafNodes(nodesToPrune: StyleAreaTreeNode[]): StyleAreaTreeNode[] {
      const frameArea = frame.size[0] * frame.size[1]
      const out: StyleAreaTreeNode[] = []

      for (const node of nodesToPrune) {
        node.children = pruneInvisibleLeafNodes(node.children)

        const hasTexts = node.texts.length > 0
        const hasOverrides = (node.overrides?.length ?? 0) > 0
        const hasVisualStyle = Boolean(node.bg) || node.radius != null || Boolean(node.shadow)
        const explicitlyTransparent = node.opacity != null && node.opacity <= 0.01
        const isLeaf = node.children.length === 0
        const nodeArea = node.at[2] * node.at[3]
        const areaRatio = frameArea > 0 ? nodeArea / frameArea : 0
        const isLargeGhostLeaf =
          isLeaf &&
          !hasTexts &&
          !hasOverrides &&
          !hasVisualStyle &&
          (areaRatio >= 0.03 || node.at[2] >= frame.size[0] * 0.25 || node.at[3] >= frame.size[1] * 0.2)

        if (explicitlyTransparent) continue
        if (isLargeGhostLeaf) continue
        out.push(node)
      }

      return out
    }

    sortTree(roots, 0)
    const hoistedRoots = hoistGhostWrappers(roots)
    const prunedRoots = pruneInvisibleLeafNodes(hoistedRoots)
    sortTree(prunedRoots, 0)

    /**
     * 后处理：为 isFromSwapParent / isSwap 的节点记录最近的非 swap 祖先 area id（relAnchorId）。
     * 历史用途：当 swap 节点 at/rel 不可信时，下游用锚点 + layout 重排兜底。
     * 现在 at/rel 已合并所有 override + INSTANCE size 覆盖 + constraint 重排，可直接信任，
     * 此字段仅作元信息保留——便于人工 review 时溯源 swap 子树的非 swap 祖先。
     */
    function fillRelAnchorIds(nodes: StyleAreaTreeNode[], trustedAnchorId: string | null): void {
      for (const node of nodes) {
        const isTrusted = !node.isFromSwapParent && !node.isSwap
        if (node.isFromSwapParent || node.isSwap) {
          node.relAnchorId = trustedAnchorId ?? undefined
        }
        const nextAnchorId = isTrusted ? node.id : trustedAnchorId
        fillRelAnchorIds(node.children, nextAnchorId)
      }
    }
    fillRelAnchorIds(prunedRoots, null)

    const orphanTexts = frame.texts.filter((_, textIndex) => !ownership.assignedTextIndexes.has(textIndex))
    return {
      index: frame.index,
      name: frame.name,
      group: frame.group,
      size: frame.size,
      roots: prunedRoots,
      orphanTexts,
    }
  })
}

export function dedupeStyleContextByContent(style: StyleContextOutput): StyleContentDedupOutput {
  const frameTrees = buildFrameElementTrees(style)

  return {
    documentName: style.documentName,
    pageName: style.pageName,
    section: style.section,
    frameTrees,
  }
}

export function extractStyleContextDedupByContent(
  buffer: ArrayBuffer,
  options: {
    version?: string
    sectionName?: string
    subModuleName?: string
    maxDepth?: number
    parseOptions?: Partial<ParseFigOptions>
  } = {}
): StyleContentDedupOutput {
  const raw = extractStyleContext(buffer, options)
  return dedupeStyleContextByContent(raw)
}

// Node.js CLI 入口和 extractFigImagesToDir 已移至 sdk/node.ts
