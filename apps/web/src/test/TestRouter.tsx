import { RouterProvider, createMemoryRouter } from 'react-router-dom'

import { routeObjects } from '@/app/router'

export type TestRouterInstance = ReturnType<typeof createMemoryRouter>

export function TestRouter({ initialEntries, initialIndex, onRouter }: { initialEntries: string[]; initialIndex?: number; onRouter?: (router: TestRouterInstance) => void }) {
  const router = createMemoryRouter(routeObjects, { initialEntries, initialIndex })
  onRouter?.(router)
  return <RouterProvider router={router} />
}
