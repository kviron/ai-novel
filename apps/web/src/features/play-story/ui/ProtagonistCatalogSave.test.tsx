import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { ProtagonistCatalogSave } from './ProtagonistCatalogSave'

afterEach(() => { cleanup(); apiServer.reset() })

test('сохраняет героя-черновик в каталог только после дополнения обязательных полей', async () => {
  render(<ProtagonistCatalogSave sessionId="session-1" name="Лена" appearance="" />)
  expect(screen.getByRole('button', { name: 'Сохранить героя в каталог' })).toBeDisabled()
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Возраст' }), '25')
  await userEvent.type(screen.getByRole('textbox', { name: 'Характер' }), 'Любознательная')
  await userEvent.type(screen.getByRole('textbox', { name: 'Внешность' }), 'Тёмные волосы')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить героя в каталог' }))
  expect(apiServer.lastHeroSaveRequest()).toEqual({ age: 25, personality: 'Любознательная', appearance: 'Тёмные волосы' })
  expect(await screen.findByRole('status')).toHaveTextContent('Герой Лена сохранён в каталоге')
})
