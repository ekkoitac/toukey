/**
 * Figma 树结构构建器
 * 从 fig-prd-exporter/sdk/lib/figma-tree-builder.ts 提取
 *
 * 将扁平的 nodeChanges 构建为树形结构
 */

import type { FigmaNodeChange, FigmaGUID, TreeNode } from './types'

/**
 * 将 GUID 转换为字符串
 */
export function guidToString(guid: FigmaGUID): string {
  return `${guid.sessionID}:${guid.localID}`
}

/**
 * 检查是否是用户页面（排除 Internal Only 页面）
 */
export function isUserPage(node: TreeNode): boolean {
  return node.figma.type === 'CANVAS' && !/^Internal\s+Only/i.test(node.figma.name ?? '')
}

/**
 * 构建树形结构
 */
export function buildTree(nodeChanges: FigmaNodeChange[]): TreeNode | null {
  const nodeMap = new Map<string, TreeNode>()
  let root: TreeNode | null = null

  // 第一遍：创建所有节点
  for (const nc of nodeChanges) {
    if (!nc.guid) continue
    if (nc.phase === 'REMOVED') continue
    const key = guidToString(nc.guid)
    nodeMap.set(key, { figma: nc, children: [] })
  }

  // 第二遍：建立父子关系
  for (const nc of nodeChanges) {
    if (!nc.guid || nc.phase === 'REMOVED') continue
    const key = guidToString(nc.guid)
    const treeNode = nodeMap.get(key)
    if (!treeNode) continue
    if (nc.type === 'DOCUMENT') {
      root = treeNode
      continue
    }
    if (nc.parentIndex?.guid) {
      const parentKey = guidToString(nc.parentIndex.guid)
      const parent = nodeMap.get(parentKey)
      if (parent) parent.children.push(treeNode)
    }
  }

  if (root) sortChildrenRecursive(root)
  return root
}

/**
 * 递归按 position 排序子节点
 */
function sortChildrenRecursive(node: TreeNode): void {
  node.children.sort((a, b) => {
    const posA = a.figma.parentIndex?.position ?? ''
    const posB = b.figma.parentIndex?.position ?? ''
    return posA < posB ? 1 : posA > posB ? -1 : 0
  })
  for (const child of node.children) sortChildrenRecursive(child)
}

/**
 * 收集所有 Symbol 节点到 Map
 */
export function collectSymbolTree(root: TreeNode, map: Map<string, TreeNode>): void {
  if (root.figma.type === 'SYMBOL' && root.figma.guid) {
    map.set(guidToString(root.figma.guid), root)
  }
  for (const child of root.children) collectSymbolTree(child, map)
}

/**
 * 根据 GUID 查找节点
 */
export function findNodeByGuid(root: TreeNode, guid: string): TreeNode | null {
  if (root.figma.guid && guidToString(root.figma.guid) === guid) {
    return root
  }
  for (const child of root.children) {
    const found = findNodeByGuid(child, guid)
    if (found) return found
  }
  return null
}

/**
 * 扁平化遍历整棵树
 */
export function flattenTree(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = [node]
  for (const child of node.children) {
    result.push(...flattenTree(child))
  }
  return result
}
