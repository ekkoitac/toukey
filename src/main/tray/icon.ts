import { Tray, Menu, nativeImage, NativeImage, dialog } from 'electron'
import path from 'path'
import logger from '../utils/logger'
import { LayerState } from '../../common/types/mapping'

/**
 * 菜单栏图标配置
 */
interface TrayIconOptions {
  onShowSettings: () => void
  onQuit: () => void
}

/**
 * 菜单栏图标管理类
 */
export class TrayIcon {
  private tray: Tray | null = null
  private icons: {
    default: NativeImage
    active: NativeImage
  }
  private options: TrayIconOptions

  constructor(options: TrayIconOptions) {
    this.options = options

    // 加载图标资源
    const iconDir = path.join(__dirname, '../../assets/icons')
    
    this.icons = {
      default: nativeImage.createFromPath(path.join(iconDir, 'tray-template.png')),
      active: nativeImage.createFromPath(path.join(iconDir, 'tray-active.png'))
    }

    // 设置模板图标（适配深色/浅色模式）
    this.icons.default.setTemplateImage(true)
    // 激活图标不使用模板，以显示颜色
    this.icons.active.setTemplateImage(false)
  }

  /**
   * 创建菜单栏图标
   */
  create(): void {
    this.tray = new Tray(this.icons.default)

    // 设置工具提示
    this.tray.setToolTip('Touchpad Keymap Layer')

    // 左键点击打开配置
    this.tray.on('click', () => {
      this.options.onShowSettings()
    })

    // 右键菜单
    this.updateContextMenu()

    logger.info('Tray icon created')
  }

  /**
   * 更新层状态图标
   */
  setLayerState(state: LayerState): void {
    if (!this.tray) return

    const icon = state === 'layer2' ? this.icons.active : this.icons.default
    this.tray.setImage(icon)

    // 更新工具提示
    const tooltip = state === 'layer2' 
      ? 'Touchpad Keymap Layer (Active)' 
      : 'Touchpad Keymap Layer'
    this.tray.setToolTip(tooltip)
  }

  /**
   * 更新右键菜单
   */
  updateContextMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '设置...',
        click: () => this.options.onShowSettings()
      },
      { type: 'separator' },
      {
        label: '关于',
        click: () => {
          dialog.showMessageBox({
            type: 'info',
            title: '关于',
            message: 'Touchpad Keymap Layer',
            detail: 'Version 1.0.0\n\n单指触摸板进入自定义按键层。'
          })
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => this.options.onQuit()
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /**
   * 销毁图标
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
    logger.info('Tray icon destroyed')
  }
}

export default TrayIcon
