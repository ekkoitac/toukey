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
  private keydownHandler: ((event: KeyEvent) => void) | null = null
  private unsubscribeStateChange: (() => void) | null = null
  private unsubscribeConfigChange: (() => void) | null = null

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

      // 层状态变化时同步原生拦截条件
      this.unsubscribeStateChange = this.stateMachine.onStateChange(() => {
        this.syncInterceptState()
      })

      // 启动拦截器
      this.enable()

      // 监听配置变更
      this.unsubscribeConfigChange = this.configManager.onConfigChange((config) => {
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
      // 只加载 combo 类型的映射
      if (rule.toType === 'combo') {
        this.rules.set(rule.from, rule)
      }
    }
    
    logger.info(`Loaded ${this.rules.size} key mappings`)
    this.syncInterceptState()
  }

  /**
   * 启用引擎
   */
  enable(): boolean {
    if (!this.keyInterceptor) {
      return false
    }

    if (this.enabled) {
      this.syncInterceptState()
      return true
    }

    if (this.keydownHandler) {
      this.keyInterceptor.on('keydown', this.keydownHandler)
    }

    const success = this.keyInterceptor.start()
    if (!success) {
      this.keyInterceptor.stop()
      logger.warn('Key interceptor failed to start, may need Accessibility permission')
      return false
    }

    this.enabled = true
    this.syncInterceptState()
    logger.info('Keymap engine enabled')
    return true
  }

  /**
   * 禁用引擎
   */
  disable(): void {
    if (!this.keyInterceptor) {
      this.enabled = false
      return
    }

    this.enabled = false
    this.syncInterceptState()
    this.keyInterceptor.stop()
    logger.info('Keymap engine disabled')
  }

  /**
   * 引擎是否启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.unsubscribeStateChange?.()
    this.unsubscribeStateChange = null
    this.unsubscribeConfigChange?.()
    this.unsubscribeConfigChange = null

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
    // 监听按键按下事件（拦截逻辑在原生层，由 syncInterceptState 同步）
    this.keydownHandler = (event: KeyEvent) => {
      const keyChar = this.keyCodeToChar(event.keyCode)
      this.executeMapping(keyChar)
    }
  }

  /**
   * 将 layer2 状态与映射键码同步到原生拦截器
   */
  private syncInterceptState(): void {
    if (!this.keyInterceptor) {
      return
    }

    const active = this.enabled && this.stateMachine.getCurrentLayer() === 'layer2'
    const keyCodes: number[] = []

    for (const fromKey of this.rules.keys()) {
      const code = MACOS_KEY_CODES[fromKey]
      if (code !== undefined) {
        keyCodes.push(code)
      }
    }

    this.keyInterceptor.updateInterceptState(active, keyCodes)
  }

  /**
   * 执行按键映射
   */
  private executeMapping(fromKey: string): void {
    const rule = this.rules.get(fromKey)
    if (!rule || !this.keyInjector) {
      return
    }

    if (rule.toType === 'combo') {
      const target = [...rule.to.modifiers, rule.to.key].join('+')
      logger.debug(`Mapping ${fromKey} -> ${target}`)
      this.keyInjector.injectCombo(rule.to.modifiers, rule.to.key)
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
