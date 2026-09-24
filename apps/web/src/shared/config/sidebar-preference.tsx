import { createContext, useContext, useState, type ReactNode } from 'react'

const storageKey = 'mnemosyne.sidebar.show-icons-when-collapsed'

type SidebarPreference = {
  showIconsWhenCollapsed: boolean
  setShowIconsWhenCollapsed(value: boolean): void
}

const SidebarPreferenceContext = createContext<SidebarPreference | null>(null)

function readPreference(): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

export function SidebarPreferenceProvider({ children }: { children: ReactNode }) {
  const [showIconsWhenCollapsed, setPreference] = useState(readPreference)

  function setShowIconsWhenCollapsed(value: boolean) {
    setPreference(value)
    try {
      localStorage.setItem(storageKey, String(value))
    } catch {
      // Browser storage can be unavailable; this session's setting still works.
    }
  }

  return <SidebarPreferenceContext value={{ showIconsWhenCollapsed, setShowIconsWhenCollapsed }}>
    {children}
  </SidebarPreferenceContext>
}

export function useSidebarPreference(): SidebarPreference {
  const preference = useContext(SidebarPreferenceContext)
  if (!preference) throw new Error('SidebarPreferenceProvider is missing')
  return preference
}
