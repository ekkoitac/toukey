/**
 * KeyInjector 模块封装
 * 加载原生 N-API 模块（CGEventPost 封装）
 */

import path from 'path'
import { MacKey, ModifierKey } from '../../common/types/keys'

// 尝试加载原生模块
let nativeModule: any

try {
  const nativePath = path.join(__dirname, '../../src/native/build/Release/keyinjector.node')
  nativeModule = require(nativePath)
} catch (error) {
  console.warn('Failed to load native key injector module:', error)
  nativeModule = null
}

/**
 * 支持的键码
 */
export type KeyCode = MacKey

/**
 * KeyInjector 类
 * 封装原生按键注入功能（CGEventPost）
 */
export class KeyInjector {
  private native: any

  constructor() {
    if (nativeModule && nativeModule.KeyInjector) {
      this.native = new nativeModule.KeyInjector()
    } else {
      console.warn('Using fallback KeyInjector implementation')
    }
  }

  /**
   * 注入单个按键（按下+释放）
   */
  injectKey(keyCode: KeyCode): void {
    if (this.native) {
      this.native.injectKey(keyCode)
    } else {
      console.log(`[Fallback] Inject key: ${keyCode}`)
    }
  }

  /**
   * 注入组合键（如需要扩展）
   */
  injectCombo(modifiers: ModifierKey[], keyCode: KeyCode, preservedModifiers: ModifierKey[] = []): void {
    if (this.native && this.native.injectCombo) {
      this.native.injectCombo(modifiers, keyCode, preservedModifiers)
    } else {
      const effectiveModifiers = [...new Set([...modifiers, ...preservedModifiers])]
      console.log(`[Fallback] Inject combo: ${effectiveModifiers.join('+')}+${keyCode}`)
    }
  }
}

export default KeyInjector
