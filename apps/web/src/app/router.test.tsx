import { expect, test } from 'vitest'

import { routeObjects } from './router'

test('все экраны наследуют единую оболочку', () => {
  expect(routeObjects).toHaveLength(1)
  expect(routeObjects[0].path).toBe('/')
  expect(routeObjects[0].children?.map(({ path, index }) => index ? '(index)' : path)).toEqual([
    '(index)', 'play/:sessionId', 'studio', 'studio/:sessionId',
  ])
})
