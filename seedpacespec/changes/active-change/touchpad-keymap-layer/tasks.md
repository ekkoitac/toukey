# Tasks — touchpad-keymap-layer

> PRD: `specs/touchpad-keymap-layer-prd.md`
> TRD: `trds/touchpad-keymap-layer-trd.md`
> 生成时间: 2026-05-21

## R01 触摸板层触发机制

- [ ] **TouchpadMonitor 原生模块实现** — TRD §4.1.1
  - [ ] 创建 `src/native/touchpad.mm`，实现 IOKit HID 设备匹配
  - [ ] 实现单指/多指触摸事件解析
  - [ ] 通过 N-API 暴露给 Node.js（start/stop/on/removeListener 接口）
  - [ ] 编译测试，验证触摸板事件正确捕获

- [ ] **TouchpadStateMachine 状态机实现** — TRD §4.2.1
  - [ ] 创建 `src/main/state-machine/touchpad-state.ts`
  - [ ] 实现 Layer1/Layer2 状态转换逻辑
  - [ ] 实现状态订阅/通知机制
  - [ ] 单元测试：状态转换路径覆盖

- [ ] **触摸板状态与菜单栏图标联动** — TRD §4.3.1
  - [ ] 状态机变更时更新 Tray 图标
  - [ ] 验证图标在 Layer1/Layer2 正确切换

## R02 按键拦截与映射

- [ ] **KeyInterceptor 原生模块实现** — TRD §4.1.2
  - [ ] 创建 `src/native/key_interceptor.mm`，实现 CGEventTap
  - [ ] 实现独立线程的事件循环
  - [ ] 通过 N-API 暴露 filter 回调机制
  - [ ] 处理 Accessibility 权限未授权场景

- [ ] **KeyInjector 原生模块实现** — TRD §4.1.3
  - [ ] 创建 `src/native/key_injector.mm`，实现 CGEventPost
  - [ ] 实现键名到 macOS 虚拟键码的映射表
  - [ ] 暴露 injectKey 接口

- [ ] **KeymapEngine 映射引擎实现** — TRD §4.2.2
  - [ ] 创建 `src/main/keymap/engine.ts`
  - [ ] 实现映射规则 Map 存储和 O(1) 查询
  - [ ] 集成 TouchpadStateMachine 层状态判断
  - [ ] 集成 KeyInterceptor filter 回调
  - [ ] 集成 KeyInjector 按键注入
  - [ ] 验证默认映射（i→↑, k→↓, j→←, l→→, u→Home, o→End）

- [ ] **原生模块绑定.gyp配置** — TRD §4.1
  - [ ] 创建 `src/native/binding.gyp`
  - [ ] 配置三个原生模块的编译规则
  - [ ] 测试编译产物加载

## R03 配置持久化

- [ ] **ConfigManager 配置管理器实现** — TRD §4.2.3
  - [ ] 创建 `src/main/config/manager.ts`
  - [ ] 实现 JSON 配置文件读写
  - [ ] 实现 JSON Schema 验证
  - [ ] 实现配置文件热重载（fs.watch）
  - [ ] 实现损坏配置自动恢复默认
  - [ ] 定义默认配置（含 6 条默认映射规则）

- [ ] **KeymapEngine 配置热更新** — TRD §4.2.2
  - [ ] 集成 ConfigManager 配置变更事件
  - [ ] 配置变更时重新加载映射规则

## R04 状态栏图标反馈

- [ ] **TrayIcon 菜单栏图标实现** — TRD §4.3.1
  - [ ] 创建 `src/main/tray/icon.ts`
  - [ ] 加载两套图标资源（默认/激活）
  - [ ] 实现图标状态切换
  - [ ] 实现点击打开配置窗口
  - [ ] 实现右键菜单（设置、退出）
  - [ ] 适配 macOS 深色/浅色模式

- [ ] **准备图标资源** — TRD §4.3.1
  - [ ] 创建 `src/assets/icons/tray-default.png`（1x/2x）
  - [ ] 创建 `src/assets/icons/tray-active.png`（1x/2x）
  - [ ] 创建 `src/assets/icons/tray-template.png`（模板图标）

## R05 映射配置界面

- [ ] **SettingsWindow 配置窗口实现** — TRD §4.3.2
  - [ ] 创建 `src/main/window/settings.ts`
  - [ ] 实现 BrowserWindow 创建和管理
  - [ ] 实现 preload 脚本（contextBridge 暴露 API）
  - [ ] 集成 ConfigManager IPC 调用

- [ ] **配置界面 UI 实现** — TRD §4.3.2
  - [ ] 创建 `src/renderer/settings/index.html`
  - [ ] 创建 `src/renderer/settings/index.ts`
  - [ ] 实现映射规则列表展示
  - [ ] 实现添加/编辑映射表单
  - [ ] 实现删除映射按钮
  - [ ] 实现重置默认按钮
  - [ ] 实现按键捕获输入组件

- [ ] **IPC 通道实现** — TRD §4.2.4
  - [ ] 创建 `src/common/ipc-channels.ts`
  - [ ] 实现 config:get、config:save、config:reset 通道
  - [ ] 实现 config-updated 推送事件

## 项目基础设施

- [ ] **Electron + Vite 项目初始化**
  - [ ] 创建 `package.json`（依赖 Electron、Vite、TypeScript、electron-vite）
  - [ ] 创建 `electron.vite.config.ts`
  - [ ] 创建 `tsconfig.json`
  - [ ] 创建 `src/main/index.ts`（应用入口）

- [ ] **主进程应用生命周期**
  - [ ] 应用启动初始化顺序（权限检查 → 配置加载 → 触摸板监听 → 菜单栏图标）
  - [ ] 应用退出清理（停止触摸板监听、停止 CGEventTap）

- [ ] **Accessibility 权限处理**
  - [ ] 创建 `src/main/utils/permissions.ts`
  - [ ] 实现权限检测函数
  - [ ] 实现未授权时引导对话框
  - [ ] 提供跳转系统设置按钮

- [ ] **日志系统**
  - [ ] 创建 `src/main/utils/logger.ts`
  - [ ] 集成 Electron log
  - [ ] 配置日志文件轮转
