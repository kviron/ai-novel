import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import type { CatalogCharacter } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { TestRouter, type TestRouterInstance } from '@/test/TestRouter'

const akane: CatalogCharacter = {
  id: 'akane-r3', character_id: 'akane', current_revision_id: 'akane-r3', revision_number: 3,
  name: 'Аканэ', gender: 'female', age: 25, personality: 'Наблюдательная', appearance: 'Красное платье',
  biography: 'Знает город', speech: 'Спокойная', created_at: '2026-09-20T00:00:00Z', source_type: 'local',
}
const mark: CatalogCharacter = {
  id: 'mark-r2', character_id: 'mark', current_revision_id: 'mark-r2', revision_number: 2,
  name: 'Марк', gender: 'male', age: 31, personality: 'Сдержанный', appearance: 'Тёмное пальто',
  biography: 'Частный детектив', speech: 'Короткие фразы', created_at: '2026-09-21T00:00:00Z', source_type: 'local',
}

afterEach(() => { cleanup(); apiServer.reset() })

test('сохраняет идентичность целой секцией и загружает обложку с происхождением', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Название' }), 'Ночной город')
  await userEvent.type(screen.getByRole('textbox', { name: 'Краткое описание' }), 'История под дождём')
  const file = new File(['png bytes'], 'cover.png', { type: 'image/png' })
  await userEvent.upload(screen.getByLabelText('Файл обложки'), file)
  await userEvent.type(screen.getByRole('textbox', { name: 'Автор обложки' }), 'Рома')
  await userEvent.type(screen.getByRole('textbox', { name: 'Лицензия обложки' }), 'CC BY')
  await userEvent.type(screen.getByRole('textbox', { name: 'Источник обложки' }), 'original')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))

  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({
    storyId: 'story-1', section: 'identity', expected_revision: 1,
    data: expect.objectContaining({ title: 'Ночной город', short_description: 'История под дождём', cover_material_id: 'cover-1' }),
  }))
  expect(apiServer.lastCoverUploadRequest()).toMatchObject({ creator: 'Рома', license: 'CC BY', source: 'original' })

  await userEvent.type(screen.getByRole('textbox', { name: 'Название' }), ' — продолжение')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'PUT' && path.endsWith('/draft/identity'))).toHaveLength(2))
  expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'POST' && path.endsWith('/draft/cover'))).toHaveLength(1)
  expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ data: expect.objectContaining({ cover_material_id: 'cover-1' }) })
})

test('после ошибки PUT повторяет сохранение с уже загруженной обложкой без повторного POST файла', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.failSectionSaveOnce()
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  const file = new File(['png bytes'], 'cover.png', { type: 'image/png' })
  await userEvent.upload(await screen.findByLabelText('Файл обложки'), file)
  await userEvent.type(screen.getByRole('textbox', { name: 'Автор обложки' }), 'Рома')
  await userEvent.type(screen.getByRole('textbox', { name: 'Лицензия обложки' }), 'CC BY')
  await userEvent.type(screen.getByRole('textbox', { name: 'Источник обложки' }), 'original')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить раздел')
  expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ data: expect.objectContaining({ cover_material_id: 'cover-1' }) })

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'PUT' && path.endsWith('/draft/identity'))).toHaveLength(2))
  expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'POST' && path.endsWith('/draft/cover'))).toHaveLength(1)
  expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ data: expect.objectContaining({ cover_material_id: 'cover-1' }) })
})

