import { AppConfig } from '../../common/types/mapping'

/**
 * 默认应用配置
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  mappings: [
    { from: 'i', to: { key: 'up', modifiers: [] }, toType: 'combo' },
    { from: 'k', to: { key: 'down', modifiers: [] }, toType: 'combo' },
    { from: 'j', to: { key: 'left', modifiers: [] }, toType: 'combo' },
    { from: 'l', to: { key: 'right', modifiers: [] }, toType: 'combo' },
    { from: 'u', to: { key: 'home', modifiers: [] }, toType: 'combo' },
    { from: 'o', to: { key: 'end', modifiers: [] }, toType: 'combo' }
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
export const CONFIG_VERSION = 2
