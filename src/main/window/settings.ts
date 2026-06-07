import { BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import logger from '../utils/logger'
import { ConfigManager } from '../config/manager'
import { KeymapEngine } from '../keymap/engine'
import { IPC_CHANNELS, RuntimeStatus } from '../../common/types/mapping'
import { TouchpadStateMachine } from '../state-machine/touchpad-state'

/**
 * 配置窗口管理类
 */
export class SettingsWindow {
  private window: BrowserWindow | null = null
  private configManager: ConfigManager
  private keymapEngine: KeymapEngine
  private stateMachine: TouchpadStateMachine
  private unsubscribeLayerState: (() => void) | null = null

  constructor(
    configManager: ConfigManager,
    keymapEngine: KeymapEngine,
    stateMachine: TouchpadStateMachine
  ) {
    this.configManager = configManager
    this.keymapEngine = keymapEngine
    this.stateMachine = stateMachine

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
      height: 660,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Touchpad Keymap Layer - 设置',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 加载配置界面
    if (process.env['ELECTRON_RENDERER_URL']) {
      this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
    } else {
      this.window.loadFile(path.join(__dirname, '../renderer/settings.html'))
    }

    // 开发环境打开 DevTools
    // this.window.webContents.openDevTools()

    // 窗口关闭时清理（IPC 处理器保持注册，供下次打开复用）
    this.window.on('closed', () => {
      this.window = null
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

    ipcMain.handle(IPC_CHANNELS.LAYER_STATE_GET, () => {
      return this.stateMachine.getCurrentLayer()
    })

    ipcMain.handle(IPC_CHANNELS.RUNTIME_STATUS_GET, () => {
      return this.getRuntimeStatus()
    })

    ipcMain.handle(IPC_CHANNELS.RUNTIME_LISTENERS_SET, (_, enabled: boolean) => {
      if (enabled) {
        this.stateMachine.startMonitoring()
        const keyInterceptorStarted = this.keymapEngine.enable()
        if (!keyInterceptorStarted) {
          this.stateMachine.stopMonitoring()
          this.emitRuntimeStatus()
          throw new Error('Key interceptor failed to start')
        }
      } else {
        this.keymapEngine.disable()
        this.stateMachine.stopMonitoring()
      }

      const status = this.getRuntimeStatus()
      this.emitRuntimeStatus(status)
      return status
    })

    this.unsubscribeLayerState?.()
    this.unsubscribeLayerState = this.stateMachine.onStateChange((state) => {
      this.window?.webContents.send(IPC_CHANNELS.LAYER_STATE_UPDATED, state)
      this.emitRuntimeStatus()
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
    ipcMain.removeHandler(IPC_CHANNELS.LAYER_STATE_GET)
    ipcMain.removeHandler(IPC_CHANNELS.RUNTIME_STATUS_GET)
    ipcMain.removeHandler(IPC_CHANNELS.RUNTIME_LISTENERS_SET)
    this.unsubscribeLayerState?.()
    this.unsubscribeLayerState = null
  }

  private getRuntimeStatus(): RuntimeStatus {
    return {
      listenersEnabled: this.stateMachine.isMonitoring() && this.keymapEngine.isEnabled(),
      layerState: this.stateMachine.getCurrentLayer()
    }
  }

  private emitRuntimeStatus(status: RuntimeStatus = this.getRuntimeStatus()): void {
    this.window?.webContents.send(IPC_CHANNELS.RUNTIME_LISTENERS_UPDATED, status)
  }
}

export default SettingsWindow
