import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell } from 'electron'
import path from 'path'
import logger from './utils/logger'
import { checkAccessibilityPermission, requestAccessibilityPermission } from './utils/permissions'
import { TouchpadStateMachine } from './state-machine/touchpad-state'
import { KeymapEngine } from './keymap/engine'
import { ConfigManager } from './config/manager'
import { TrayIcon } from './tray/icon'
import { SettingsWindow } from './window/settings'

// 保持全局引用防止垃圾回收
let trayIcon: TrayIcon | null = null
let settingsWindow: SettingsWindow | null = null
let stateMachine: TouchpadStateMachine | null = null
let keymapEngine: KeymapEngine | null = null
let configManager: ConfigManager | null = null

// 初始化应用
async function initializeApp() {
  logger.info('Application starting...')

  // 1. 检查 Accessibility 权限
  const hasPermission = checkAccessibilityPermission()
  if (!hasPermission) {
    logger.warn('Accessibility permission not granted')
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '需要辅助功能权限',
      message: 'Touchpad Keymap Layer 需要辅助功能权限来监听键盘事件。',
      detail: '请在系统设置中授予权限，然后重新启动应用。',
      buttons: ['打开系统设置', '稍后处理'],
      defaultId: 0
    })

    if (result.response === 0) {
      requestAccessibilityPermission()
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    }
  }

  // 2. 初始化配置管理器
  configManager = new ConfigManager()
  await configManager.initialize()
  logger.info('Config manager initialized')

  // 3. 初始化触摸板状态机
  stateMachine = new TouchpadStateMachine()
  await stateMachine.initialize()
  logger.info('State machine initialized')

  // 4. 初始化按键映射引擎（需要原生模块）
  try {
    keymapEngine = new KeymapEngine(
      stateMachine,
      configManager
    )
    await keymapEngine.initialize()
    logger.info('Keymap engine initialized')
  } catch (error) {
    logger.error('Failed to initialize keymap engine:', error)
    dialog.showErrorBox(
      '初始化失败',
      '无法加载原生模块。请确保已运行 `npm run build:native`'
    )
  }

  // 5. 初始化菜单栏图标
  trayIcon = new TrayIcon({
    onShowSettings: showSettingsWindow,
    onQuit: quitApp
  })
  trayIcon.create()
  logger.info('Tray icon created')

  // 6. 状态机状态变更时更新图标
  stateMachine.onStateChange((state) => {
    trayIcon?.setLayerState(state)
    logger.debug(`Layer state changed to: ${state}`)
  })

  // 7. 加载配置到映射引擎
  const config = configManager.getConfig()
  keymapEngine?.loadRules(config.mappings)

  logger.info('Application initialized successfully')
}

// 显示配置窗口
function showSettingsWindow() {
  if (!configManager || !keymapEngine || !stateMachine) {
    logger.warn('Settings window requested before app initialization completed')
    return
  }
  if (!settingsWindow) {
    settingsWindow = new SettingsWindow(configManager, keymapEngine, stateMachine)
  }
  settingsWindow.show()
  logger.info('Settings window shown')
}

// 退出应用
function quitApp() {
  logger.info('Application quitting...')
  
  // 清理资源
  keymapEngine?.dispose()
  stateMachine?.dispose()
  trayIcon?.destroy()
  settingsWindow?.destroy()
  
  app.quit()
}

// Electron 生命周期
app.whenReady().then(initializeApp)

app.on('window-all-closed', () => {
  // macOS 上保持后台运行
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // macOS 点击 dock 图标时显示配置窗口
  showSettingsWindow()
})

app.on('before-quit', () => {
  logger.info('Before quit event')
  keymapEngine?.dispose()
  stateMachine?.dispose()
})

// 防止多个实例运行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  logger.warn('Another instance is already running')
  app.quit()
} else {
  app.on('second-instance', () => {
    // 当尝试启动第二个实例时，显示配置窗口
    showSettingsWindow()
  })
}
