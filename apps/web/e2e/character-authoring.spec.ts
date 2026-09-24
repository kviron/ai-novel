import { expect, test } from '@playwright/test'

test('автор создаёт персонажа и новую ревизию, сохранив исходное описание', async ({ page }) => {
  await page.goto('/characters')
  await page.getByRole('link', { name: 'Создать персонажа' }).click()
  await expect(page).toHaveURL('/characters/new')
  await page.getByRole('textbox', { name: 'Имя' }).fill('Леон')
  await page.getByRole('textbox', { name: 'Характер' }).fill('Решительный наблюдатель')
  await page.getByRole('button', { name: 'Сгенерировать характер' }).click()
  await expect(page.getByRole('textbox', { name: 'Характер' })).toHaveValue(/Решительный наблюдатель/)
  await page.getByRole('textbox', { name: 'Внешность' }).fill('Тёмные волосы и плащ')
  await page.getByRole('button', { name: 'Создать персонажа' }).click()
  await expect(page.getByRole('heading', { name: 'Леон' })).toBeVisible()

  await page.getByRole('link', { name: 'Создать новую ревизию' }).click()
  await page.getByRole('textbox', { name: 'Характер' }).fill('Решительный, но осторожный')
  await page.getByRole('button', { name: 'Создать ревизию' }).click()
  await expect(page.getByText('Ревизия 2', { exact: false }).first()).toBeVisible()

})
