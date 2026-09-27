import { expect, test } from '@playwright/test'

test('устаревший экран состава не меняет опубликованную версию и сохраняет персонажа в каталоге', async ({ page }) => {
  const stories = await (await page.request.get('/api/stories')).json() as { id: string; title: string }[]
  const story = stories.find(({ title }) => title === 'Эхо неона')!
  const created = await page.request.post('/api/characters', { data: {
    name: 'Леон для состава', gender: 'male', age: 29, personality: 'Наблюдательный', appearance: 'Тёмные волосы',
  } })
  expect(created.ok()).toBeTruthy()
  const character = await created.json() as { id: string }

  await page.goto(`/studio/stories/${story.id}/characters`)
  await page.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.getByRole('dialog', { name: 'Добавить персонажей' })).toContainText('Леон для состава')
  await page.getByRole('checkbox', { name: 'Леон для состава' }).check()
  const mutation = page.waitForResponse((response) => response.url().endsWith(`/api/stories/${story.id}/characters/batch`))
  await page.getByRole('button', { name: 'Добавить выбранных' }).click()
  const response = await mutation
  expect(response.status()).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'story_versioned' })
  await expect(page.getByRole('alert')).toContainText('Состав не изменён')
  expect((await page.request.get(`/api/characters/${character.id}`)).ok()).toBeTruthy()
})

test('состав остаётся доступным на узком экране без горизонтального скролла', async ({ page }) => {
  const stories = await (await page.request.get('/api/stories')).json() as { id: string; title: string }[]
  const story = stories.find(({ title }) => title === 'Эхо неона')!
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/studio/stories/${story.id}/characters`)
  await expect(page.getByRole('button', { name: 'Добавить' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Редактировать Аканэ/ })).toBeVisible()
  const portrait = page.getByRole('row', { name: /Аканэ/ }).locator('[data-slot="avatar"]')
  const portraitSize = await portrait.boundingBox()
  expect(portraitSize?.width).toBe(40)
  expect(parseFloat(await portrait.evaluate((element) => getComputedStyle(element).borderRadius))).toBeLessThanOrEqual(12)
  const editBounds = await page.getByRole('button', { name: /Редактировать Аканэ/ }).boundingBox()
  expect(editBounds).not.toBeNull()
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(390)
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
