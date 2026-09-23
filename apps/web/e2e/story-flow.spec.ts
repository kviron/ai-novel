import { expect, test } from '@playwright/test'

test('игрок проходит один ход и восстанавливает его после перезагрузки', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Начать историю' }).click()
  await expect(page.getByRole('heading', { name: 'Эхо неона' })).toBeVisible()

  await page.getByRole('button', { name: 'Спросить о веере' }).click()
  await expect(page.getByRole('img', { name: 'Аканэ: С веером' })).toBeVisible()
  await page.getByRole('button', { name: 'Показать полностью' }).click()
  await expect(page.getByText(/Я ждала этого вопроса/)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('img', { name: 'Аканэ: С веером' })).toBeVisible()
  await expect(page.getByText('Состояние · v2')).toBeVisible()
  await page.getByRole('button', { name: 'Показать полностью' }).click()
  await expect(page.getByText(/Я ждала этого вопроса/)).toBeVisible()
})
