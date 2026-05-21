# Touchpad Keymap Layer

macOS Electron 应用，通过触摸板实现临时按键层切换。单指放在触摸板上时，主键盘进入自定义层，将常用按键（如 i/k/j/l）映射为方向键等功能。

## 功能特性

- 🖱️ 单指触摸板触发 Layer 2（自定义按键层）
- ⌨️ 按键映射：i→↑, k→↓, j→←, l→→, u→Home, o→End
- 🔧 可视化配置界面
- 💾 JSON 配置文件持久化
- 🌓 菜单栏图标状态反馈（适配深色/浅色模式）

## 系统要求

- macOS 10.15 (Catalina) 或更高版本
- Node.js 18+
- 需要 **辅助功能 (Accessibility)** 权限

## 安装与运行

```bash
# 安装依赖
npm install

# 编译原生模块（必须先执行）
npm run build:native

# 开发模式运行
npm run dev

# 构建应用
npm run build
```

## 权限设置

首次运行时，应用需要辅助功能权限才能拦截键盘事件：

1. 系统会弹出权限请求对话框
2. 或手动前往：系统设置 → 隐私与安全 → 辅助功能
3. 添加并启用 `Touchpad Keymap Layer`

## 项目结构

```
src/
├── main/           # 主进程代码
│   ├── state-machine/   # 触摸板状态机
│   ├── keymap/          # 按键映射引擎
│   ├── config/          # 配置管理器
│   ├── native/          # 原生模块 JS 封装
│   ├── tray/            # 菜单栏图标
│   └── window/          # 配置窗口
├── renderer/       # 渲染进程代码
│   └── settings/        # 配置界面
├── native/         # C++/Obj-C++ 原生模块
│   ├── src/             # 实现文件
│   └── include/         # 头文件
└── assets/         # 图标资源
```

## 配置说明

配置文件位于 `~/Library/Application Support/touchpad-keymap-layer/config.json`

默认映射：
- `i` → ↑ (上方向键)
- `k` → ↓ (下方向键)
- `j` → ← (左方向键)
- `l` → → (右方向键)
- `u` → Home (行首)
- `o` → End (行尾)

## 技术栈

- **Electron**: 桌面应用框架
- **TypeScript**: 主/渲染进程代码
- **N-API**: 原生模块绑定
- **IOKit**: macOS 触摸板检测
- **CGEventTap**: macOS 按键拦截与注入
- **Vite**: 构建工具

## 开发注意事项

1. **原生模块**: 修改 `src/native/src/` 后需要重新编译 `npm run build:native`
2. **权限问题**: 开发时如果遇到权限问题，可能需要重启应用
3. **调试**: 主进程日志位于 `~/Library/Logs/touchpad-keymap-layer/`

## 许可

MIT
