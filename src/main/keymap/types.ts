import { KeyMapping } from '../../common/types/mapping'
import { ModifierKey } from '../../common/types/keys'

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
  injectCombo(modifiers: ModifierKey[], keyCode: string, preservedModifiers?: ModifierKey[]): void
}

export { MACOS_KEY_CODES, REVERSE_KEY_CODES } from '../../common/types/keys'
