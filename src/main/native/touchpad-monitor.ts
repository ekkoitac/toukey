/**
 * TouchpadMonitor 模块封装
 * 加载原生 N-API 模块
 */

import path from 'path'

// 尝试加载原生模块
let nativeModule: any

try {
  // 开发环境：从 build/Release 加载
  // 生产环境：从打包后的位置加载
  const nativePath = path.join(__dirname, '../../../native/build/Release/touchpad.node')
  nativeModule = require(nativePath)
} catch (error) {
  console.warn('Failed to load native touchpad module:', error)
  // 提供降级实现（用于开发和测试）
  nativeModule = null
}

/**
 * 触摸板事件
 */
export interface TouchpadEvent {
  type: 'touch-start' | 'touch-end'
  timestamp: number
  fingerCount: number
}

/**
 * TouchpadMonitor 类
 * 封装原生触摸板监控功能
 */
export class TouchpadMonitor {
  private native: any
  private listeners: Map<string, Set<Function>> = new Map()

  constructor() {
    if (nativeModule && nativeModule.TouchpadMonitor) {
      this.native = new nativeModule.TouchpadMonitor()
    } else {
      // 降级实现：使用模拟数据（仅用于开发测试）
      console.warn('Using fallback TouchpadMonitor implementation')
    }
  }

  /**
   * 开始监听触摸板事件
   */
  start(): void {
    if (this.native) {
      this.native.start()
    }
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.native) {
      this.native.stop()
    }
  }

  /**
   * 注册事件监听
   */
  on(event: string, callback: (e: TouchpadEvent) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)

    // 如果是原生模块，转发到原生事件
    if (this.native && event === 'touch') {
      this.native.on(event, callback)
    }
  }

  /**
   * 移除事件监听
   */
  removeListener(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback)
    
    if (this.native) {
      this.native.removeListener(event, callback)
    }
  }
}

// 导出原生模块类型定义（供 TypeScript 使用）
export default TouchpadMonitor
