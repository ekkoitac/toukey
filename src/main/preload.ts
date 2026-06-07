import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, AppConfig, LayerState } from '../common/types/mapping'

const configUpdateListeners = new WeakMap<
  (config: AppConfig) => void,
  (event: Electron.IpcRendererEvent, config: AppConfig) => void
>()

/**
 * 暴露给渲染进程的 API
 * 通过 contextBridge 实现上下文隔离
 */
const settingsAPI = {
  // 获取配置
  getConfig: (): Promise<AppConfig> => 
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),

  // 保存配置
  saveConfig: (config: AppConfig): Promise<void> => 
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config),

  // 重置配置
  resetToDefault: (): Promise<void> => 
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_RESET),

  // 监听配置变更
  onConfigUpdate: (callback: (config: AppConfig) => void): void => {
    const listener = (_: Electron.IpcRendererEvent, config: AppConfig) => callback(config)
    configUpdateListeners.set(callback, listener)
    ipcRenderer.on(IPC_CHANNELS.CONFIG_UPDATED, listener)
  },

  // 移除监听器
  removeConfigUpdate: (callback: (config: AppConfig) => void): void => {
    const listener = configUpdateListeners.get(callback)
    if (listener) {
      ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_UPDATED, listener)
      configUpdateListeners.delete(callback)
    }
  },

  // 获取当前层状态
  getLayerState: (): Promise<LayerState> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYER_STATE_GET),

  // 监听层状态变更
  onLayerStateUpdate: (callback: (state: LayerState) => void): void => {
    ipcRenderer.on(IPC_CHANNELS.LAYER_STATE_UPDATED, (_, state) => callback(state))
  }
}

// 暴露 API 到 window.api
contextBridge.exposeInMainWorld('api', settingsAPI)

// 类型声明（供渲染进程 TypeScript 使用）
declare global {
  interface Window {
    api: typeof settingsAPI
  }
}

export { settingsAPI }
