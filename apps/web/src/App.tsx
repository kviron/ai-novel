import { FormEvent, useEffect, useState } from 'react'
import { api, Job, ProviderStatus, Story, Turn } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'
import './styles.css'

const initial = {
  title: 'Echoes of Neon',
  premise: 'A courier discovers a memory hidden in a rainy megacity.',
  name: 'Mira', age: 24, personality: 'observant and guarded',
  appearance: 'short silver hair, amber eyes, dark coat',
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
        title: form.title, premise: form.premise, theme_labels: ['mystery', 'mature'],
        characters: [{ name: form.name, age: form.age, personality: form.personality, appearance: form.appearance }],
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create story') }
    finally { setLoading(false) }
  }

  return <main className="setup-shell">
    <section className="brand-panel">
      <span className="eyebrow">LOCAL STORY ENGINE · V0.1</span>
      <h1>Every choice<br/><em>leaves an echo.</em></h1>
      <p>Build a private, persistent world shaped by your words. Narrative by your local model. Art directed by you.</p>
      <div className="signal"><i /> OLLAMA + COMFYUI READY</div>
    </section>
    <form className="setup-card" onSubmit={submit}>
      <div><span className="step">01</span><h2>Begin a new story</h2><p>Give the engine a spark. You can reshape everything later.</p></div>
      <label>Story title<Input value={form.title} onChange={field('title')} /></label>
      <label>Premise<Textarea rows={3} value={form.premise} onChange={field('premise')} /></label>
      <div className="rule" />
      <div className="two"><label>First character<Input value={form.name} onChange={field('name')} /></label><label>Age<Input type="number" min="18" value={form.age} onChange={field('age')} /></label></div>
      <label>Personality<Input value={form.personality} onChange={field('personality')} /></label>
      <label>Visual identity<Textarea rows={2} value={form.appearance} onChange={field('appearance')} /></label>
      {error && <p className="error">{error}</p>}
      <Button className="primary" disabled={loading}>{loading ? 'Opening the story…' : 'Begin story'} <span>→</span></Button>
      <small>All characters must be adults. Everything stays on this machine.</small>
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
    <header><div className="logo">MNEMOSYNE <b>α</b></div><h1 className="story-title">{story.title}</h1><div className="chapter">CHAPTER I <span>/</span> {story.current_scene}</div><div className="provider-dots"><i className={providers?.ollama.available ? 'on' : ''}/>LLM <i className={providers?.comfyui.available ? 'on' : ''}/>IMAGE</div></header>
    <section className="stage">
      <div className="rain"/><div className="moon"/><div className="city"/>
      <div className="character-silhouette"><div className="portrait-mark">{story.characters[0].name.slice(0, 1)}</div></div>
      <aside className="job-panel"><div><span>IMAGE PIPELINE</span><b>{queued} queued</b></div>{jobs.slice(0, 3).map(job => <article key={job.id}><i className={job.status}/><p>{job.kind.replace('_', ' ')} {job.expression && `· ${job.expression}`}<small>{job.stage}</small></p></article>)}</aside>
      <div className="dialogue">
        <div className="speaker"><span>{turn?.speaker ?? story.characters[0].name}</span><small>{story.characters[0].personality}</small></div>
        <p className="narration">{turn?.narration ?? 'Neon bleeds through the rain. Somewhere below, a signal repeats your name.'}</p>
        <p className="line">{turn?.dialogue ?? '“You came. Good. I was beginning to think the city had swallowed you.”'}</p>
        <div className="choices">{(turn?.choices ?? ['Ask about the signal', 'Study the room', 'Say nothing']).map((choice, index) => <button key={choice} onClick={() => void act(choice)}><b>0{index + 1}</b>{choice}<span>↗</span></button>)}</div>
        <form onSubmit={event => { event.preventDefault(); void act(action) }}><input aria-label="Your action" placeholder="Write your own action…" value={action} onChange={event => setAction(event.target.value)}/><button disabled={busy || !action.trim()}>SEND</button></form>
      </div>
    </section>
    <footer><span>STATE · v{story.state_version}</span><span>LOCAL SESSION</span><span>STORY · {story.title}</span></footer>
  </main>
}

export default function App() {
  const [story, setStory] = useState<Story | null>(null)
  return <>{story ? <Play story={story} /> : <Setup onCreated={setStory} />}<Toaster /></>
}
