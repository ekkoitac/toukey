import { KeyMapping } from '../../common/types/mapping'

/**
 * 映射引擎接口
 */
export interface IKeymapEngine {
  /** 初始化引擎 */
  initialize(): Promise<void>
  
  /** 加载映射规则 */
  loadRules(rules: KeyMapping[]): void
  
  /** 释放资源 */
  dispose(): void
}

/**
 * 原生模块接口定义
 * 这些类型由原生模块提供
 */

export interface TouchpadMonitor {
  start(): void
  stop(): void
  on(event: 'touch', callback: (e: any) => void): void
  removeListener(event: 'touch', callback: Function): void
}

export interface KeyInterceptor {
  start(): boolean
  stop(): void
  on(event: 'keydown' | 'keyup', callback: (e: any) => void): void
  setInterceptFilter(filter: (e: any) => boolean): void
}

export interface KeyInjector {
  injectKey(keyCode: string): void
}

/**
 * macOS 虚拟键码映射表
 */
export const MACOS_KEY_CODES: Record<string, number> = {
  // 字母键
  'a': 0x00, 'b': 0x0B, 'c': 0x08, 'd': 0x02, 'e': 0x0E,
  'f': 0x03, 'g': 0x05, 'h': 0x04, 'i': 0x22, 'j': 0x26,
  'k': 0x28, 'l': 0x25, 'm': 0x2E, 'n': 0x2D, 'o': 0x1F,
  'p': 0x23, 'q': 0x0C, 'r': 0x0F, 's': 0x01, 't': 0x11,
  'u': 0x20, 'v': 0x09, 'w': 0x0D, 'x': 0x07, 'y': 0x10,
  'z': 0x06,
  
  // 方向键
  'up': 0x7E,
  'down': 0x7D,
  'left': 0x7B,
  'right': 0x7C,
  
  // 功能键
  'home': 0x73,
  'end': 0x77,
  'pageup': 0x74,
  'pagedown': 0x79,
  
  // 其他常用键
  'escape': 0x35,
  'space': 0x31,
  'return': 0x24,
  'tab': 0x30,
  'delete': 0x33,
  'forwarddelete': 0x75
}

/**
 * 键码到字符的反向映射
 */
export const REVERSE_KEY_CODES: Record<number, string> = Object.fromEntries(
  Object.entries(MACOS_KEY_CODES).map(([k, v]) => [v, k])
)