test('объясняет режимы и сохраняет выбранный гибридный режим', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Режим' }))

  expect(screen.getByText(/Свободный режим.*без обязательного маршрута/i)).toBeInTheDocument()
  expect(screen.getByText(/Гибридный режим.*ключевые события/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Гибридный' }))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ section: 'mode', data: { mode: 'hybrid' } }))
})

test('закрепляет точную ревизию героя и не предлагает героя или уже закреплённую ревизию в составе', async () => {
  apiServer.listCharacters([akane, mark])
  apiServer.storyDraft({
    story_id: 'story-1',
    hero: { hero_policy: 'fixed', hero_allowed_sources: ['catalog'], fixed_hero_revision_id: 'akane-r3' },
    cast: { characters: [{ id: 'cast-mark', character_id: 'mark', revision_id: 'mark-r2', order_index: 0, role: 'Проводник', color: '#ffffff', playable: false }] },
    character_revisions: [
      { id: 'akane-r3', character_id: 'akane', revision_number: 3, name: 'Аканэ', gender: 'female', age: 25, personality: '', appearance: '', biography: '', speech: '', role: 'Героиня' },
      { id: 'mark-r2', character_id: 'mark', revision_number: 2, name: 'Марк', gender: 'male', age: 31, personality: '', appearance: '', biography: '', speech: '', role: 'Проводник' },
    ],
  })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Герой' }))
  expect(screen.getByText('Аканэ · ревизия 3 · 25 лет')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Состав' }))
  const markRevision = screen.getByText('Марк · ревизия 2 · 31 год')
  expect(screen.queryByRole('button', { name: /Добавить Аканэ/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Добавить Марк/ })).not.toBeInTheDocument()

  await userEvent.click(within(markRevision.closest('[data-slot="card"]')!).getByRole('button'))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({ section: 'cast', data: { characters: [] } }))
})

test('добавляет точную ревизию персонажа с возрастом в состав и сохраняет её', async () => {
  apiServer.listCharacters([mark])
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Состав' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Добавить Марк · ревизия 2 · 31 год' }))
  expect(screen.getByText('Марк · ревизия 2 · 31 год')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))
  await waitFor(() => expect(apiServer.lastAuthoringSectionRequest()).toMatchObject({
    section: 'cast', data: { characters: [expect.objectContaining({ character_id: 'mark', revision_id: 'mark-r2' })] },
  }))
})

test('сохраняет локальный текст при конфликте и перезагружает все поля только по явному действию', async () => {
  apiServer.storyDraft({ story_id: 'story-1', identity: { title: 'Сервер', tone: ['серверный'] } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  const title = await screen.findByRole('textbox', { name: 'Название' })
  const tone = screen.getByRole('textbox', { name: 'Тон' })
  await userEvent.clear(title)
  await userEvent.type(title, 'Мой текст')
  await userEvent.clear(tone)
  await userEvent.type(tone, 'мой тон')
  await fetch('/api/author/stories/story-1/draft/identity', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: 1, data: { title: 'Чужое изменение', tone: ['чужой тон'] } }),
  })
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить раздел' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Черновик был изменён')
  expect(title).toHaveValue('Мой текст')
  expect(tone).toHaveValue('мой тон')
  await userEvent.click(screen.getByRole('button', { name: 'Загрузить версию сервера' }))
  await waitFor(() => expect(title).toHaveValue('Чужое изменение'))
  expect(tone).toHaveValue('чужой тон')
})

test('предупреждает браузер о несохранённых изменениях и показывает русские состояния восстановления', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  const title = await screen.findByRole('textbox', { name: 'Название' })
  await userEvent.type(title, 'Черновик')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole('link', { name: 'Библиотека' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Есть несохранённые изменения')
  await userEvent.click(screen.getByRole('button', { name: 'Остаться в редакторе' }))
  expect(title).toBeInTheDocument()

  apiServer.reset()
  render(<TestRouter initialEntries={['/studio/stories/missing/edit']} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('История или версия не найдена')
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
})

test('блокирует переход назад в истории и позволяет остаться или продолжить', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  let router: TestRouterInstance | undefined
  render(<TestRouter initialEntries={['/', '/studio/stories/story-1/edit']} initialIndex={1} onRouter={(value) => { router = value }} />)
  await userEvent.type(await screen.findByRole('textbox', { name: 'Название' }), 'Несохранённый текст')

  await router!.navigate(-1)
  expect(await screen.findByRole('alert')).toHaveTextContent('Есть несохранённые изменения')
  expect(router!.state.location.pathname).toBe('/studio/stories/story-1/edit')
  await userEvent.click(screen.getByRole('button', { name: 'Остаться в редакторе' }))
  expect(router!.state.location.pathname).toBe('/studio/stories/story-1/edit')

  await router!.navigate(-1)
  await userEvent.click(await screen.findByRole('button', { name: 'Выйти без сохранения' }))
  await waitFor(() => expect(router!.state.location.pathname).toBe('/'))
})
