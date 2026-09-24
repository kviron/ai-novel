import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'

import { SidebarPreferenceProvider } from '@/shared/config'
import { AppShell } from './layout/AppShell'
import { NovelLibraryPage } from '@/pages/novel-library'
import { CharactersPage } from '@/pages/characters'
import { SettingsPage } from '@/pages/settings'
import { StoryPlayerRoute } from '@/pages/story-player'
import { StudioRoute } from '@/pages/studio'
import { routes } from '@/shared/config'

export const routeObjects: RouteObject[] = [
  {
    path: routes.novelLibrary,
    element: <SidebarPreferenceProvider><AppShell /></SidebarPreferenceProvider>,
    children: [
      { index: true, element: <NovelLibraryPage /> },
      { path: 'play/:sessionId', element: <StoryPlayerRoute /> },
      { path: 'studio', element: <StudioRoute /> },
      { path: 'studio/:sessionId', element: <StudioRoute /> },
      { path: 'characters', element: <CharactersPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]

export const router = createBrowserRouter(routeObjects)
