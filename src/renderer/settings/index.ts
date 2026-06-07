import { AppConfig, KeyCombo, KeyMapping, LayerState, RuntimeStatus } from '../../common/types/mapping'
import {
  getKeyLabel,
  isKnownMacKey,
  KeyGroup,
  MAC_KEY_DEFINITIONS,
  MacKey,
  ModifierKey,
  MODIFIER_KEYS
} from '../../common/types/keys'

const KEY_GROUPS: KeyGroup[] = [
  'letter',
  'number',
  'symbol',
  'navigation',
  'function',
  'modifier',
  'keypad'
]

const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  letter: '字母',
  number: '数字',
  symbol: '符号',
  navigation: '导航与控制',
  function: '功能键',
  modifier: '修饰键',
  keypad: '数字小键盘'
}

const MODIFIER_SYMBOLS: Record<ModifierKey, string> = {
  command: '⌘',
  shift: '⇧',
  option: '⌥',
  control: '⌃',
  fn: 'Fn'
}

const DISPLAY_LABELS: Record<string, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  escape: 'Esc',
  delete: 'Del',
  forwarddelete: 'Forward Del',
  return: 'Enter'
}

const CODE_TO_KEY: Record<string, MacKey> = {
  Backquote: 'grave',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'leftbracket',
  BracketRight: 'rightbracket',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Help: 'help',
  Escape: 'escape',
  Space: 'space',
  Enter: 'return',
  Return: 'return',
  Tab: 'tab',
  Backspace: 'delete',
  Delete: 'forwarddelete',
  CapsLock: 'capslock',
  MetaLeft: 'command',
  MetaRight: 'rightcommand',
  ShiftLeft: 'shift',
  ShiftRight: 'rightshift',
  AltLeft: 'option',
  AltRight: 'rightoption',
  ControlLeft: 'control',
  ControlRight: 'rightcontrol',
  Fn: 'fn',
  NumpadDecimal: 'keypaddecimal',
  NumpadMultiply: 'keypadmultiply',
  NumpadAdd: 'keypadplus',
  NumpadClear: 'keypadclear',
  NumpadDivide: 'keypaddivide',
  NumpadEnter: 'keypadenter',
  NumpadSubtract: 'keypadminus',
  NumpadEqual: 'keypadequals'
}

const KEY_BY_NAME = new Map(MAC_KEY_DEFINITIONS.map(definition => [definition.key, definition]))

/**
 * 配置界面控制器
 */
class SettingsController {
  private config: AppConfig | null = null
  private editingIndex: number = -1
  private capturingInput: 'from' | 'to' | null = null
  private targetCombo: KeyCombo = { key: 'up', modifiers: [] }
  private listenersEnabled: boolean = true

  // DOM 元素
  private elements = {
    mappingList: document.getElementById('mapping-list') as HTMLDivElement,
    editSection: document.getElementById('edit-section') as HTMLElement,
    inputFrom: document.getElementById('input-from') as HTMLInputElement,
    inputTo: document.getElementById('input-to') as HTMLInputElement,
    selectTo: document.getElementById('select-to') as HTMLSelectElement,
    modifierList: document.getElementById('modifier-list') as HTMLDivElement,
    btnAdd: document.getElementById('btn-add') as HTMLButtonElement,
    btnSave: document.getElementById('btn-save') as HTMLButtonElement,
    btnCancel: document.getElementById('btn-cancel') as HTMLButtonElement,
    btnReset: document.getElementById('btn-reset') as HTMLButtonElement,
    btnToggleListeners: document.getElementById('btn-toggle-listeners') as HTMLButtonElement,
    listenerStatus: document.getElementById('listener-status') as HTMLParagraphElement,
    layerStatus: document.getElementById('layer-status') as HTMLSpanElement
  }

