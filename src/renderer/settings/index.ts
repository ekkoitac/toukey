import { AppConfig, KeyMapping, LayerState } from '../../common/types/mapping'

/**
 * 配置界面控制器
 */
class SettingsController {
  private config: AppConfig | null = null
  private editingIndex: number = -1
  private capturingKey: boolean = false

  // DOM 元素
  private elements = {
    mappingList: document.getElementById('mapping-list') as HTMLDivElement,
    editSection: document.getElementById('edit-section') as HTMLElement,
    inputFrom: document.getElementById('input-from') as HTMLInputElement,
    selectTo: document.getElementById('select-to') as HTMLSelectElement,
    btnAdd: document.getElementById('btn-add') as HTMLButtonElement,
    btnSave: document.getElementById('btn-save') as HTMLButtonElement,
    btnCancel: document.getElementById('btn-cancel') as HTMLButtonElement,
    btnReset: document.getElementById('btn-reset') as HTMLButtonElement,
    layerStatus: document.getElementById('layer-status') as HTMLSpanElement
  }

  constructor() {
    this.bindEvents()
    this.loadConfig()
    this.listenConfigUpdates()
    this.listenLayerStateUpdates()
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 添加按钮
    this.elements.btnAdd.addEventListener('click', () => this.showEditForm())

    // 保存按钮
    this.elements.btnSave.addEventListener('click', () => this.saveMapping())

    // 取消按钮
    this.elements.btnCancel.addEventListener('click', () => this.hideEditForm())

    // 重置按钮
    this.elements.btnReset.addEventListener('click', () => this.resetToDefault())

    // 按键捕获
    this.elements.inputFrom.addEventListener('keydown', (e) => this.handleKeyCapture(e))
    this.elements.inputFrom.addEventListener('focus', () => this.startKeyCapture())
    this.elements.inputFrom.addEventListener('blur', () => this.stopKeyCapture())

    // 键盘全局监听（用于捕获）
    document.addEventListener('keydown', (e) => {
      if (this.capturingKey) {
        e.preventDefault()
      }
    })
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      this.config = await window.api.getConfig()
      this.renderMappingList()
    } catch (error) {
      console.error('Failed to load config:', error)
      this.showError('加载配置失败')
    }
  }

  /**
   * 监听配置更新
   */
  private listenConfigUpdates(): void {
    window.api.onConfigUpdate((config) => {
      this.config = config
      this.renderMappingList()
    })
  }

  /**
   * 监听层状态更新
   */
  private async listenLayerStateUpdates(): Promise<void> {
    try {
      const state = await window.api.getLayerState()
      this.updateLayerStatus(state)
    } catch (error) {
      console.error('Failed to load layer state:', error)
    }

    window.api.onLayerStateUpdate((state) => {
      this.updateLayerStatus(state)
    })
  }

  private updateLayerStatus(state: LayerState): void {
    this.elements.layerStatus.textContent =
      state === 'layer2' ? '自定义层已激活' : '正常层'
  }

  /**
   * 渲染映射列表
   */
  private renderMappingList(): void {
    if (!this.config || this.config.mappings.length === 0) {
      this.elements.mappingList.innerHTML = '<div class="mapping-empty">暂无自定义映射，点击「添加映射」开始</div>'
      return
    }

    this.elements.mappingList.innerHTML = this.config.mappings.map((mapping, index) => `
      <div class="mapping-item" data-index="${index}">
        <div class="mapping-info">
          <span class="mapping-key">${this.formatKey(mapping.from)}</span>
          <span class="mapping-arrow">→</span>
          <span class="mapping-key">${this.formatTarget(mapping.to)}</span>
        </div>
        <div class="mapping-actions">
          <button class="btn btn-icon btn-secondary" data-action="edit" data-index="${index}">编辑</button>
          <button class="btn btn-icon btn-danger" data-action="delete" data-index="${index}">删除</button>
        </div>
      </div>
    `).join('')

    // 绑定列表项事件
    this.elements.mappingList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const action = target.dataset.action
        const index = parseInt(target.dataset.index || '-1')

        if (action === 'edit') {
          this.editMapping(index)
        } else if (action === 'delete') {
          this.deleteMapping(index)
        }
      })
    })
  }

  /**
   * 格式化按键显示
   */
  private formatKey(key: string): string {
    const keyMap: Record<string, string> = {
      'up': '↑',
      'down': '↓',
      'left': '←',
      'right': '→',
      'home': 'Home',
      'end': 'End',
      'pageup': 'PgUp',
      'pagedown': 'PgDn',
      'escape': 'Esc',
      'delete': 'Del',
      'space': 'Space',
      'return': 'Enter',
      'tab': 'Tab'
    }
    return keyMap[key] || key.toUpperCase()
  }

  /**
   * 格式化目标显示
   */
  private formatTarget(target: string): string {
    return this.formatKey(target)
  }

  /**
   * 显示编辑表单
   */
  private showEditForm(index: number = -1): void {
    this.editingIndex = index
    this.elements.editSection.classList.remove('hidden')

    if (index >= 0 && this.config) {
      // 编辑模式
      const mapping = this.config.mappings[index]
      this.elements.inputFrom.value = mapping.from
      this.elements.selectTo.value = mapping.to
    } else {
      // 添加模式
      this.elements.inputFrom.value = ''
      this.elements.selectTo.value = 'up'
    }
  }

  /**
   * 隐藏编辑表单
   */
  private hideEditForm(): void {
    this.elements.editSection.classList.add('hidden')
    this.editingIndex = -1
    this.stopKeyCapture()
  }

  /**
   * 开始按键捕获
   */
  private startKeyCapture(): void {
    this.capturingKey = true
    this.elements.inputFrom.classList.add('capturing')
    this.elements.inputFrom.placeholder = '按下任意键...'
  }

  /**
   * 停止按键捕获
   */
  private stopKeyCapture(): void {
    this.capturingKey = false
    this.elements.inputFrom.classList.remove('capturing')
    this.elements.inputFrom.placeholder = '点击输入按键...'
  }

  /**
   * 处理按键捕获
   */
  private handleKeyCapture(e: KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()

    // 获取按键字符
    let key = e.key.toLowerCase()

    // 特殊键映射
    const specialKeys: Record<string, string> = {
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      'home': 'home',
      'end': 'end',
      'pageup': 'pageup',
      'pagedown': 'pagedown',
      'escape': 'escape',
      'delete': 'delete',
      ' ': 'space',
      'enter': 'return',
      'tab': 'tab'
    }

    key = specialKeys[key] || key

    // 过滤无效按键（控制键等）
    if (key.length > 1 && !specialKeys[key]) {
      return
    }

    this.elements.inputFrom.value = key
    this.elements.inputFrom.blur()
  }

  /**
   * 保存映射
   */
  private async saveMapping(): Promise<void> {
    if (!this.config) return

    const from = this.elements.inputFrom.value.trim().toLowerCase()
    const to = this.elements.selectTo.value

    if (!from) {
      this.showError('请输入源按键')
      return
    }

    // 检查重复
    const existingIndex = this.config.mappings.findIndex(m => m.from === from)
    if (existingIndex >= 0 && existingIndex !== this.editingIndex) {
      this.showError('该按键已有映射')
      return
    }

    // 创建新配置
    const newConfig: AppConfig = { ...this.config }

    if (this.editingIndex >= 0) {
      // 更新现有映射
      newConfig.mappings = [...newConfig.mappings]
      newConfig.mappings[this.editingIndex] = { from, to, toType: 'key' }
    } else {
      // 添加新映射
      newConfig.mappings = [...newConfig.mappings, { from, to, toType: 'key' }]
    }

    try {
      await window.api.saveConfig(newConfig)
      this.hideEditForm()
      this.showSuccess('保存成功')
    } catch (error) {
      console.error('Failed to save config:', error)
      this.showError('保存失败')
    }
  }

  /**
   * 编辑映射
   */
  private editMapping(index: number): void {
    this.showEditForm(index)
  }

  /**
   * 删除映射
   */
  private async deleteMapping(index: number): Promise<void> {
    if (!this.config) return

    const newConfig: AppConfig = {
      ...this.config,
      mappings: this.config.mappings.filter((_, i) => i !== index)
    }

    try {
      await window.api.saveConfig(newConfig)
      this.showSuccess('删除成功')
    } catch (error) {
      console.error('Failed to delete mapping:', error)
      this.showError('删除失败')
    }
  }

  /**
   * 重置为默认
   */
  private async resetToDefault(): Promise<void> {
    if (!confirm('确定要恢复默认配置吗？所有自定义映射将被清除。')) {
      return
    }

    try {
      await window.api.resetToDefault()
      this.hideEditForm()
      this.showSuccess('已恢复默认配置')
    } catch (error) {
      console.error('Failed to reset config:', error)
      this.showError('重置失败')
    }
  }

  /**
   * 显示错误提示
   */
  private showError(message: string): void {
    // 简单的 alert，后续可以改为 toast
    alert(`❌ ${message}`)
  }

  /**
   * 显示成功提示
   */
  private showSuccess(message: string): void {
    // 简单的 alert，后续可以改为 toast
    alert(`✅ ${message}`)
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new SettingsController()
})
