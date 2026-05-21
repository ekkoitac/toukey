/**
 * .fig 文件解析核心逻辑
 * 从 fig-prd-exporter/sdk/lib/fig-parser.ts 提取
 *
 * 支持：
 * 1. ZIP 格式的 .fig 文件（解压后解析 canvas.fig）
 * 2. 纯二进制 Kiwi 格式（fig-kiwi 头）
 * 3. Zstd 和 deflate 压缩算法
 */

import { ByteBuffer, compileSchema, decodeBinarySchema, type Schema } from 'kiwi-schema'
import * as UZIPModule from 'uzip'
import { decompress as zstdDecompress } from 'fzstd'
import type { FigmaDecodedFile, ParseFigOptions, FigmaNodeChange } from './types'

// UZIP 兼容性处理
const UZIP = (typeof (UZIPModule as any).default === 'object' && (UZIPModule as any).default !== null)
  ? (UZIPModule as { default: { parse: (b: ArrayBuffer) => Record<string, Uint8Array>; inflateRaw: (b: Uint8Array) => Uint8Array } }).default
  : (UZIPModule as { parse: (b: ArrayBuffer) => Record<string, Uint8Array>; inflateRaw: (b: Uint8Array) => Uint8Array })

// 魔法数字常量
const FIG_KIWI_MAGIC = [102, 105, 103, 45, 107, 105, 119, 105] // "fig-kiwi"
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const PNG_MAGIC_0 = 137
const PNG_MAGIC_1 = 80

// 默认限制：放开到 JS 安全数上限（实际由可用内存决定）
// 处理超大 .fig（数百 MB ~ GB）时不再硬性截断；
// 调用方仍可通过 ParseFigOptions 显式收紧上限。
const DEFAULT_MAX_COMPRESSED = Number.MAX_SAFE_INTEGER
const DEFAULT_MAX_UNZIPPED = Number.MAX_SAFE_INTEGER
const DEFAULT_MAX_IMAGE = Number.MAX_SAFE_INTEGER
const MAX_ZIP_ENTRIES = 1_000_000

// 32 位整数读写辅助
const int32 = new Int32Array(1)
const uint8 = new Uint8Array(int32.buffer)
const uint32 = new Uint32Array(int32.buffer)

function transfer8to32(fileByte: Uint8Array, start: number): void {
  uint8[0] = fileByte[start]
  uint8[1] = fileByte[start + 1]
  uint8[2] = fileByte[start + 2]
  uint8[3] = fileByte[start + 3]
}

function readUint32(fileByte: Uint8Array, start: number): number {
  transfer8to32(fileByte, start)
  return uint32[0]
}

/** 检查是否有 fig-kiwi 魔法头 */
function hasFigKiwiMagic(bytes: Uint8Array): boolean {
  for (let i = 0; i < FIG_KIWI_MAGIC.length; i++) {
    if (bytes[i] !== FIG_KIWI_MAGIC[i]) return false
  }
  return true
}

/** 检查是否是 Zstd 压缩 */
function isZstd(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === ZSTD_MAGIC[0] && bytes[1] === ZSTD_MAGIC[1] && bytes[2] === ZSTD_MAGIC[2] && bytes[3] === ZSTD_MAGIC[3]
}

/** 检查是否是 PNG */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === PNG_MAGIC_0 && bytes[1] === PNG_MAGIC_1
}

/** 解压单个 chunk */
function decompressChunk(bytes: Uint8Array): Uint8Array {
  if (isPng(bytes)) return bytes
  if (isZstd(bytes)) return zstdDecompress(bytes)
  try {
    return UZIP.inflateRaw(bytes) as Uint8Array
  } catch {
    try {
      return zstdDecompress(bytes)
    } catch {
      return bytes
    }
  }
}

interface FigBinaryResult {
  parts: Uint8Array[]
  imageFiles: Map<string, Uint8Array>
}

/**
 * 将 .fig 文件转换为二进制分块
 * 处理 ZIP 解压、Kiwi 格式解析
 */
