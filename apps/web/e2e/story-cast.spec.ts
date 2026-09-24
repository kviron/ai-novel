import { expect, test } from '@playwright/test'

test('автор добавляет персонажа, настраивает цвет и убирает его без потери каталога', async ({ page }) => {
  const [story] = await (await page.request.get('/api/stories')).json() as { id: string }[]
  const created = await page.request.post('/api/characters', { data: {
    name: 'Леон для состава', gender: 'male', age: 29, personality: 'Наблюдательный', appearance: 'Тёмные волосы',
  } })
  expect(created.ok()).toBeTruthy()
  const character = await created.json() as { id: string }

  await page.goto(`/studio/stories/${story.id}/characters`)
  await page.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.getByRole('dialog', { name: 'Добавить персонажей' })).toContainText('Леон для состава')
  await page.getByRole('checkbox', { name: 'Леон для состава' }).check()
  await page.getByRole('button', { name: 'Добавить выбранных' }).click()
  await expect(page.getByText('Леон для состава', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Редактировать Леон для состава' }).click()
  await page.getByRole('textbox', { name: 'Роль в новелле' }).fill('Союзник')
  await page.locator('#cast-color').fill('#3366aa')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Союзник')).toBeVisible()
  const game = await page.request.post(`/api/stories/${story.id}/sessions`, { data: {} })
  expect(game.ok()).toBeTruthy()
  expect((await game.json() as { characters: { id: string; color: string }[] }).characters.find((item) => item.id === character.id)?.color).toBe('#3366AA')

  await page.getByRole('button', { name: 'Удалить Леон для состава' }).click()
  await page.getByRole('button', { name: 'Убрать из новеллы' }).click()
  await expect(page.getByText('Леон для состава', { exact: true })).toHaveCount(0)
  expect((await (await page.request.get(`/api/sessions/${(await game.json()).id}`)).json() as { characters: { id: string }[] }).characters.some((item) => item.id === character.id)).toBeTruthy()
  expect((await page.request.get(`/api/characters/${character.id}`)).ok()).toBeTruthy()
})

test('состав остаётся доступным на узком экране без горизонтального скролла', async ({ page }) => {
  const [story] = await (await page.request.get('/api/stories')).json() as { id: string }[]
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/studio/stories/${story.id}/characters`)
  await expect(page.getByRole('button', { name: 'Добавить' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Редактировать Аканэ/ })).toBeVisible()
  const editBounds = await page.getByRole('button', { name: /Редактировать Аканэ/ }).boundingBox()
  expect(editBounds).not.toBeNull()
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(390)
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
