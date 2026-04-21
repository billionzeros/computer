/**
 * Account domain store — local-only profile (display name + avatar color).
 * No auth, no sync. Persisted to localStorage on this machine.
 */

import { create } from 'zustand'

export const ACCOUNT_COLORS = [
  { id: 'blue', value: '#6C8CFF' },
  { id: 'green', value: '#4ECB71' },
  { id: 'purple', value: '#B57EFF' },
  { id: 'orange', value: '#FF8A4C' },
  { id: 'pink', value: '#FF6F91' },
  { id: 'teal', value: '#3CC8B4' },
] as const

export type AccountColorId = (typeof ACCOUNT_COLORS)[number]['id']

const DEFAULT_NAME = 'Anton'
const DEFAULT_COLOR: AccountColorId = 'blue'

interface AccountState {
  displayName: string
  avatarColor: AccountColorId
  setDisplayName: (name: string) => void
  setAvatarColor: (color: AccountColorId) => void
  reset: () => void
}

function loadName(): string {
  const saved = localStorage.getItem('anton-account.name')
  return saved && saved.trim() ? saved : DEFAULT_NAME
}

function loadColor(): AccountColorId {
  const saved = localStorage.getItem('anton-account.color') as AccountColorId | null
  if (saved && ACCOUNT_COLORS.some((c) => c.id === saved)) return saved
  return DEFAULT_COLOR
}

export const accountStore = create<AccountState>((set) => ({
  displayName: loadName(),
  avatarColor: loadColor(),
  setDisplayName: (name) => {
    const trimmed = name.trim() || DEFAULT_NAME
    localStorage.setItem('anton-account.name', trimmed)
    set({ displayName: trimmed })
  },
  setAvatarColor: (color) => {
    localStorage.setItem('anton-account.color', color)
    set({ avatarColor: color })
  },
  reset: () => {
    localStorage.removeItem('anton-account.name')
    localStorage.removeItem('anton-account.color')
    set({ displayName: DEFAULT_NAME, avatarColor: DEFAULT_COLOR })
  },
}))

export function avatarInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'A'
}

export function accountColorValue(id: AccountColorId): string {
  return ACCOUNT_COLORS.find((c) => c.id === id)?.value ?? ACCOUNT_COLORS[0].value
}
