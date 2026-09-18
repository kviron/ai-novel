import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'

import { NovelLibraryPage } from '@/pages/novel-library'
import { StoryPlayerRoute } from '@/pages/story-player'
import { routes } from '@/shared/config'

export const routeObjects: RouteObject[] = [
  { path: routes.novelLibrary, element: <NovelLibraryPage /> },
  { path: '/play/:sessionId', element: <StoryPlayerRoute /> },
]

export const router = createBrowserRouter(routeObjects)
