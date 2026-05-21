/**
 * overrides-cleaner.ts — Figma JSON Overrides 清洗模块
 * ═══════════════════════════════════════════════════════════════
 *
 * 功能：将非 swap 容器上的 overrides 下沉到最底层的 text 节点
 *
 * 核心规则：
 * 1. 后代 overrides 优先匹配祖先 overrides（后代优先于祖先自身）
 * 2. 一旦匹配成功，使用该 override 一路下沉到最深层
 * 3. 多个 overrides 按顺序分配给多个子节点
 * 4. 不匹配时输出报告告知用户
 *
 * 示例：
 *   原始: nav(overrides:["课程目标","设置","标准语速","讲错了"])
 *         -> 按钮-左图标(overrides:["讲错了"]) -> ... -> 内容(texts:["功能"])
 *   清洗: 后代"讲错了"匹配祖先列表 -> 内容(texts:["讲错了"])
 */

export interface CleanReport {
  matched: string[]
  unmatched: UnmatchedItem[]
  distributed: DistributedItem[]
}

export interface UnmatchedItem {
  nodeName: string
  nodePath: string
  overrides: string[]
  ancestorOverrides: string[]
  reason: string
}

export interface DistributedItem {
  parentName: string
  parentPath: string
  overrides: string[]
  childrenCount: number
  distribution: { index: number; childName: string; override: string }[]
}

interface StyleNode {
  name: string
  at?: number[]
  texts?: { t: string; [key: string]: any }[]
  overrides?: string[]
  children?: StyleNode[]
  [key: string]: any
}

interface FrameTree {
  index: number
  name: string
  group?: string
  size: number[]
  roots: StyleNode[]
  orphanTexts?: any[]
}

interface StyleContext {
  documentName: string
  pageName: string
  section: string
  frameTrees: FrameTree[]
}

/**
 * 查找 overrides 在祖先列表中的匹配
 */
function findMatchingOverride(
  nodeOverrides: string[],
  ancestorOverrides: string[]
): { override: string; index: number } | null {
  if (!nodeOverrides?.length || !ancestorOverrides?.length) return null

  for (const override of nodeOverrides) {
    const idx = ancestorOverrides.indexOf(override)
    if (idx !== -1) {
      return { override, index: idx }
    }
  }
  return null
}

/**
 * 在子树中查找最佳匹配（后代优先）
 */
function findBestMatchInSubtree(
  node: StyleNode,
  ancestorOverrides: string[],
  includeSelf = true
): { node: StyleNode; match: { override: string; index: number } } | null {
  // 首先递归检查 children（后代优先）
  if (node.children) {
    for (const child of node.children) {
      const found = findBestMatchInSubtree(child, ancestorOverrides, true)
      if (found) return found
    }
  }

  // 然后检查当前节点
  if (includeSelf && node.overrides) {
    const match = findMatchingOverride(node.overrides, ancestorOverrides)
    if (match) {
      return { node, match }
    }
  }

  return null
}

/**
 * 将 effective override 从当前节点向下传播
 */
function propagateFromNode(
  node: StyleNode,
  effectiveOverride: string,
  depth = 0,
  report: CleanReport
): boolean {
  let modified = false

  // 清理当前节点的 overrides
  if (node.overrides) {
    delete node.overrides
    modified = true
  }

  const children = node.children

  if (children?.length) {
    // 检查是否有 child 有 texts（优先处理）
    const textChild = children.find(
      (c) => c.texts && c.texts.length > 0
    )

    if (textChild) {
      // 替换 texts[0]
      const oldText = textChild.texts![0].t
      if (oldText !== effectiveOverride) {
        textChild.texts![0].t = effectiveOverride
        modified = true
      }

      // 处理其他 children（不传 effectiveOverride）
      children.forEach((child) => {
        if (child !== textChild) {
          cleanNodeInternal(child, null, depth + 1, report)
        }
      })
    } else {
      // 没有 texts child，传给所有 children
      children.forEach((child) => {
        // 先清理 child 的 overrides
        if (child.overrides) {
          delete child.overrides
          modified = true
        }
        // 继续传播
        if (propagateFromNode(child, effectiveOverride, depth + 1, report)) {
          modified = true
        }
      })
    }
  } else {
    // 最深层节点，创建或更新 texts
    if (!node.texts) {
      node.texts = []
    }

    if (node.texts.length > 0) {
      const oldText = node.texts[0].t
      if (oldText !== effectiveOverride) {
        node.texts[0].t = effectiveOverride
        modified = true
      }
    } else {
      node.texts.push({
        t: effectiveOverride,
        at: node.at || [0, 0, 100, 30],
      })
      modified = true
    }
  }

  return modified
}

