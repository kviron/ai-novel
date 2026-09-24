import { useEffect, useState } from 'react'
import { BookOpen, Clapperboard, Users } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { useSidebarPreference } from '@/app/model/sidebar-preference'
import { routes } from '@/shared/config'
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/shared/ui/sidebar'
import { TooltipProvider } from '@/shared/ui/tooltip'

function isSessionPath(pathname: string): boolean {
  return pathname.startsWith('/play/') || /^\/studio\/[^/]+$/.test(pathname)
}

export function AppShell() {
  const { pathname } = useLocation()
  const { showIconsWhenCollapsed } = useSidebarPreference()
  const [open, setOpen] = useState(() => !isSessionPath(pathname))

  useEffect(() => { setOpen(!isSessionPath(pathname)) }, [pathname])

  return <TooltipProvider><SidebarProvider open={open} onOpenChange={setOpen}>
    <Sidebar collapsible={showIconsWhenCollapsed ? 'icon' : 'offcanvas'}>
      <SidebarHeader className="p-4 text-sm font-semibold">МНЕМОЗИНА α</SidebarHeader>
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
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
    <SidebarInset className="min-w-0">
      <div className="app-shell-trigger"><SidebarTrigger aria-label="Открыть навигацию" /></div>
      <Outlet />
    </SidebarInset>
  </SidebarProvider></TooltipProvider>
}
