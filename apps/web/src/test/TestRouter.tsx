import { RouterProvider, createMemoryRouter } from 'react-router-dom'

import { routeObjects } from '@/app/router'

export function TestRouter({ initialEntries }: { initialEntries: string[] }) {
  return <RouterProvider router={createMemoryRouter(routeObjects, { initialEntries })} />
}
