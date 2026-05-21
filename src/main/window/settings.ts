import { BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import logger from '../utils/logger'
import { ConfigManager } from '../config/manager'
import { KeymapEngine } from '../keymap/engine'
import { IPC_CHANNELS } from '../../common/types/mapping'

/**
 * 配置窗口管理类
 */
export class SettingsWindow {
  private window: BrowserWindow | null = null
  private configManager: ConfigManager
  private keymapEngine: KeymapEngine

  constructor(configManager: ConfigManager, keymapEngine: KeymapEngine) {
    this.configManager = configManager
    this.keymapEngine = keymapEngine

    // 设置 IPC 处理器
    this.setupIpcHandlers()
  }

  /**
   * 显示配置窗口
   */
  show(): void {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.focus()
      return
    }

    this.window = new BrowserWindow({
      width: 500,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Touchpad Keymap Layer - 设置',
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 加载配置界面
    this.window.loadFile(path.join(__dirname, '../../renderer/settings.html'))

    // 开发环境打开 DevTools
    // this.window.webContents.openDevTools()

    // 窗口关闭时清理
    this.window.on('closed', () => {
      this.window = null
      this.removeIpcHandlers()
    })

    logger.info('Settings window created')
  }

  /**
   * 隐藏窗口
   */
  hide(): void {
    this.window?.hide()
  }

  /**
   * 销毁窗口
   */
  destroy(): void {
    if (this.window) {
      this.window.destroy()
      this.window = null
      this.removeIpcHandlers()
    }
  }

  /**
   * 设置 IPC 处理器
   */
  private setupIpcHandlers(): void {
    // 获取配置
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, () => {
      return this.configManager.getConfig()
    })

    // 保存配置
    ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_, config) => {
      return this.configManager.saveConfig(config)
    })

    // 重置配置
    ipcMain.handle(IPC_CHANNELS.CONFIG_RESET, () => {
      return this.configManager.resetToDefault()
    })

    // 监听配置变更，推送到渲染进程
    this.configManager.onConfigChange((config) => {
      this.window?.webContents.send(IPC_CHANNELS.CONFIG_UPDATED, config)
    })

    logger.info('IPC handlers set up')
  }

  /**
   * 移除 IPC 处理器
   */
  private removeIpcHandlers(): void {
    ipcMain.removeHandler(IPC_CHANNELS.CONFIG_GET)
    ipcMain.removeHandler(IPC_CHANNELS.CONFIG_SAVE)
    ipcMain.removeHandler(IPC_CHANNELS.CONFIG_RESET)
  }
}

export default SettingsWindow
