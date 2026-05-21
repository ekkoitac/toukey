/**
 * 按键映射规则
 */
export interface KeyMapping {
  /** 源按键（如 'i'） */
  from: string
  /** 目标按键（如 'up'） */
  to: string
  /** 目标类型：按键或命令 */
  toType: 'key' | 'command'
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
  LAYER_STATE_UPDATED: 'layer-state:updated'
} as const