/**
 * 按索引分配多个 overrides 给多个 children
 */
function distributeOverridesToChildren(
  node: StyleNode,
  overrides: string[],
  report: CleanReport
): boolean {
  const children = node.children
  if (!children?.length || !overrides.length) return false

  const distribution: DistributedItem['distribution'] = []
  let modified = false

  // 分配逻辑：overrides[i] 分配给 children[i]
  for (let i = 0; i < Math.min(overrides.length, children.length); i++) {
    const child = children[i]
    const override = overrides[i]

    // 清理 child 原有的 overrides
    if (child.overrides) {
      delete child.overrides
      modified = true
    }

    // 传播给这个 child
    if (propagateFromNode(child, override, 1, report)) {
      modified = true
    }

    distribution.push({
      index: i,
      childName: child.name,
      override,
    })
  }

  // 报告分配情况
  report.distributed.push({
    parentName: node.name,
    parentPath: '', // 简化处理，实际需要构建路径
    overrides,
    childrenCount: children.length,
    distribution,
  })

  // 处理剩余的 children（没有对应 override 的）
  for (let i = overrides.length; i < children.length; i++) {
    cleanNodeInternal(children[i], null, 1, report)
  }

  // 记录未匹配的 overrides
  if (overrides.length > children.length) {
    for (let i = children.length; i < overrides.length; i++) {
      report.unmatched.push({
        nodeName: node.name,
        nodePath: '', // 简化处理
        overrides: [overrides[i]],
        ancestorOverrides: overrides,
        reason: `override[${i}]"${overrides[i]}"没有对应的子节点(children只有${children.length}个)`,
      })
    }
  }

  return modified
}

/**
 * 内部递归清洗节点
 */
function cleanNodeInternal(
  node: StyleNode,
  ancestorOverrides: string[] | null,
  depth = 0,
  report: CleanReport
): boolean {
  let modified = false

  const currentOverrides = node.overrides

  if (currentOverrides?.length) {
    // 当前节点有 overrides

    if (ancestorOverrides?.length) {
      // 尝试在祖先 overrides 中匹配
      const match = findMatchingOverride(currentOverrides, ancestorOverrides)

      if (match) {
        // 匹配成功，使用匹配的 override
        report.matched.push(
          `[${node.name}] overrides["${match.override}"]匹配祖先列表索引${match.index}`
        )

        // 清理 overrides 并传播
        delete node.overrides
        modified = true

        // 继续传播这个 override 到后代
        if (propagateFromNode(node, match.override, depth, report)) {
          modified = true
        }
      } else {
        // 不匹配祖先，检查是否有多个 overrides 需要分配给 children
        const childrenLength = node.children?.length ?? 0
        if (currentOverrides.length > 1 && childrenLength > 1) {
          // 多 overrides 分配给多 children
          report.matched.push(
            `[${node.name}] ${currentOverrides.length}个overrides分配给${childrenLength}个children`
          )

          delete node.overrides
          modified = true

          if (distributeOverridesToChildren(node, currentOverrides, report)) {
            modified = true
          }
        } else {
          // 不匹配，使用第一个并报告
          report.unmatched.push({
            nodeName: node.name,
            nodePath: '',
            overrides: currentOverrides,
            ancestorOverrides,
            reason: `overrides[${currentOverrides.join(',')}]不匹配祖先overrides[${ancestorOverrides.join(',')}])`,
          })

          // 还是不匹配时使用第一个 override
          delete node.overrides
          modified = true

          if (propagateFromNode(node, currentOverrides[0], depth, report)) {
            modified = true
          }
        }
      }
    } else {
      // 没有祖先 overrides，这是新的顶层
      // 检查是否有多个 overrides 需要分配给 children
      const childrenLength = node.children?.length ?? 0
      if (currentOverrides.length > 1 && childrenLength > 1) {
        // 多 overrides 分配给多 children
        report.matched.push(
          `[${node.name}] ${currentOverrides.length}个overrides分配给${childrenLength}个children`
        )

        delete node.overrides
        modified = true

        if (distributeOverridesToChildren(node, currentOverrides, report)) {
          modified = true
        }
      } else {
        // 单一 override，正常传播
        const best = findBestMatchInSubtree(node, currentOverrides, true)

        if (best) {
          report.matched.push(
            `[${node.name}] 最佳匹配后代"${best.match.override}"(索引${best.match.index})`
          )

          delete node.overrides
          modified = true

          // 从最佳匹配节点开始传播
          if (propagateFromNode(best.node, best.match.override, depth, report)) {
            modified = true
          }
        } else {
          // 没有匹配，使用第一个
          delete node.overrides
          modified = true

          if (propagateFromNode(node, currentOverrides[0], depth, report)) {
            modified = true
          }
        }
      }
    }
  } else if (ancestorOverrides?.length) {
    // 当前没有 overrides，但继承自祖先
    // 尝试在子树中找到最佳匹配
    const best = findBestMatchInSubtree(node, ancestorOverrides, false)

    if (best) {
      // 在后代中找到匹配
      report.matched.push(
        `[${node.name}] 后代"${best.node.name}"匹配祖先"${best.match.override}"`
      )

      if (propagateFromNode(best.node, best.match.override, depth, report)) {
        modified = true
      }
    }
    // 否则不处理，继续处理 children

    // 继续处理 children
    node.children?.forEach((child) => {
      if (cleanNodeInternal(child, ancestorOverrides, depth + 1, report)) {
        modified = true
      }
    })
  } else {
    // 没有当前 overrides 也没有祖先 overrides
    // 正常处理 children
    node.children?.forEach((child) => {
      if (cleanNodeInternal(child, null, depth + 1, report)) {
        modified = true
      }
    })
  }

  return modified
}

