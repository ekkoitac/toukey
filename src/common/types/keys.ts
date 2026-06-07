export type ModifierKey = 'command' | 'shift' | 'option' | 'control' | 'fn'

export type MacKey = string

export type KeyGroup =
  | 'letter'
  | 'number'
  | 'symbol'
  | 'navigation'
  | 'function'
  | 'modifier'
  | 'keypad'

export interface MacKeyDefinition {
  key: MacKey
  label: string
  group: KeyGroup
  keyCode: number
  modifier?: ModifierKey
}

export const MODIFIER_KEYS: ModifierKey[] = ['command', 'shift', 'option', 'control', 'fn']

export const MAC_KEY_DEFINITIONS: MacKeyDefinition[] = [
  { key: 'a', label: 'A', group: 'letter', keyCode: 0x00 },
  { key: 'b', label: 'B', group: 'letter', keyCode: 0x0B },
  { key: 'c', label: 'C', group: 'letter', keyCode: 0x08 },
  { key: 'd', label: 'D', group: 'letter', keyCode: 0x02 },
  { key: 'e', label: 'E', group: 'letter', keyCode: 0x0E },
  { key: 'f', label: 'F', group: 'letter', keyCode: 0x03 },
  { key: 'g', label: 'G', group: 'letter', keyCode: 0x05 },
  { key: 'h', label: 'H', group: 'letter', keyCode: 0x04 },
  { key: 'i', label: 'I', group: 'letter', keyCode: 0x22 },
  { key: 'j', label: 'J', group: 'letter', keyCode: 0x26 },
  { key: 'k', label: 'K', group: 'letter', keyCode: 0x28 },
  { key: 'l', label: 'L', group: 'letter', keyCode: 0x25 },
  { key: 'm', label: 'M', group: 'letter', keyCode: 0x2E },
  { key: 'n', label: 'N', group: 'letter', keyCode: 0x2D },
  { key: 'o', label: 'O', group: 'letter', keyCode: 0x1F },
  { key: 'p', label: 'P', group: 'letter', keyCode: 0x23 },
  { key: 'q', label: 'Q', group: 'letter', keyCode: 0x0C },
  { key: 'r', label: 'R', group: 'letter', keyCode: 0x0F },
  { key: 's', label: 'S', group: 'letter', keyCode: 0x01 },
  { key: 't', label: 'T', group: 'letter', keyCode: 0x11 },
  { key: 'u', label: 'U', group: 'letter', keyCode: 0x20 },
  { key: 'v', label: 'V', group: 'letter', keyCode: 0x09 },
  { key: 'w', label: 'W', group: 'letter', keyCode: 0x0D },
  { key: 'x', label: 'X', group: 'letter', keyCode: 0x07 },
  { key: 'y', label: 'Y', group: 'letter', keyCode: 0x10 },
  { key: 'z', label: 'Z', group: 'letter', keyCode: 0x06 },

  { key: '1', label: '1', group: 'number', keyCode: 0x12 },
  { key: '2', label: '2', group: 'number', keyCode: 0x13 },
  { key: '3', label: '3', group: 'number', keyCode: 0x14 },
  { key: '4', label: '4', group: 'number', keyCode: 0x15 },
  { key: '5', label: '5', group: 'number', keyCode: 0x17 },
  { key: '6', label: '6', group: 'number', keyCode: 0x16 },
  { key: '7', label: '7', group: 'number', keyCode: 0x1A },
  { key: '8', label: '8', group: 'number', keyCode: 0x1C },
  { key: '9', label: '9', group: 'number', keyCode: 0x19 },
  { key: '0', label: '0', group: 'number', keyCode: 0x1D },

  { key: 'minus', label: '-', group: 'symbol', keyCode: 0x1B },
  { key: 'equal', label: '=', group: 'symbol', keyCode: 0x18 },
  { key: 'leftbracket', label: '[', group: 'symbol', keyCode: 0x21 },
  { key: 'rightbracket', label: ']', group: 'symbol', keyCode: 0x1E },
  { key: 'backslash', label: '\\', group: 'symbol', keyCode: 0x2A },
  { key: 'semicolon', label: ';', group: 'symbol', keyCode: 0x29 },
  { key: 'quote', label: "'", group: 'symbol', keyCode: 0x27 },
  { key: 'grave', label: '`', group: 'symbol', keyCode: 0x32 },
  { key: 'comma', label: ',', group: 'symbol', keyCode: 0x2B },
  { key: 'period', label: '.', group: 'symbol', keyCode: 0x2F },
  { key: 'slash', label: '/', group: 'symbol', keyCode: 0x2C },

  { key: 'up', label: 'Up', group: 'navigation', keyCode: 0x7E },
  { key: 'down', label: 'Down', group: 'navigation', keyCode: 0x7D },
  { key: 'left', label: 'Left', group: 'navigation', keyCode: 0x7B },
  { key: 'right', label: 'Right', group: 'navigation', keyCode: 0x7C },
  { key: 'home', label: 'Home', group: 'navigation', keyCode: 0x73 },
  { key: 'end', label: 'End', group: 'navigation', keyCode: 0x77 },
  { key: 'pageup', label: 'Page Up', group: 'navigation', keyCode: 0x74 },
  { key: 'pagedown', label: 'Page Down', group: 'navigation', keyCode: 0x79 },
  { key: 'help', label: 'Help', group: 'navigation', keyCode: 0x72 },
  { key: 'escape', label: 'Esc', group: 'navigation', keyCode: 0x35 },
  { key: 'space', label: 'Space', group: 'navigation', keyCode: 0x31 },
  { key: 'return', label: 'Return', group: 'navigation', keyCode: 0x24 },
  { key: 'tab', label: 'Tab', group: 'navigation', keyCode: 0x30 },
  { key: 'delete', label: 'Delete', group: 'navigation', keyCode: 0x33 },
  { key: 'forwarddelete', label: 'Forward Delete', group: 'navigation', keyCode: 0x75 },
  { key: 'capslock', label: 'Caps Lock', group: 'navigation', keyCode: 0x39 },

  { key: 'f1', label: 'F1', group: 'function', keyCode: 0x7A },
  { key: 'f2', label: 'F2', group: 'function', keyCode: 0x78 },
  { key: 'f3', label: 'F3', group: 'function', keyCode: 0x63 },
  { key: 'f4', label: 'F4', group: 'function', keyCode: 0x76 },
  { key: 'f5', label: 'F5', group: 'function', keyCode: 0x60 },
  { key: 'f6', label: 'F6', group: 'function', keyCode: 0x61 },
  { key: 'f7', label: 'F7', group: 'function', keyCode: 0x62 },
  { key: 'f8', label: 'F8', group: 'function', keyCode: 0x64 },
  { key: 'f9', label: 'F9', group: 'function', keyCode: 0x65 },
  { key: 'f10', label: 'F10', group: 'function', keyCode: 0x6D },
  { key: 'f11', label: 'F11', group: 'function', keyCode: 0x67 },
  { key: 'f12', label: 'F12', group: 'function', keyCode: 0x6F },
  { key: 'f13', label: 'F13', group: 'function', keyCode: 0x69 },
  { key: 'f14', label: 'F14', group: 'function', keyCode: 0x6B },
  { key: 'f15', label: 'F15', group: 'function', keyCode: 0x71 },
  { key: 'f16', label: 'F16', group: 'function', keyCode: 0x6A },
  { key: 'f17', label: 'F17', group: 'function', keyCode: 0x40 },
  { key: 'f18', label: 'F18', group: 'function', keyCode: 0x4F },
  { key: 'f19', label: 'F19', group: 'function', keyCode: 0x50 },
  { key: 'f20', label: 'F20', group: 'function', keyCode: 0x5A },

  { key: 'command', label: 'Command', group: 'modifier', keyCode: 0x37, modifier: 'command' },
  { key: 'rightcommand', label: 'Right Command', group: 'modifier', keyCode: 0x36, modifier: 'command' },
  { key: 'shift', label: 'Shift', group: 'modifier', keyCode: 0x38, modifier: 'shift' },
  { key: 'rightshift', label: 'Right Shift', group: 'modifier', keyCode: 0x3C, modifier: 'shift' },
  { key: 'option', label: 'Option', group: 'modifier', keyCode: 0x3A, modifier: 'option' },
  { key: 'rightoption', label: 'Right Option', group: 'modifier', keyCode: 0x3D, modifier: 'option' },
  { key: 'control', label: 'Control', group: 'modifier', keyCode: 0x3B, modifier: 'control' },
  { key: 'rightcontrol', label: 'Right Control', group: 'modifier', keyCode: 0x3E, modifier: 'control' },
  { key: 'fn', label: 'Fn', group: 'modifier', keyCode: 0x3F, modifier: 'fn' },

  { key: 'keypad0', label: 'Keypad 0', group: 'keypad', keyCode: 0x52 },
  { key: 'keypad1', label: 'Keypad 1', group: 'keypad', keyCode: 0x53 },
  { key: 'keypad2', label: 'Keypad 2', group: 'keypad', keyCode: 0x54 },
  { key: 'keypad3', label: 'Keypad 3', group: 'keypad', keyCode: 0x55 },
  { key: 'keypad4', label: 'Keypad 4', group: 'keypad', keyCode: 0x56 },
  { key: 'keypad5', label: 'Keypad 5', group: 'keypad', keyCode: 0x57 },
  { key: 'keypad6', label: 'Keypad 6', group: 'keypad', keyCode: 0x58 },
  { key: 'keypad7', label: 'Keypad 7', group: 'keypad', keyCode: 0x59 },
  { key: 'keypad8', label: 'Keypad 8', group: 'keypad', keyCode: 0x5B },
  { key: 'keypad9', label: 'Keypad 9', group: 'keypad', keyCode: 0x5C },
  { key: 'keypaddecimal', label: 'Keypad .', group: 'keypad', keyCode: 0x41 },
  { key: 'keypadmultiply', label: 'Keypad *', group: 'keypad', keyCode: 0x43 },
  { key: 'keypadplus', label: 'Keypad +', group: 'keypad', keyCode: 0x45 },
  { key: 'keypadclear', label: 'Keypad Clear', group: 'keypad', keyCode: 0x47 },
  { key: 'keypaddivide', label: 'Keypad /', group: 'keypad', keyCode: 0x4B },
  { key: 'keypadenter', label: 'Keypad Enter', group: 'keypad', keyCode: 0x4C },
  { key: 'keypadminus', label: 'Keypad -', group: 'keypad', keyCode: 0x4E },
  { key: 'keypadequals', label: 'Keypad =', group: 'keypad', keyCode: 0x51 }
]

export const MACOS_KEY_CODES: Record<string, number> = Object.fromEntries(
  MAC_KEY_DEFINITIONS.map(({ key, keyCode }) => [key, keyCode])
)

export const REVERSE_KEY_CODES: Record<number, string> = Object.fromEntries(
  MAC_KEY_DEFINITIONS.map(({ key, keyCode }) => [keyCode, key])
)

export const KEY_LABELS: Record<string, string> = Object.fromEntries(
  MAC_KEY_DEFINITIONS.map(({ key, label }) => [key, label])
)

export function isKnownMacKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(MACOS_KEY_CODES, key)
}

export function getKeyLabel(key: string): string {
  return KEY_LABELS[key] || key.toUpperCase()
}
