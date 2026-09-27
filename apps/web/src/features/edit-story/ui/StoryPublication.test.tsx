import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import type { DraftDiagnostic } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { TestRouter, type TestRouterInstance } from '@/test/TestRouter'

afterEach(() => { cleanup(); apiServer.reset() })

const diagnostic = (value: Partial<DraftDiagnostic>): DraftDiagnostic => ({
  code: 'invalid', severity: 'error', step: 'identity', field: 'identity.premise', item_id: null,
  message: 'Добавьте завязку', ...value,
})

test('groups diagnostics and focuses the exact field or stable item', async () => {
  apiServer.storyDraft({ story_id: 'story-1', mode: { mode: 'hybrid' }, canon: { creative_goals: '', facts: [{ id: 'fact-7', order_index: 0, title: '', statement: '', severity: 'hard', scope: 'world', referenced_character_ids: [] }], beats: [] } })
  apiServer.draftDiagnostics([
    diagnostic({ step: 'identity', field: 'identity.premise' }),
    diagnostic({ step: 'canon', field: 'canon.facts.statement', item_id: 'fact-7', message: 'Опишите факт' }),
  ])
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  expect(await screen.findByRole('heading', { name: 'Основа' })).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { name: 'Канон' })).toHaveLength(2)

  await userEvent.click(screen.getByRole('button', { name: /Добавьте завязку/ }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Завязка' })).toHaveFocus())
  await userEvent.click(screen.getByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: /Опишите факт/ }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Описание факта 1' })).toHaveFocus())
})

test('focuses canonical backend fields across hero, cast, rules, facts, and beat conditions', async () => {
  const revision = { id: 'hero-r1', character_id: 'hero-char', revision_number: 1, name: 'Героиня', gender: 'female', age: 22, personality: '', appearance: '', biography: '', speech: '', role: 'hero' }
  const castRevision = { ...revision, id: 'cast-r1', character_id: 'cast-char', name: 'Союзник', role: 'cast' }
  const fact = { id: 'fact-1', order_index: 0, title: 'Факт', statement: '', severity: 'hard' as const, scope: 'world' as const, referenced_character_ids: [] }
  const beat = { id: 'beat-1', order_index: 0, title: 'Событие', description: '', activation_condition: { kind: 'always' as const }, completion_evidence: '', required: true, ending_gate: false }
  const seed = {
    story_id: 'story-1', mode: { mode: 'hybrid' as const },
    hero: { hero_policy: 'fixed' as const, hero_allowed_sources: ['catalog' as const], fixed_hero_revision_id: 'hero-r1' },
    cast: { characters: [{ id: 'cast-1', character_id: 'cast-char', revision_id: 'cast-r1', order_index: 0, role: 'Союзник', color: '#ffffff', playable: false }] },
    character_revisions: [revision, castRevision], canon: { creative_goals: '', facts: [fact], beats: [beat] },
  }
  const cases: { diagnostic: DraftDiagnostic; target: () => HTMLElement }[] = [
    { diagnostic: diagnostic({ step: 'hero', field: 'hero.hero_allowed_sources', message: 'Источник героя' }), target: () => screen.getByRole('checkbox', { name: 'Каталог' }) },
    { diagnostic: diagnostic({ step: 'cast', field: 'cast.revision_id', item_id: 'cast-1', message: 'Ревизия состава' }), target: () => document.querySelector<HTMLElement>('[data-item-id="cast-1"] [data-diagnostic-field="cast.revision_id"]')! },
    { diagnostic: diagnostic({ step: 'rules', field: 'rules.generation_policy', message: 'Политика генерации' }), target: () => screen.getByText('Варианты и свой ответ').closest('button')! },
    { diagnostic: diagnostic({ step: 'rules', field: 'rules.themes_blocked', message: 'Запрещённые темы' }), target: () => screen.getByRole('textbox', { name: 'Запрещённые темы' }) },
    { diagnostic: diagnostic({ step: 'canon', field: 'canon.referenced_character_ids', item_id: 'fact-1', message: 'Ссылка факта' }), target: () => screen.getByRole('checkbox', { name: 'Героиня' }) },
    { diagnostic: diagnostic({ step: 'canon', field: 'canon.activation_condition', item_id: 'beat-1', message: 'Условие события' }), target: () => screen.getByRole('combobox', { name: 'Условие события 1' }) },
  ]
  for (const item of cases) {
    apiServer.storyDraft(seed)
    apiServer.draftDiagnostics([item.diagnostic])
    render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
    await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(item.diagnostic.message) }))
    await waitFor(() => expect(item.target()).toHaveFocus())
    cleanup(); apiServer.reset()
  }
}, 20_000)

test('errors block publication, warnings do not, and validation always precedes test and publish', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.draftDiagnostics([diagnostic({ severity: 'error' })])
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeDisabled()

  apiServer.draftDiagnostics([diagnostic({ severity: 'warning', message: 'Можно уточнить завязку' })])
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))
  await screen.findByRole('button', { name: 'Создать новую редакцию' })
  const requests = apiServer.authoringRequests().filter(({ method }) => method === 'POST')
  expect(requests.slice(-2).map(({ path }) => path)).toEqual(['/api/author/stories/story-1/validate', '/api/author/stories/story-1/publish'])
})