/**
 * 清洗单个 frame tree
 */
function cleanFrameTree(tree: FrameTree, report: CleanReport): boolean {
  let modified = false
  tree.roots.forEach((root) => {
    if (cleanNodeInternal(root, null, 0, report)) {
      modified = true
    }
  })
  return modified
}

/**
 * 清洗 Style Context JSON
 *
 * @param context 从 fig-to-prd.ts 提取的样式上下文
 * @returns 清洗后的上下文 + 报告
 */
export function cleanOverridesInStyleContext(
  context: StyleContext
): { context: StyleContext; report: CleanReport } {
  const report: CleanReport = {
    matched: [],
    unmatched: [],
    distributed: [],
  }

  // 深拷贝避免修改原数据
  const cleanedContext = JSON.parse(JSON.stringify(context)) as StyleContext

  // 处理每个 frame tree
  cleanedContext.frameTrees.forEach((tree) => {
    cleanFrameTree(tree, report)
  })

  return { context: cleanedContext, report }
}

/**
 * 格式化清洗报告为可读文本
 */
export function formatCleanReport(report: CleanReport): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════')
  lines.push('Overrides 清洗报告')
  lines.push('═══════════════════════════════════════════════')
  lines.push('')

  // 匹配成功
  if (report.matched.length > 0) {
    lines.push(`✅ 匹配成功 (${report.matched.length}项):`)
    report.matched.forEach((item) => lines.push(`  ${item}`))
    lines.push('')
  }

  // 分配情况
  if (report.distributed.length > 0) {
    lines.push(`📊 Overrides 分配 (${report.distributed.length}处):`)
    report.distributed.forEach((item) => {
      lines.push(`  [${item.parentName}] ${item.overrides.length}个 → ${item.childrenCount}个子节点:`)
      item.distribution.forEach((d) => {
        lines.push(`    [${d.index}] ${d.childName}: "${d.override}"`)
      })
    })
    lines.push('')
  }

  // 未匹配警告
  if (report.unmatched.length > 0) {
    lines.push(`⚠️ 未匹配警告 (${report.unmatched.length}项，请检查):`)
    report.unmatched.forEach((item) => {
      lines.push(`  [${item.nodeName}]`)
      lines.push(`    overrides: [${item.overrides.join(', ')}]`)
      lines.push(`    原因: ${item.reason}`)
    })
    lines.push('')
  }

  lines.push('═══════════════════════════════════════════════')

  return lines.join('\n')
}
