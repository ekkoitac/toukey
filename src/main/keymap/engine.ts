import { KeyMapping, LayerState, KeyEvent } from '../../common/types/mapping'
import { TouchpadStateMachine } from '../state-machine/touchpad-state'
import { ConfigManager } from '../config/manager'
import logger from '../utils/logger'
import { MACOS_KEY_CODES, REVERSE_KEY_CODES } from './types'

/**
 * 按键映射引擎
 * 负责拦截按键、匹配映射规则、注入目标按键
 */
export class KeymapEngine {
  private rules: Map<string, KeyMapping> = new Map()
  private enabled: boolean = false
  private keyInterceptor: any = null
  private keyInjector: any = null

  constructor(
    private stateMachine: TouchpadStateMachine,
    private configManager: ConfigManager
  ) {}

  /**
   * 初始化引擎
   */
  async initialize(): Promise<void> {
    try {
      // 动态加载原生模块
      const { KeyInterceptor } = await import('../native/key-interceptor')
      const { KeyInjector } = await import('../native/key-injector')

      this.keyInterceptor = new KeyInterceptor()
      this.keyInjector = new KeyInjector()

      // 设置拦截器回调
      this.setupInterceptor()

      // 启动拦截器
      const success = this.keyInterceptor.start()
      if (!success) {
        logger.warn('Key interceptor failed to start, may need Accessibility permission')
      } else {
        this.enabled = true
        logger.info('Keymap engine initialized and started')
      }

      // 监听配置变更
      this.configManager.onConfigChange((config) => {
        this.loadRules(config.mappings)
      })
    } catch (error) {
      logger.error('Failed to initialize keymap engine:', error)
      throw error
    }
  }

  /**
   * 加载映射规则
   */
  loadRules(rules: KeyMapping[]): void {
    this.rules.clear()
    
    for (const rule of rules) {
      // 只加载 key 类型的映射
      if (rule.toType === 'key') {
        this.rules.set(rule.from, rule)
      }
    }
    
    logger.info(`Loaded ${this.rules.size} key mappings`)
  }

  /**
   * 启用引擎
   */
  enable(): void {
    this.enabled = true
    logger.info('Keymap engine enabled')
  }

  /**
   * 禁用引擎
   */
  disable(): void {
    this.enabled = false
    logger.info('Keymap engine disabled')
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.keyInterceptor) {
      this.keyInterceptor.stop()
      this.keyInterceptor = null
    }
    this.keyInjector = null
    this.enabled = false
    logger.info('Keymap engine disposed')
  }

  /**
   * 设置拦截器
   */
  private setupInterceptor(): void {
    // 设置拦截过滤器
    this.keyInterceptor.setInterceptFilter((event: KeyEvent) => {
      if (!this.enabled) {
        return false
      }

      // 只在 Layer2 时拦截
      const currentLayer = this.stateMachine.getCurrentLayer()
      if (currentLayer !== 'layer2') {
        return false
      }

      // 检查该键是否有映射规则
      const keyChar = this.keyCodeToChar(event.keyCode)
      return this.rules.has(keyChar)
    })

    // 监听按键按下事件
    this.keyInterceptor.on('keydown', (event: KeyEvent) => {
      const keyChar = this.keyCodeToChar(event.keyCode)
      this.executeMapping(keyChar)
    })
  }

  /**
   * 执行按键映射
   */
  private executeMapping(fromKey: string): void {
    const rule = this.rules.get(fromKey)
    if (!rule || !this.keyInjector) {
      return
    }

    if (rule.toType === 'key') {
      logger.debug(`Mapping ${fromKey} -> ${rule.to}`)
      this.keyInjector.injectKey(rule.to)
    }
  }

  /**
   * 键码转字符
   */
  private keyCodeToChar(keyCode: number): string {
    return REVERSE_KEY_CODES[keyCode] || ''
  }

  /**
   * 字符转键码（用于配置界面）
   */
  charToKeyCode(char: string): number | undefined {
    return MACOS_KEY_CODES[char.toLowerCase()]
  }
}
