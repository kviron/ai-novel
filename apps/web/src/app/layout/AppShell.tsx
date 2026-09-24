import { useEffect, useRef, useState } from 'react'
import { BookOpen, Clapperboard, Settings, Users } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { useSidebarPreference } from '@/shared/config'
import { SettingsContent } from '@/pages/settings'
import { routes } from '@/shared/config'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from '@/shared/ui/sidebar'
import { TooltipProvider } from '@/shared/ui/tooltip'

function isSessionPath(pathname: string): boolean {
  return pathname.startsWith('/play/') || /^\/studio\/[^/]+$/.test(pathname)
}

export function AppShell() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(() => !isSessionPath(pathname))

  useEffect(() => { setOpen(!isSessionPath(pathname)) }, [pathname])

  return <TooltipProvider><SidebarProvider open={open} onOpenChange={setOpen}>
    <AppShellContent pathname={pathname} open={open} />
  </SidebarProvider></TooltipProvider>
}

function AppShellContent({ pathname, open }: { pathname: string; open: boolean }) {
  const { showIconsWhenCollapsed } = useSidebarPreference()
  const { setOpenMobile } = useSidebar()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const sessionView = isSessionPath(pathname)

  useEffect(() => { setOpenMobile(false); setSettingsOpen(false) }, [pathname, setOpenMobile])

  return <>
    <Sidebar collapsible={showIconsWhenCollapsed ? 'icon' : 'offcanvas'}>
      <SidebarHeader className="p-4 text-sm font-semibold group-data-[collapsible=icon]:hidden">МНЕМОЗИНА α</SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/' || pathname.startsWith('/play/')} tooltip="Библиотека">
              <Link to={routes.novelLibrary}><BookOpen /><span>Библиотека</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith('/studio')} tooltip="Студия">
              <Link to={routes.studio}><Clapperboard /><span>Студия</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === routes.characters} tooltip="Персонажи">
              <Link to={routes.characters}><Users /><span>Персонажи</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {sessionView ? <SidebarMenuButton ref={settingsTrigger} onClick={() => setSettingsOpen(true)} tooltip="Настройки">
              <Settings /><span>Настройки</span>
            </SidebarMenuButton> : <SidebarMenuButton asChild isActive={pathname === routes.settings} tooltip="Настройки">
              <Link to={routes.settings}><Settings /><span>Настройки</span></Link>
            </SidebarMenuButton>}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
    <SidebarInset className="min-w-0">
      <div className="app-shell-trigger"><SidebarTrigger aria-label={open ? 'Свернуть навигацию' : 'Открыть навигацию'} /></div>
      <Outlet />
    </SidebarInset>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); settingsTrigger.current?.focus() }}>
        <DialogHeader><DialogTitle>Настройки</DialogTitle><DialogDescription>Параметры интерфейса и состояние локальной модели</DialogDescription></DialogHeader>
        <SettingsContent />
      </DialogContent>
    </Dialog>
  </>
}