function figToBinaryParts(fileBuffer: ArrayBuffer, limits?: ParseFigOptions): FigBinaryResult {
  const maxCompressed = limits?.maxCompressedSize ?? DEFAULT_MAX_COMPRESSED
  const maxUnzipped = limits?.maxUnzippedSize ?? DEFAULT_MAX_UNZIPPED
  const maxImage = limits?.maxImageSize ?? DEFAULT_MAX_IMAGE

  let fileByte = new Uint8Array(fileBuffer)
  const imageFiles = new Map<string, Uint8Array>()

  // 如果没有 fig-kiwi 头，尝试 ZIP 解压
  if (!hasFigKiwiMagic(fileByte)) {
    if (fileBuffer.byteLength > maxCompressed) {
      throw new Error(`Compressed .fig file exceeds maximum size limit (${Math.round(maxCompressed / (1024 * 1024))}MB)`)
    }
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = UZIP.parse(fileBuffer)
    } catch (e) {
      throw new Error(`Invalid .fig file: could not unzip (${e instanceof Error ? e.message : 'unknown error'})`)
    }
    if (Object.keys(unzipped).length > MAX_ZIP_ENTRIES) {
      throw new Error(`ZIP archive contains too many entries`)
    }
    let totalSize = 0
    for (const [path, bytes] of Object.entries(unzipped)) {
      totalSize += bytes.length
      if (totalSize > maxUnzipped) throw new Error(`Decompressed file exceeds maximum size limit`)
      if (path.startsWith('images/') && bytes.length > 0) {
        if (bytes.length > maxImage) throw new Error(`Image exceeds maximum size limit`)
        imageFiles.set(path.slice(7), bytes)
      }
    }
    const canvasFile = unzipped['canvas.fig']
    if (!canvasFile) throw new Error('Invalid .fig file: no canvas.fig found in archive')
    fileBuffer = canvasFile.buffer as ArrayBuffer
    fileByte = new Uint8Array(fileBuffer)
  }

  if (!hasFigKiwiMagic(fileByte)) throw new Error('Invalid .fig file: missing fig-kiwi header after extraction')

  // 读取分块数据
  let start = 12
  const parts: Uint8Array[] = []
  while (start < fileByte.length) {
    const chunkSize = readUint32(fileByte, start)
    start += 4
    if (chunkSize === 0 || start + chunkSize > fileByte.length) break
    const rawChunk = fileByte.slice(start, start + chunkSize)
    parts.push(decompressChunk(rawChunk))
    start += chunkSize
  }
  return { parts, imageFiles }
}

/** 在 schema helper 中查找 decoder 方法 */
function findDecoder(schemaHelper: Record<string, unknown>): (bb: unknown) => unknown {
  if (typeof schemaHelper.decodeMessage === 'function') return (schemaHelper.decodeMessage as (bb: unknown) => unknown).bind(schemaHelper)
  for (const key of Object.keys(schemaHelper)) {
    if (key.startsWith('decode') && typeof (schemaHelper as Record<string, unknown>)[key] === 'function') {
      return ((schemaHelper as Record<string, unknown>)[key] as (bb: unknown) => unknown).bind(schemaHelper)
    }
  }
  throw new Error('No decode method found in schema')
}

/** 提取 blobs */
function extractBlobs(raw: { blobs?: unknown[] }): (Uint8Array | string)[] {
  const blobs: (Uint8Array | string)[] = []
  if (!raw.blobs) return blobs
  for (const blob of raw.blobs) {
    if (blob && typeof blob === 'object' && 'bytes' in blob && blob.bytes instanceof Uint8Array) {
      blobs.push(blob.bytes)
    } else if (typeof blob === 'string') {
      blobs.push(blob)
    } else {
      blobs.push(new Uint8Array(0))
    }
  }
  return blobs
}

/**
 * 解析 .fig 文件，返回解码后的数据结构
 */
export function parseFigFile(fileBuffer: ArrayBuffer, options?: ParseFigOptions): FigmaDecodedFile {
  const { parts, imageFiles } = figToBinaryParts(fileBuffer, options)
  if (parts.length < 2) throw new Error(`Invalid .fig file: expected at least 2 binary parts, got ${parts.length}`)

  const [schemaByte, dataByte] = parts
  let schema: unknown
  try {
    schema = decodeBinarySchema(new ByteBuffer(schemaByte))
  } catch (e) {
    throw new Error(`Failed to decode .fig schema: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  let schemaHelper: Record<string, unknown>
  try {
    schemaHelper = compileSchema(schema as Schema) as Record<string, unknown>
  } catch (e) {
    throw new Error(`Failed to compile .fig schema: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  const decoder = findDecoder(schemaHelper)
  let raw: { nodeChanges?: unknown[]; blobs?: unknown[]; [k: string]: unknown }
  try {
    raw = decoder(new ByteBuffer(dataByte)) as typeof raw
  } catch (e) {
    throw new Error(`Failed to decode .fig data: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  if (!raw || typeof raw !== 'object') throw new Error('Decoded .fig data is empty or invalid')

  const nodeChanges = raw.nodeChanges ?? []
  if (nodeChanges.length === 0) {
    // 尝试从其他字段找到节点数据
    for (const key of Object.keys(raw)) {
      if (Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0 && (raw[key] as { guid?: unknown }[])[0]?.guid) {
        return { nodeChanges: raw[key] as FigmaNodeChange[], blobs: extractBlobs(raw), imageFiles }
      }
    }
  }
  return { nodeChanges, blobs: extractBlobs(raw), imageFiles }
}

/**
 * 列出 .fig 文件中的图片资源
 */
export function listFigImages(
  fileBuffer: ArrayBuffer,
  limits?: ParseFigOptions
): { key: string; size: number }[] {
  const { imageFiles } = figToBinaryParts(fileBuffer, limits)
  return Array.from(imageFiles.entries(), ([key, bytes]) => ({ key, size: bytes.length }))
}

