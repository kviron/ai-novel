import type { Page } from '@playwright/test'

export async function startStory(page: Page) {
  await page.getByRole('heading', { name: 'Эхо неона' })
    .locator('xpath=ancestor::*[@data-slot="card"]')
    .getByRole('button', { name: 'Начать новую игру' })
    .click()
  await page.getByRole('textbox', { name: 'Имя' }).fill('Игрок')
  await page.getByRole('button', { name: 'Проверить героя' }).click()
  await page.getByRole('button', { name: 'Начать историю' }).click()
}
