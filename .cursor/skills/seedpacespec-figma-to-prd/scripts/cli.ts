#!/usr/bin/env node
/**
 * seedpacespec-figma-to-prd CLI
 *
 * 命令行工具：将 .fig 文件逆向解析为 PRD JSON
 * 与 fig-prd-exporter SDK 输出完全一致
 *
 * 用法：
 *   npx tsx cli.ts <fig-file> [version] [options]
 *
 * 选项：
 *   --output, -o    输出文件路径（默认：stdout）
 *   --prune, -p     精简数据（移除冗余字段）
 *   --list-images   列出 .fig 内嵌图片
 *   --extract-images=<dir>  提取图片到目录
 *   --help, -h      显示帮助
 *
 * 示例：
 *   npx tsx cli.ts design.fig
 *   npx tsx cli.ts design.fig "1.0.7" -o output.json
 *   npx tsx cli.ts design.fig -o output.json -p
 *   npx tsx cli.ts design.fig --list-images
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  generatePrdFromFig,
  listPageVersions,
  extractFigImages,
  pruneForDify,
  listFigImages,
  parseFigFile,
} from './index'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`
seedpacespec-figma-to-prd CLI

用法: npx tsx cli.ts <fig-file> [version] [options]

选项:
  --output, -o <file>          输出 JSON 文件路径（默认输出到 stdout）
  --prune, -p                  精简数据（移除冗余字段，适合 AI 处理）
  --list-images                列出 .fig 内嵌图片
  --extract-images=<dir>       提取图片到指定目录
  --help, -h                   显示帮助

示例:
  npx tsx cli.ts design.fig
  npx tsx cli.ts design.fig "1.0.7"
  npx tsx cli.ts design.fig "1.0.7" -o output.json
  npx tsx cli.ts design.fig -p > prd-pruned.json
  npx tsx cli.ts design.fig --list-images
  npx tsx cli.ts design.fig --extract-images=./fig-images
`)
  process.exit(0)
}

const listImagesFlag = args.indexOf('--list-images')
const extractIdx = args.findIndex((a) => a.startsWith('--extract-images='))
const extractToDir = extractIdx !== -1 ? args[extractIdx].slice('--extract-images='.length) : null
const outputIndex = args.findIndex(a => a === '--output' || a === '-o')
const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null
const shouldPrune = args.includes('--prune') || args.includes('-p')

const positionalArgs = args.filter(
  a => !a.startsWith('--') && !a.startsWith('-') &&
       a !== args[outputIndex + 1]
)
const figFile = positionalArgs[0]
const versionArg = positionalArgs[1]

if (!figFile) {
  console.error('Error: No .fig file specified')
  process.exit(1)
}

if (!fs.existsSync(figFile)) {
  console.error(`Error: File not found: ${figFile}`)
  process.exit(1)
}

function readFigBuffer(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

async function main() {
  try {
    const buffer = readFigBuffer(figFile)

    if (listImagesFlag !== -1 || extractToDir) {
      if (extractToDir) {
        const images = extractFigImages(buffer)
        if (images.size === 0) {
          console.log('images 文件夹为空或该 .fig 为纯二进制格式，未提取任何文件')
        } else {
          const outDir = path.resolve(process.cwd(), extractToDir)
          fs.mkdirSync(outDir, { recursive: true })
          for (const [key, bytes] of images) {
            const fileName = key.includes('.') ? key : `${key}.png`
            const filePath = path.resolve(outDir, fileName)
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
            fs.writeFileSync(filePath, new Uint8Array(bytes))
            console.log('  ', fileName, ` ${(bytes.length / 1024).toFixed(1)} KB`)
          }
          console.log('已提取', images.size, '个文件到', outDir)
        }
      } else {
        const list = listFigImages(buffer)
        if (list.length === 0) {
          console.log('images 文件夹为空或该 .fig 为纯二进制格式（无 ZIP 内 images/）')
        } else {
          console.log('images 文件夹共', list.length, '项：')
          list.forEach(({ key, size }) => console.log(`  ${key}  ${(size / 1024).toFixed(1)} KB`))
        }
      }
      return
    }

    console.error(`Parsing ${figFile}...`)

    const baseName = path.basename(figFile, '.fig')
    const versionSuffix = versionArg ? `-${versionArg.replace(/\./g, '_')}` : ''

    let prd = generatePrdFromFig(buffer, {
      version: versionArg,
      baseName,
    })
    console.error(`✓ Generated PRD: ${prd.sections.length} sections`)

    if (shouldPrune) {
      prd = pruneForDify(prd) as typeof prd
      console.error('✓ Pruned data for AI processing')
    }

    const json = JSON.stringify(prd, null, 2)
    const defaultOutPath = path.resolve(process.cwd(), `${baseName}${versionSuffix}.prd.json`)

    if (outputFile) {
      fs.writeFileSync(outputFile, json)
      console.error(`✓ Saved to ${outputFile}`)
    } else {
      fs.writeFileSync(defaultOutPath, json)
      console.error(`✓ Saved to ${defaultOutPath}`)
    }

    console.error('\n--- Summary ---')
    console.error(`Document: ${prd.documentName}`)
    console.error(`Version filter: ${prd.versionFilter ?? '(none)'}`)
    console.error(`Page: ${prd.pageName}`)
    console.error(`Sections: ${prd.sections.length}`)
    const rootElements = prd.sections.reduce(
      (sum: number, s: { elements: unknown[] }) => sum + s.elements.length, 0
    )
    console.error(`Root elements: ${rootElements}`)

  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }
}

main()
