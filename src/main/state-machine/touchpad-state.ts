import { LayerState, TouchpadEvent } from '../../common/types/mapping'
import logger from '../utils/logger'

/**
 * 状态机上下文
 */
interface StateContext {
  currentLayer: LayerState
  touchStartTime?: number
}

/**
 * 触摸板状态机
 * 管理 Layer 1（正常）与 Layer 2（自定义层）的状态转换
 */
export class TouchpadStateMachine {
  private state: StateContext
  private listeners: Set<(state: LayerState) => void> = new Set()
  private touchpadMonitor: any = null
  private touchHandler: ((event: TouchpadEvent) => void) | null = null
  private monitoring: boolean = false

  constructor() {
    this.state = { currentLayer: 'layer1' }
  }

  /**
   * 初始化状态机并连接原生触摸板监控
   */
  async initialize(): Promise<void> {
    try {
      // 动态加载原生模块
      const { TouchpadMonitor } = await import('../native/touchpad-monitor')
      this.touchpadMonitor = new TouchpadMonitor()

      // 监听触摸事件
      this.touchHandler = (event: TouchpadEvent) => {
        this.handleTouchEvent(event)
      }
      this.touchpadMonitor.on('touch', this.touchHandler)

      // 开始监听
      this.startMonitoring()
    } catch (error) {
      logger.error('Failed to initialize touchpad monitor:', error)
      throw error
    }
  }

  /**
   * 开始触摸板监听
   */
  startMonitoring(): void {
    if (!this.touchpadMonitor || this.monitoring) {
      return
    }

    this.touchpadMonitor.start()
    this.monitoring = true
    logger.info('Touchpad monitor started')
  }

  /**
   * 停止触摸板监听，并确保状态回到正常层
   */
  stopMonitoring(): void {
    if (!this.touchpadMonitor || !this.monitoring) {
      this.resetToLayer1()
      return
    }

    this.touchpadMonitor.stop()
    this.monitoring = false
    this.resetToLayer1()
    logger.info('Touchpad monitor stopped')
  }

  /**
   * 触摸板监听是否开启
   */
  isMonitoring(): boolean {
    return this.monitoring
  }

  /**
   * 处理触摸事件
   */
  private handleTouchEvent(event: TouchpadEvent): void {
    // 只处理单指触摸
    if (event.fingerCount !== 1 && event.type !== 'touch-end') {
      return
    }

    if (event.type === 'touch-start') {
      this.transition('touch-start')
    } else if (event.type === 'touch-end') {
      this.transition('touch-end')
    }
  }

  /**
   * 状态转换
   */
  transition(event: 'touch-start' | 'touch-end'): void {
    const prevState = this.state.currentLayer

    switch (event) {
      case 'touch-start':
        if (prevState === 'layer1') {
          this.state = {
            currentLayer: 'layer2',
            touchStartTime: Date.now()
          }
          this.emit('layer2')
          logger.info('State transition: layer1 -> layer2')
        }
        break

      case 'touch-end':
        if (prevState === 'layer2') {
          this.state = { currentLayer: 'layer1' }
          this.emit('layer1')
          logger.info('State transition: layer2 -> layer1')
        }
        break
    }
  }

  /**
   * 获取当前层状态
   */
  getCurrentLayer(): LayerState {
    return this.state.currentLayer
  }

  /**
   * 订阅状态变更
   * 返回取消订阅函数
   */
  onStateChange(callback: (state: LayerState) => void): () => void {
    this.listeners.add(callback)
    
    // 立即通知当前状态
    callback(this.state.currentLayer)
    
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.touchpadMonitor) {
      this.stopMonitoring()
      if (this.touchHandler) {
        this.touchpadMonitor.removeListener('touch', this.touchHandler)
      }
      this.touchpadMonitor = null
    }
    this.touchHandler = null
    this.listeners.clear()
  }

  private resetToLayer1(): void {
    if (this.state.currentLayer !== 'layer1') {
      this.state = { currentLayer: 'layer1' }
      this.emit('layer1')
      logger.info('State transition: layer2 -> layer1')
    }
  }

  /**
   * 通知状态变更
   */
  private emit(newState: LayerState): void {
    this.listeners.forEach(callback => {
      try {
        callback(newState)
      } catch (error) {
        logger.error('State listener error:', error)
      }
    })
  }
}
