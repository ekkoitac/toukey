/**
 * KeyInterceptor 模块封装
 * 加载原生 N-API 模块（CGEventTap 封装）
 */

import path from 'path'

// 尝试加载原生模块
let nativeModule: any

try {
  const nativePath = path.join(__dirname, '../../src/native/build/Release/keyinterceptor.node')
  nativeModule = require(nativePath)
} catch (error) {
  console.warn('Failed to load native key interceptor module:', error)
  nativeModule = null
}

/**
 * 键盘事件
 */
export interface KeyEvent {
  keyCode: number
  keyChar: string
  isDown: boolean
  timestamp: number
}

/**
 * 拦截过滤器类型
 */
export type InterceptFilter = (event: KeyEvent) => boolean

/**
 * KeyInterceptor 类
 * 封装原生按键拦截功能（CGEventTap）
 */
export class KeyInterceptor {
  private native: any
  private filterCallback: InterceptFilter | null = null

  constructor() {
    if (nativeModule && nativeModule.KeyInterceptor) {
      this.native = new nativeModule.KeyInterceptor()
    } else {
      console.warn('Using fallback KeyInterceptor implementation')
    }
  }

  /**
   * 开始拦截按键
   * @returns 是否成功（需要 Accessibility 权限）
   */
  start(): boolean {
    if (this.native) {
      return this.native.start()
    }
    return false
  }

  /**
   * 停止拦截
   */
  stop(): void {
    if (this.native) {
      this.native.stop()
    }
  }

  /**
   * 注册事件监听
   */
  on(event: 'keydown' | 'keyup', callback: (e: KeyEvent) => void): void {
    if (this.native) {
      this.native.on(event, callback)
    }
  }

  /**
   * 设置拦截过滤器（保留兼容；实际拦截由 updateInterceptState 驱动）
   */
  setInterceptFilter(filter: InterceptFilter): void {
    this.filterCallback = filter

    if (this.native) {
      this.native.setInterceptFilter(filter)
    }
  }

  /**
   * 同步拦截状态到原生层（layer2 激活 + 映射键码列表）
   */
  updateInterceptState(active: boolean, keyCodes: number[]): void {
    if (this.native?.updateInterceptState) {
      this.native.updateInterceptState(active, keyCodes)
    }
  }
}

export default KeyInterceptor