  constructor() {
    this.populateKeySelect()
    this.bindEvents()
    this.loadConfig()
    this.listenConfigUpdates()
    this.listenLayerStateUpdates()
    this.listenRuntimeStatusUpdates()
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    this.elements.btnAdd.addEventListener('click', () => this.showEditForm())
    this.elements.btnSave.addEventListener('click', () => this.saveMapping())
    this.elements.btnCancel.addEventListener('click', () => this.hideEditForm())
    this.elements.btnReset.addEventListener('click', () => this.resetToDefault())
    this.elements.btnToggleListeners.addEventListener('click', () => this.toggleListeners())

    this.elements.inputFrom.addEventListener('keydown', (e) => this.handleSourceCapture(e))
    this.elements.inputFrom.addEventListener('focus', () => this.startKeyCapture('from'))
    this.elements.inputFrom.addEventListener('blur', () => this.stopKeyCapture())

    this.elements.inputTo.addEventListener('keydown', (e) => this.handleTargetCapture(e))
    this.elements.inputTo.addEventListener('focus', () => this.startKeyCapture('to'))
    this.elements.inputTo.addEventListener('blur', () => this.stopKeyCapture())

    this.elements.selectTo.addEventListener('change', () => {
      this.targetCombo = {
        ...this.targetCombo,
        key: this.elements.selectTo.value
      }
      this.renderTargetControls()
    })

    this.modifierInputs().forEach(input => {
      input.addEventListener('change', () => {
        this.targetCombo = {
          ...this.targetCombo,
          modifiers: this.selectedModifiers()
        }
        this.renderTargetControls()
      })
    })

    document.addEventListener('keydown', (e) => {
      if (this.capturingInput) {
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
    this.elements.layerStatus.textContent = this.listenersEnabled
      ? (state === 'layer2' ? '自定义层已激活' : '正常层')
      : '正常层（监听已关闭）'
  }

  /**
   * 监听运行状态更新
   */
  private async listenRuntimeStatusUpdates(): Promise<void> {
    try {
      const status = await window.api.getRuntimeStatus()
      this.updateRuntimeStatus(status)
    } catch (error) {
      console.error('Failed to load runtime status:', error)
      this.elements.listenerStatus.textContent = '监听状态读取失败'
    }

    window.api.onRuntimeStatusUpdate((status) => {
      this.updateRuntimeStatus(status)
    })
  }

  private updateRuntimeStatus(status: RuntimeStatus): void {
    this.listenersEnabled = status.listenersEnabled
    this.elements.listenerStatus.textContent = status.listenersEnabled
      ? '触摸板和键盘监听已开启'
      : '触摸板和键盘监听已关闭'
    this.elements.btnToggleListeners.textContent = status.listenersEnabled
      ? '关闭监听'
      : '开启监听'
    this.elements.btnToggleListeners.classList.toggle('btn-primary', !status.listenersEnabled)
    this.elements.btnToggleListeners.classList.toggle('btn-secondary', status.listenersEnabled)
    this.updateLayerStatus(status.layerState)
  }

  private async toggleListeners(): Promise<void> {
    const nextEnabled = !this.listenersEnabled
    this.elements.btnToggleListeners.disabled = true

    try {
      const status = await window.api.setListenersEnabled(nextEnabled)
      this.updateRuntimeStatus(status)
    } catch (error) {
      console.error('Failed to toggle listeners:', error)
      this.showError(nextEnabled ? '开启监听失败，请检查辅助功能权限' : '关闭监听失败')
    } finally {
      this.elements.btnToggleListeners.disabled = false
    }
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
          <span class="mapping-key combo-key">${this.formatCombo(mapping.to)}</span>
        </div>
        <div class="mapping-actions">
          <button class="btn btn-icon btn-secondary" data-action="edit" data-index="${index}">编辑</button>
          <button class="btn btn-icon btn-danger" data-action="delete" data-index="${index}">删除</button>
        </div>
      </div>
    `).join('')

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
    return DISPLAY_LABELS[key] || getKeyLabel(key)
  }

  /**
   * 格式化组合键显示
   */
  private formatCombo(combo: KeyCombo): string {
    return [...combo.modifiers.map(modifier => MODIFIER_SYMBOLS[modifier]), this.formatKey(combo.key)].join(' + ')
  }

  /**
   * 显示编辑表单
   */
  private showEditForm(index: number = -1): void {
    this.editingIndex = index
    this.elements.editSection.classList.remove('hidden')

    if (index >= 0 && this.config) {
      const mapping = this.config.mappings[index]
      this.elements.inputFrom.value = mapping.from
      this.targetCombo = {
        key: mapping.to.key,
        modifiers: [...mapping.to.modifiers]
      }
    } else {
      this.elements.inputFrom.value = ''
      this.targetCombo = { key: 'up', modifiers: [] }
    }

    this.renderTargetControls()
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
  private startKeyCapture(input: 'from' | 'to'): void {
    this.capturingInput = input
    const element = input === 'from' ? this.elements.inputFrom : this.elements.inputTo
    element.classList.add('capturing')
    element.placeholder = input === 'from' ? '按下任意源按键...' : '按下目标组合键...'
  }

  /**
   * 停止按键捕获
   */
  private stopKeyCapture(): void {
    this.capturingInput = null
    this.elements.inputFrom.classList.remove('capturing')
    this.elements.inputTo.classList.remove('capturing')
    this.elements.inputFrom.placeholder = '点击输入按键...'
    this.elements.inputTo.placeholder = '点击输入组合键...'
  }

  /**
   * 处理源按键捕获
   */
  private handleSourceCapture(e: KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()

    const key = this.keyboardEventToMacKey(e)
    if (!key) {
      return
    }

    this.elements.inputFrom.value = key
    this.elements.inputFrom.blur()
  }

  /**
   * 处理目标组合键捕获
   */
  private handleTargetCapture(e: KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()

    const key = this.keyboardEventToMacKey(e)
    if (!key) {
      return
    }

    const mainModifier = KEY_BY_NAME.get(key)?.modifier
    const modifiers = this.eventModifiers(e).filter(modifier => modifier !== mainModifier)

    this.targetCombo = { key, modifiers }
    this.renderTargetControls()
    this.elements.inputTo.blur()
  }

  /**
   * 保存映射
   */
  private async saveMapping(): Promise<void> {
    if (!this.config) return

    const from = this.elements.inputFrom.value.trim().toLowerCase()
    const to = {
      key: this.targetCombo.key,
      modifiers: [...this.targetCombo.modifiers]
    }

    if (!from || !isKnownMacKey(from)) {
      this.showError('请输入有效的源按键')
      return
    }

    if (!isKnownMacKey(to.key)) {
      this.showError('请选择有效的目标主按键')
      return
    }

    const existingIndex = this.config.mappings.findIndex(m => m.from === from)
    if (existingIndex >= 0 && existingIndex !== this.editingIndex) {
      this.showError('该按键已有映射')
      return
    }

    const newMapping: KeyMapping = { from, to, toType: 'combo' }
    const newConfig: AppConfig = { ...this.config }

    if (this.editingIndex >= 0) {
      newConfig.mappings = [...newConfig.mappings]
      newConfig.mappings[this.editingIndex] = newMapping
    } else {
      newConfig.mappings = [...newConfig.mappings, newMapping]
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

  private populateKeySelect(): void {
    this.elements.selectTo.innerHTML = KEY_GROUPS.map(group => {
      const options = MAC_KEY_DEFINITIONS
        .filter(definition => definition.group === group)
        .map(definition => `<option value="${definition.key}">${definition.label}</option>`)
        .join('')

      return `<optgroup label="${KEY_GROUP_LABELS[group]}">${options}</optgroup>`
    }).join('')
  }

  private renderTargetControls(): void {
    this.elements.inputTo.value = this.formatCombo(this.targetCombo)
    this.elements.selectTo.value = this.targetCombo.key

    this.modifierInputs().forEach(input => {
      input.checked = this.targetCombo.modifiers.includes(input.value as ModifierKey)
    })
  }

  private modifierInputs(): HTMLInputElement[] {
    return Array.from(this.elements.modifierList.querySelectorAll('input[type="checkbox"]'))
  }

  private selectedModifiers(): ModifierKey[] {
    const selected = new Set(
      this.modifierInputs()
        .filter(input => input.checked)
        .map(input => input.value as ModifierKey)
    )

    return MODIFIER_KEYS.filter(modifier => selected.has(modifier))
  }

  private eventModifiers(e: KeyboardEvent): ModifierKey[] {
    const modifiers: ModifierKey[] = []
    if (e.metaKey) modifiers.push('command')
    if (e.shiftKey) modifiers.push('shift')
    if (e.altKey) modifiers.push('option')
    if (e.ctrlKey) modifiers.push('control')

    const key = e.key.toLowerCase()
    if (key === 'fn' || key === 'function') {
      modifiers.push('fn')
    }

    return modifiers
  }

  private keyboardEventToMacKey(e: KeyboardEvent): MacKey | null {
    const code = e.code

    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3).toLowerCase()
    }

    if (/^Digit[0-9]$/.test(code)) {
      return code.slice(5)
    }

    if (/^Numpad[0-9]$/.test(code)) {
      return `keypad${code.slice(6)}`
    }

    if (/^F([1-9]|1[0-9]|20)$/.test(code)) {
      return code.toLowerCase()
    }

    if (CODE_TO_KEY[code]) {
      return CODE_TO_KEY[code]
    }

    const key = e.key.toLowerCase()
    if (/^[a-z0-9]$/.test(key) && isKnownMacKey(key)) {
      return key
    }

    const fallbackKeys: Record<string, MacKey> = {
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
      pageup: 'pageup',
      pagedown: 'pagedown',
      escape: 'escape',
      esc: 'escape',
      enter: 'return',
      return: 'return',
      backspace: 'delete',
      delete: 'forwarddelete',
      ' ': 'space'
    }

    return fallbackKeys[key] || null
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
