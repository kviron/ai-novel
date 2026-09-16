import { FormEvent, useEffect, useState } from 'react'
import { api, Job, ProviderStatus, Story, Turn } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'
import './styles.css'

const initial = {
  title: 'Эхо неона',
  premise: 'Курьер находит чужое воспоминание в дождливом мегаполисе.',
  name: 'Мира', age: 24, personality: 'наблюдательная и осторожная',
  appearance: 'короткие серебристые волосы, янтарные глаза, тёмное пальто',
}

function Setup({ onCreated }: { onCreated: (story: Story) => void }) {
  const [form, setForm] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: key === 'age' ? Number(event.target.value) : event.target.value })

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      onCreated(await api.createStory({
        title: form.title, premise: form.premise, theme_labels: ['детектив', 'для взрослых'],
        characters: [{ name: form.name, age: form.age, personality: form.personality, appearance: form.appearance }],
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать историю') }
    finally { setLoading(false) }
  }

  return <main className="setup-shell">
    <section className="brand-panel">
      <span className="eyebrow">ЛОКАЛЬНЫЙ ДВИЖОК ИСТОРИЙ · V0.1</span>
      <h1>Каждый выбор<br/><em>оставляет эхо.</em></h1>
      <p>Создайте личный мир, который помнит ваши слова. Сюжет ведёт локальная модель, а визуальный стиль выбираете вы.</p>
      <div className="signal"><i /> OLLAMA + COMFYUI ПОДКЛЮЧЕНЫ</div>
    </section>
    <form className="setup-card" onSubmit={submit}>
      <div><span className="step">01</span><h2>Начните новую историю</h2><p>Дайте движку отправную точку. Позже всё можно будет изменить.</p></div>
      <label>Название истории<Input value={form.title} onChange={field('title')} /></label>
      <label>Завязка<Textarea rows={3} value={form.premise} onChange={field('premise')} /></label>
      <div className="rule" />
      <div className="two"><label>Первый персонаж<Input value={form.name} onChange={field('name')} /></label><label>Возраст<Input type="number" min="18" value={form.age} onChange={field('age')} /></label></div>
      <label>Характер<Input value={form.personality} onChange={field('personality')} /></label>
      <label>Внешность<Textarea rows={2} value={form.appearance} onChange={field('appearance')} /></label>
      {error && <p className="error">{error}</p>}
      <Button className="primary" disabled={loading}>{loading ? 'Создаём историю…' : 'Начать историю'} <span>→</span></Button>
      <small>Все персонажи должны быть совершеннолетними. Данные остаются только на этом компьютере.</small>
    </form>
  </main>
}

function Play({ story: initialStory }: { story: Story }) {
  const [story, setStory] = useState(initialStory)
  const [jobs, setJobs] = useState<Job[]>([])
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState(false)
  const turn = story.latest_turn

  useEffect(() => { void api.jobs(story.id).then(setJobs); void api.providers().then(setProviders) }, [story.id])
  async function act(text: string) {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const next: Turn = await api.createTurn(story.id, { request_id: crypto.randomUUID(), expected_state_version: story.state_version, action: text })
      setStory({ ...story, state_version: next.state_version, latest_turn: next }); setAction('')
    } finally { setBusy(false) }
  }
  const queued = jobs.filter(job => job.status === 'queued').length

  return <main className="game-shell">
    <header><div className="logo">МНЕМОЗИНА <b>α</b></div><h1 className="story-title">{story.title}</h1><div className="chapter">ГЛАВА I <span>/</span> {story.current_scene}</div><div className="provider-dots"><i className={providers?.ollama.available ? 'on' : ''}/>ТЕКСТ <i className={providers?.comfyui.available ? 'on' : ''}/>ИЗОБРАЖЕНИЯ</div></header>
    <section className="stage">
      <div className="rain"/><div className="moon"/><div className="city"/>
      <div className="character-silhouette"><div className="portrait-mark">{story.characters[0].name.slice(0, 1)}</div></div>
      <aside className="job-panel"><div><span>ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ</span><b>в очереди: {queued}</b></div>{jobs.slice(0, 3).map(job => <article key={job.id}><i className={job.status}/><p>{{character_sheet: 'лист персонажа', sprite: 'спрайт', cg: 'полная сцена'}[job.kind]} {job.expression && `· ${{neutral: 'нейтральный', happy: 'радость', sad: 'грусть', angry: 'злость', surprised: 'удивление'}[job.expression] ?? job.expression}`}<small>{job.stage}</small></p></article>)}</aside>
      <div className="dialogue">
        <div className="speaker"><span>{turn?.speaker ?? story.characters[0].name}</span><small>{story.characters[0].personality}</small></div>
        <p className="narration">{turn?.narration ?? 'Неон растекается по дождю. Где-то внизу сигнал снова и снова повторяет ваше имя.'}</p>
        <p className="line">{turn?.dialogue ?? '«Вы всё-таки пришли. Хорошо. Я уже начала думать, что город вас проглотил».'}</p>
        <div className="choices">{(turn?.choices ?? ['Спросить о сигнале', 'Осмотреть комнату', 'Промолчать']).map((choice, index) => <button key={choice} onClick={() => void act(choice)}><b>0{index + 1}</b>{choice}<span>↗</span></button>)}</div>
        <form onSubmit={event => { event.preventDefault(); void act(action) }}><input aria-label="Ваше действие" placeholder="Напишите своё действие…" value={action} onChange={event => setAction(event.target.value)}/><button disabled={busy || !action.trim()}>ОТПРАВИТЬ</button></form>
      </div>
    </section>
    <footer><span>СОСТОЯНИЕ · v{story.state_version}</span><span>ЛОКАЛЬНАЯ СЕССИЯ</span><span>ИСТОРИЯ · {story.title}</span></footer>
  </main>
}

export default function App() {
  const [story, setStory] = useState<Story | null>(null)
  return <>{story ? <Play story={story} /> : <Setup onCreated={setStory} />}<Toaster /></>
}