test('successful draft test navigates to studio session, while unavailable Ollama blocks testing only', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.startSession({ id: 'author-test-9', state_version: 1 })
  let router: TestRouterInstance | undefined
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} onRouter={(value) => { router = value }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Запустить тест' }))
  await waitFor(() => expect(router!.state.location.pathname).toBe('/studio/author-test-9'))
  expect(apiServer.authoringRequests().filter(({ method }) => method === 'POST').slice(-2).map(({ path }) => path)).toEqual(['/api/author/stories/story-1/validate', '/api/author/stories/story-1/test-sessions'])

  cleanup(); apiServer.reset(); apiServer.storyDraft({ story_id: 'story-2' }); apiServer.failDraftTestOnce()
  render(<TestRouter initialEntries={['/studio/stories/story-2/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Запустить тест' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ollama недоступна')
  expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Основа' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название' }), 'Локальная правка')
  expect(screen.getByRole('button', { name: 'Сохранить раздел' })).toBeEnabled()
})

test('published story exposes new revision action and clone conflict keeps local published state', async () => {
  apiServer.storyDraft({ story_id: 'story-1', identity: { title: 'Опубликованная история' } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Опубликовать' }))
  expect(await screen.findByRole('button', { name: 'Создать новую редакцию' })).toBeInTheDocument()
  const revision = screen.getByRole('button', { name: 'Создать новую редакцию' })

  apiServer.storyDraft({ story_id: 'story-1', identity: { title: 'Чужой черновик' } })
  await userEvent.click(revision)
  await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Черновик был изменён'))).toBe(true))
  expect(screen.getByRole('heading', { level: 1, name: 'Опубликованная история' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Создать новую редакцию' })).toBeInTheDocument()
})

test('review renders every persisted authoring field in stable readable order', async () => {
  apiServer.storyDraft({
    story_id: 'story-1', mode: { mode: 'hybrid' },
    identity: { title: 'Полная история', slug: 'full-story', short_description: 'Кратко', premise: 'Замысел', cover_material_id: 'cover-9', genres: ['нуар'], tone: ['мрачно'], setting: 'Неоновый город', opening_situation: 'Встреча под дождём' },
    hero: { hero_policy: 'fixed', hero_allowed_sources: ['catalog'], fixed_hero_revision_id: 'hero-r2' },
    cast: { characters: [{ id: 'cast-1', character_id: 'mark', revision_id: 'mark-r3', order_index: 0, role: 'Союзник', color: '#123456', playable: true }] },
    character_revisions: [
      { id: 'hero-r2', character_id: 'ashley', revision_number: 2, name: 'Эшли', gender: 'female', age: 25, personality: '', appearance: '', biography: '', speech: '', role: 'hero' },
      { id: 'mark-r3', character_id: 'mark', revision_number: 3, name: 'Марк', gender: 'male', age: 31, personality: '', appearance: '', biography: '', speech: '', role: 'cast' },
    ],
    rules: { themes_allowed: ['тайна'], themes_blocked: ['комедия'], ending_policy: 'required_beats_then_end', recommended_provider_id: 'ollama', recommended_model_id: 'qwen:test', generation_policy: { narration_perspective: 'third_person', prose_density: 'detailed', choice_policy: 'choices_only', min_choices: 1, max_choices: 6, allow_romance: true, allow_violence: false, allow_horror: true, allow_sexual_themes: false, desired_themes: 'искупление', forbidden_outcomes: 'сон' } },
    canon: { creative_goals: 'Держать напряжение', facts: [{ id: 'fact-1', order_index: 0, title: 'Закон', statement: 'Магия имеет цену', severity: 'hard', scope: 'world', referenced_character_ids: ['ashley'] }], beats: [{ id: 'beat-1', order_index: 0, title: 'Разоблачение', description: 'Правда открыта', activation_condition: { kind: 'after_turn_count', turn_count: 3 }, completion_evidence: 'Герой признался', required: true, ending_gate: true }] },
  })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  const text = screen.getByRole('heading', { level: 2, name: 'Полная история' }).closest('[data-slot="card"]')!.textContent!
  for (const expected of ['full-story', 'Кратко', 'Замысел', 'cover-9', 'нуар', 'мрачно', 'Неоновый город', 'Встреча под дождём', 'Эшли', 'hero-r2', 'Марк', 'mark-r3', 'Союзник', '#123456', 'тайна', 'комедия', 'required_beats_then_end', 'third_person', 'detailed', 'choices_only', '1–6', 'ollama', 'qwen:test', 'искупление', 'сон', 'Закон', 'Магия имеет цену', 'ashley', 'Разоблачение', 'Правда открыта', '3', 'Герой признался']) expect(text).toContain(expected)
})
