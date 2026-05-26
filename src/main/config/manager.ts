import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import logger from '../utils/logger'
import { AppConfig, KeyMapping } from '../../common/types/mapping'
import { DEFAULT_CONFIG } from './defaults'

/**
 * 配置管理器
 * 负责配置的读取、保存、验证和热重载
 */
export class ConfigManager {
  private configPath: string = ''
  private currentConfig: AppConfig = DEFAULT_CONFIG
  private watchers: Set<(config: AppConfig) => void> = new Set()
  private fileWatcher: fs.FileWatcher | null = null
  private isWriting: boolean = false

  /**
   * 初始化配置管理器
   */
  async initialize(): Promise<void> {
    this.configPath = path.join(
      app.getPath('userData'),
      'config.json'
    )

    logger.info(`Config path: ${this.configPath}`)

    // 检查配置文件是否存在
    try {
      await fs.access(this.configPath)
    } catch {
      // 配置文件不存在，创建默认配置
      logger.info('Config file not found, creating default config')
      await this.saveConfig(DEFAULT_CONFIG)
    }

    // 加载配置
    await this.loadConfig()

    // 设置文件监听实现热重载
    this.setupFileWatcher()
  }

  /**
   * 获取当前配置
   */
  getConfig(): AppConfig {
    return { ...this.currentConfig }
  }

  /**
   * 获取映射规则
   */
  getMappings(): KeyMapping[] {
    return [...this.currentConfig.mappings]
  }

  /**
   * 保存配置
   */
  async saveConfig(config: AppConfig): Promise<void> {
    // 验证配置
    const validated = this.validateConfig(config)
    if (!validated) {
      throw new Error('Config validation failed')
    }

    this.isWriting = true
    try {
      // 写入文件
      await fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      )

      this.currentConfig = config
      logger.info('Config saved successfully')
    } finally {
      // 延迟重置 writing 状态以确保避开文件系统 change 事件的延迟触发
      setTimeout(() => {
        this.isWriting = false
      }, 100)
    }
  }

  /**
   * 更新映射规则
   */
  async updateMappings(mappings: KeyMapping[]): Promise<void> {
    const newConfig: AppConfig = {
      ...this.currentConfig,
      mappings
    }
    await this.saveConfig(newConfig)
    this.emitChange()
  }

  /**
   * 重置为默认配置
   */
  async resetToDefault(): Promise<void> {
    await this.saveConfig(DEFAULT_CONFIG)
    this.emitChange()
    logger.info('Config reset to default')
  }

  /**
   * 订阅配置变更
   */
  onConfigChange(callback: (config: AppConfig) => void): () => void {
    this.watchers.add(callback)
    return () => {
      this.watchers.delete(callback)
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
    }
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(content) as AppConfig

      // 验证配置
      if (!this.validateConfig(parsed)) {
        throw new Error('Config validation failed')
      }

      this.currentConfig = parsed
      logger.info('Config loaded successfully')
      this.emitChange()
    } catch (error) {
      logger.error('Failed to load config:', error)
      
      // 备份错误文件并重置为默认
      await this.backupAndReset()
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(config: any): config is AppConfig {
    if (!config || typeof config !== 'object') {
      return false
    }

    // 检查必需字段
    if (typeof config.version !== 'number') {
      return false
    }

    if (!Array.isArray(config.mappings)) {
      return false
    }

    // 验证 mappings 格式
    for (const mapping of config.mappings) {
      if (!mapping || typeof mapping !== 'object') {
        return false
      }
      if (typeof mapping.from !== 'string' || typeof mapping.to !== 'string') {
        return false
      }
      if (mapping.toType !== 'key' && mapping.toType !== 'command') {
        return false
      }
    }

    if (!config.settings || typeof config.settings !== 'object') {
      return false
    }

    return true
  }

  /**
   * 备份错误配置并重置
   */
  private async backupAndReset(): Promise<void> {
    try {
      // 备份旧文件
      const backupPath = `${this.configPath}.backup.${Date.now()}`
      await fs.rename(this.configPath, backupPath)
      logger.info(`Config backed up to: ${backupPath}`)
    } catch {
      // 备份失败，直接覆盖
    }

    // 重置为默认配置
    this.currentConfig = DEFAULT_CONFIG
    await this.saveConfig(DEFAULT_CONFIG)
    this.emitChange()
    logger.info('Config reset to default due to load error')
  }

  /**
   * 设置文件监听
   */
  private setupFileWatcher(): void {
    try {
      this.fileWatcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          if (this.isWriting) {
            logger.debug('Config file changed by self write, ignoring reload')
            return
          }
          logger.info('Config file changed, reloading...')
          this.loadConfig().catch(err => {
            logger.error('Config reload failed:', err)
          })
        }
      })
    } catch (error) {
      logger.warn('Failed to setup file watcher:', error)
    }
  }

  /**
   * 通知配置变更
   */
  private emitChange(): void {
    this.watchers.forEach(callback => {
      try {
        callback(this.currentConfig)
      } catch (error) {
        logger.error('Config change listener error:', error)
      }
    })
  }
}
