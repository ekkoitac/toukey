import { systemPreferences } from 'electron'

/**
 * 检查 Accessibility (辅助功能) 权限
 * macOS 上需要使用 CGEventTap 拦截键盘事件
 */
export function checkAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') {
    return true  // 非 macOS 平台无需检查
  }

  // macOS 10.15+ API
  const accessibilityEnabled = systemPreferences.isTrustedAccessibilityClient(false)
  return accessibilityEnabled
}

/**
 * 请求 Accessibility 权限
 * 这会弹出系统对话框
 */
export function requestAccessibilityPermission(): void {
  if (process.platform !== 'darwin') {
    return
  }

  // 调用 isTrustedAccessibilityClient(true) 会触发权限请求
  systemPreferences.isTrustedAccessibilityClient(true)
}

/**
 * 打开系统设置的辅助功能面板
 */
export function openAccessibilitySettings(): void {
  const { shell } = require('electron')
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
}
