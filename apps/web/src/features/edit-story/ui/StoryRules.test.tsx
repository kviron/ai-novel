import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

afterEach(() => { cleanup(); apiServer.reset() })

test('validates choice counts, explicit switches, and collisions between allowed and blocked themes', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Правила' }))
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Минимум вариантов' }))
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Минимум вариантов' }), '5')
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Максимум вариантов' }))
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Максимум вариантов' }), '3')
  expect(screen.getByRole('alert')).toHaveTextContent('Минимум не может быть больше максимума')
  expect(screen.getByRole('button', { name: 'Сохранить раздел' })).toBeDisabled()

  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Максимум вариантов' }))
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Максимум вариантов' }), '6')
  await userEvent.type(screen.getByRole('textbox', { name: 'Разрешённые темы' }), 'тайна, романтика')
  await userEvent.type(screen.getByRole('textbox', { name: 'Запрещённые темы' }), 'романтика')
  expect(screen.getByRole('alert')).toHaveTextContent('Тема «романтика» одновременно разрешена и запрещена')

  await userEvent.clear(screen.getByRole('textbox', { name: 'Запрещённые темы' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Запрещённые темы' }), 'предательство')
  await userEvent.click(screen.getByRole('switch', { name: 'Сексуальные темы' }))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({
    section: 'rules',
    data: expect.objectContaining({
      themes_allowed: ['тайна', 'романтика'], themes_blocked: ['предательство'],
      generation_policy: expect.objectContaining({ min_choices: 5, max_choices: 6, allow_sexual_themes: true }),
    }),
  }))
}, 10_000)

test('edits freeform goals and confirms destructive switch before clearing incompatible canon', async () => {
  apiServer.storyDraft({ story_id: 'story-1', mode: { mode: 'freeform' }, canon: { creative_goals: 'Сохранить меланхолию', facts: [], beats: [] } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Канон' }))
  expect(screen.getByRole('textbox', { name: 'Творческие цели' })).toHaveValue('Сохранить меланхолию')
  expect(screen.queryByRole('button', { name: 'Добавить факт' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Режим' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Гибридный' }))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  const dialog = await screen.findByRole('dialog', { name: 'Очистить несовместимые данные?' })
  expect(apiServer.lastAuthoringSectionRequest()).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Переключить и очистить' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ section: 'mode', data: { mode: 'hybrid' }, confirmClearIncompatible: true }))
})

test('keeps stable fact and beat IDs while explicitly reordering and limits after-beat to prior beats', async () => {
  apiServer.storyDraft({ story_id: 'story-1', mode: { mode: 'hybrid' } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Канон' }))

  await userEvent.click(screen.getByRole('button', { name: 'Добавить факт' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название факта 1' }), 'Первый факт')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить факт' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название факта 2' }), 'Второй факт')
  await userEvent.keyboard('{Tab}')
  await userEvent.click(screen.getByRole('button', { name: 'Поднять факт 2' }))

  await userEvent.click(screen.getByRole('button', { name: 'Добавить событие' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название события 1' }), 'Встреча')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить событие' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название события 2' }), 'Развязка')
  await userEvent.click(screen.getByRole('combobox', { name: 'Условие события 2' }))
  await userEvent.click(screen.getByRole('option', { name: 'После события' }))
  const prior = screen.getByRole('combobox', { name: 'После события' })
  await userEvent.click(prior)
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option')).toHaveTextContent('Встреча')
  await userEvent.click(screen.getByRole('option'))

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({
    section: 'canon', data: {
      creative_goals: '',
      facts: [expect.objectContaining({ title: 'Второй факт', order_index: 0 }), expect.objectContaining({ title: 'Первый факт', order_index: 1 })],
      beats: [expect.objectContaining({ title: 'Встреча', order_index: 0 }), expect.objectContaining({ title: 'Развязка', order_index: 1, activation_condition: { kind: 'after_beat', beat_id: expect.any(String) } })],
    },
  }))
  const saved = apiServer.lastAuthoringSectionRequest()!.data as { beats: { id: string; activation_condition: { kind: string; beat_id?: string } }[] }
  expect(saved.beats[1].activation_condition.beat_id).toBe(saved.beats[0].id)
})
