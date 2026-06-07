import { MacKey, ModifierKey } from './keys'

/**
 * 目标组合键
 */
export interface KeyCombo {
  /** 主按键 */
  key: MacKey
  /** 同时按下的修饰键 */
  modifiers: ModifierKey[]
}

/**
 * 按键映射规则
 */
export interface KeyMapping {
  /** 源按键（如 'i'） */
  from: MacKey
  /** 目标组合键（如 Cmd+Left） */
  to: KeyCombo
  /** 目标类型：组合键 */
  toType: 'combo'
}

/**
 * 应用配置
 */
export interface AppConfig {
  /** 配置版本 */
  version: number
  /** 按键映射规则列表 */
  mappings: KeyMapping[]
  /** 应用设置 */
  settings: AppSettings
}

/**
 * 应用设置
 */
export interface AppSettings {
  /** 开机自启 */
  launchAtLogin: boolean
  /** 显示层状态指示器 */
  showLayerIndicator: boolean
}

/**
 * 运行时状态
 */
export interface RuntimeStatus {
  /** 触摸板与键盘监听是否开启 */
  listenersEnabled: boolean
  /** 当前层状态 */
  layerState: LayerState
}

/**
 * 层状态
 */
export type LayerState = 'layer1' | 'layer2'

/**
 * 触摸板事件
 */
export interface TouchpadEvent {
  type: 'touch-start' | 'touch-end'
  timestamp: number
  fingerCount: number
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
 * IPC 通道常量
 */
export const IPC_CHANNELS = {
  // 配置相关
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  CONFIG_RESET: 'config:reset',
  CONFIG_UPDATED: 'config:updated',
  
  // 权限相关
  PERMISSION_CHECK: 'permission:check',
  PERMISSION_REQUEST: 'permission:request',
  
  // 层状态
  LAYER_STATE_GET: 'layer-state:get',
  LAYER_STATE_UPDATED: 'layer-state:updated',

  // 运行状态
  RUNTIME_STATUS_GET: 'runtime-status:get',
  RUNTIME_LISTENERS_SET: 'runtime-listeners:set',
  RUNTIME_LISTENERS_UPDATED: 'runtime-listeners:updated'
} as const
