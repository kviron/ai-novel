import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom'

import { SidebarPreferenceProvider } from '@/shared/config'
import { AppShell } from './layout/AppShell'
import { NovelLibraryPage } from '@/pages/novel-library'
import { CharacterDetailPage, CharacterEditorPage, CharactersPage } from '@/pages/characters'
import { SettingsPage } from '@/pages/settings'
import { StoryPlayerRoute } from '@/pages/story-player'
import { StudioRoute } from '@/pages/studio'
import { StoryCastPage } from '@/pages/story-cast'
import { routes } from '@/shared/config'

export const routeObjects: RouteObject[] = [
  {
    path: routes.novelLibrary,
    element: <SidebarPreferenceProvider><AppShell /></SidebarPreferenceProvider>,
    children: [
      { index: true, element: <NovelLibraryPage /> },
      { path: 'play/:sessionId', element: <StoryPlayerRoute /> },
      { path: 'studio', element: <StudioRoute /> },
      { path: 'studio/stories/:storyId/characters', element: <StoryCastPage /> },
      { path: 'studio/:sessionId', element: <StudioRoute /> },
      { path: 'characters', element: <CharactersPage /> },
      { path: 'characters/new', element: <CharacterEditorPage /> },
      { path: 'characters/:characterId/edit', element: <CharacterEditorPage /> },
      { path: 'characters/:characterId', element: <CharacterDetailPage /> },
      { path: 'characters/:storyId/:characterId', element: <LegacyCharacterRedirect /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]

export const router = createBrowserRouter(routeObjects)

function LegacyCharacterRedirect() {
  const { characterId } = useParams()
  return <Navigate to={characterId ? routes.characterDetail(characterId) : routes.characters} replace />
}
