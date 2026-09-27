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

test('matches backend choice bounds and atomically normalizes free-input counts', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Правила' }))
  const min = screen.getByRole('spinbutton', { name: 'Минимум вариантов' })
  const max = screen.getByRole('spinbutton', { name: 'Максимум вариантов' })
  await userEvent.clear(min); await userEvent.type(min, '0')
  await userEvent.clear(max); await userEvent.type(max, '6')
  expect(screen.getByRole('button', { name: 'Сохранить раздел' })).toBeEnabled()
  await userEvent.clear(max); await userEvent.type(max, '7')
  expect(screen.getByRole('alert')).toHaveTextContent('от 0 до 6')

  await userEvent.click(screen.getByText('Только свой ответ'))
  expect(screen.queryByRole('spinbutton', { name: 'Минимум вариантов' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ section: 'rules', data: { generation_policy: expect.objectContaining({ choice_policy: 'free_input_only', min_choices: 0, max_choices: 0 }) } }))

  await userEvent.click(screen.getByText('Правила'))
  await userEvent.click(screen.getByText('Только варианты'))
  expect(screen.getByRole('spinbutton', { name: 'Минимум вариантов' })).toHaveValue(2)
  expect(screen.getByRole('spinbutton', { name: 'Максимум вариантов' })).toHaveValue(4)
})

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

test('normalizes forward and dangling beat dependencies after reorder or delete', async () => {
  const beats = [
    { id: 'beat-a', order_index: 0, title: 'А', description: '', activation_condition: { kind: 'always' as const }, completion_evidence: '', required: true, ending_gate: false },
    { id: 'beat-b', order_index: 1, title: 'Б', description: '', activation_condition: { kind: 'after_beat' as const, beat_id: 'beat-a' }, completion_evidence: '', required: true, ending_gate: false },
  ]
  apiServer.storyDraft({ story_id: 'story-1', mode: { mode: 'hybrid' }, canon: { creative_goals: '', facts: [], beats } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Канон' }))
  await userEvent.click(screen.getByRole('button', { name: 'Поднять событие 2' }))
  expect(screen.getByRole('combobox', { name: 'Условие события 1' })).toHaveTextContent('Всегда')
  await userEvent.click(screen.getByRole('button', { name: 'Опустить событие 1' }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Условие события 2' }))
  await userEvent.click(screen.getByRole('option', { name: 'После события' }))
  await userEvent.click(screen.getByRole('button', { name: 'Удалить событие 1' }))
  expect(screen.getByRole('combobox', { name: 'Условие события 1' })).toHaveTextContent('Всегда')
})

test('edits fact references from pinned hero and cast identities', async () => {
  apiServer.storyDraft({
    story_id: 'story-1', mode: { mode: 'hybrid' },
    hero: { hero_policy: 'fixed', hero_allowed_sources: ['catalog'], fixed_hero_revision_id: 'hero-r1' },
    cast: { characters: [{ id: 'cast-1', character_id: 'cast-char', revision_id: 'cast-r1', order_index: 0, role: 'Союзник', color: '#ffffff', playable: false }] },
    character_revisions: [
      { id: 'hero-r1', character_id: 'hero-char', revision_number: 1, name: 'Героиня', gender: 'female', age: 22, personality: '', appearance: '', biography: '', speech: '', role: 'hero' },
      { id: 'cast-r1', character_id: 'cast-char', revision_number: 1, name: 'Союзник', gender: 'male', age: 28, personality: '', appearance: '', biography: '', speech: '', role: 'cast' },
      { id: 'unused-r1', character_id: 'unused-char', revision_number: 1, name: 'Лишний', gender: 'male', age: 30, personality: '', appearance: '', biography: '', speech: '', role: 'none' },
    ],
    canon: { creative_goals: '', facts: [{ id: 'fact-1', order_index: 0, title: 'Связь', statement: 'Они знакомы', severity: 'hard', scope: 'relationship', referenced_character_ids: [] }], beats: [] },
  })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Канон' }))
  expect(screen.queryByRole('checkbox', { name: 'Лишний' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Героиня' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Союзник' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Героиня' }))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ section: 'canon', data: { facts: [expect.objectContaining({ referenced_character_ids: ['cast-char'] })] } }))
})
