import log from 'electron-log'
import path from 'path'
import { app } from 'electron'

// 配置日志
log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// 设置日志文件路径
if (app.isPackaged) {
  log.transports.file.resolvePath = () => 
    path.join(app.getPath('logs'), 'touchpad-keymap-layer.log')
}

// 日志轮转配置
log.transports.file.maxSize = 10 * 1024 * 1024  // 10MB
log.transports.file.maxFiles = 5

export default log
