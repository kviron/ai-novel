import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { SidebarPreferenceProvider, useSidebarPreference } from './sidebar-preference'

function Probe() {
  const { showIconsWhenCollapsed, setShowIconsWhenCollapsed } = useSidebarPreference()
  return <button onClick={() => setShowIconsWhenCollapsed(!showIconsWhenCollapsed)}>{String(showIconsWhenCollapsed)}</button>
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

test('defaults to full hide and persists icon preference', async () => {
  localStorage.clear()
  render(<SidebarPreferenceProvider><Probe /></SidebarPreferenceProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'false' }))
  expect(screen.getByRole('button', { name: 'true' })).toBeInTheDocument()
  expect(localStorage.getItem('mnemosyne.sidebar.show-icons-when-collapsed')).toBe('true')
})

test('uses saved preference after remount', () => {
  localStorage.setItem('mnemosyne.sidebar.show-icons-when-collapsed', 'true')
  render(<SidebarPreferenceProvider><Probe /></SidebarPreferenceProvider>)
  expect(screen.getByRole('button', { name: 'true' })).toBeInTheDocument()
})

test('continues with in-memory state when storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  render(<SidebarPreferenceProvider><Probe /></SidebarPreferenceProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'false' }))
  expect(screen.getByRole('button', { name: 'true' })).toBeInTheDocument()
})
