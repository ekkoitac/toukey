import { AppConfig } from '../../common/types/mapping'

/**
 * 默认应用配置
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  mappings: [
    { from: 'i', to: 'up', toType: 'key' },
    { from: 'k', to: 'down', toType: 'key' },
    { from: 'j', to: 'left', toType: 'key' },
    { from: 'l', to: 'right', toType: 'key' },
    { from: 'u', to: 'home', toType: 'key' },
    { from: 'o', to: 'end', toType: 'key' }
  ],
  settings: {
    launchAtLogin: false,
    showLayerIndicator: true
  }
}

/**
 * 配置 Schema 版本
 * 用于配置迁移
 */
export const CONFIG_VERSION = 1
