import { expect, test } from '@playwright/test'

test('автор создаёт персонажа, новую ревизию и добавляет его в новеллу', async ({ page }) => {
  await page.goto('/characters')
  await page.getByRole('button', { name: 'Создать персонажа' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Имя' }).fill('Леон')
  await dialog.getByRole('textbox', { name: 'Характер' }).fill('Решительный наблюдатель')
  await dialog.getByRole('textbox', { name: 'Внешность' }).fill('Тёмные волосы и плащ')
  await dialog.getByRole('button', { name: 'Создать персонажа' }).click()
  await expect(page.getByRole('heading', { name: 'Леон' })).toBeVisible()

  await page.getByRole('button', { name: 'Создать новую ревизию' }).click()
  const revisionDialog = page.getByRole('dialog')
  await revisionDialog.getByRole('textbox', { name: 'Характер' }).fill('Решительный, но осторожный')
  await revisionDialog.getByRole('button', { name: 'Создать ревизию' }).click()
  await expect(page.getByText('Ревизия 2', { exact: false }).first()).toBeVisible()

  await page.goto('/studio')
  await page.getByRole('link', { name: 'Состав новеллы' }).first().click()
  await page.getByRole('button', { name: /Леон.*Не добавлен/ }).click()
  await expect(page.getByLabel('Ревизия')).toHaveValue(/.+/)
  await page.getByRole('button', { name: 'Добавить в новеллу' }).click()
  await expect(page.getByText('Сейчас закреплена ревизия v2.')).toBeVisible()
})
