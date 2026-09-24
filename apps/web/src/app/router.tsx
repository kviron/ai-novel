import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'

import { NovelLibraryPage } from '@/pages/novel-library'
import { StoryPlayerRoute } from '@/pages/story-player'
import { StudioRoute } from '@/pages/studio'
import { routes } from '@/shared/config'

export const routeObjects: RouteObject[] = [
  { path: routes.novelLibrary, element: <NovelLibraryPage /> },
  { path: '/play/:sessionId', element: <StoryPlayerRoute /> },
  { path: routes.studio, element: <StudioRoute /> },
  { path: '/studio/:sessionId', element: <StudioRoute /> },
]

export const router = createBrowserRouter(routeObjects)
