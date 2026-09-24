import { expect, test } from 'vitest'

import { routeObjects } from './router'

test('разделяет маршруты игрока и Студии', () => {
  expect(routeObjects.map((route) => route.path)).toEqual(expect.arrayContaining([
    '/play/:sessionId',
    '/studio',
    '/studio/:sessionId',
  ]))
})
