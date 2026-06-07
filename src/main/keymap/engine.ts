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

      // 层状态变化时同步原生拦截条件
      this.stateMachine.onStateChange(() => {
        this.syncInterceptState()
      })

      // 启动拦截器
      const success = this.keyInterceptor.start()
      if (!success) {
        logger.warn('Key interceptor failed to start, may need Accessibility permission')
      } else {
        this.enabled = true
        this.syncInterceptState()
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
  enable(): void {
    this.enabled = true
    this.syncInterceptState()
    logger.info('Keymap engine enabled')
  }

  /**
   * 禁用引擎
   */
  disable(): void {
    this.enabled = false
    this.syncInterceptState()
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
    // 监听按键按下事件（拦截逻辑在原生层，由 syncInterceptState 同步）
    this.keyInterceptor.on('keydown', (event: KeyEvent) => {
      const keyChar = this.keyCodeToChar(event.keyCode)
      this.executeMapping(keyChar)
    })
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
