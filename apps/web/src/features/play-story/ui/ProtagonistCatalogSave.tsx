import { useState } from 'react'

import { api } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

export function ProtagonistCatalogSave({ sessionId, name, appearance }: { sessionId: string; name: string; appearance: string }) {
  const [age, setAge] = useState('')
  const [personality, setPersonality] = useState('')
  const [appearanceText, setAppearanceText] = useState(appearance)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const canSave = Number(age) >= 18 && personality.trim().length > 0 && appearanceText.trim().length > 0 && !pending

  async function save() {
    if (!canSave) return
    setPending(true)
    setError('')
    try {
      await api.saveSessionProtagonist(sessionId, { age: Number(age), personality: personality.trim(), appearance: appearanceText.trim() })
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить героя.')
    } finally {
      setPending(false)
    }
  }

  if (saved) return <p role="status" className="text-sm">Герой {name} сохранён в каталоге. Текущее прохождение не изменилось.</p>
  return <div className="flex flex-col gap-3">
    <div><p className="text-sm font-medium">Герой игрока · {name}</p><p className="text-xs text-muted-foreground">Сохранит независимого персонажа. Это прохождение останется прежним.</p></div>
    <FieldGroup>
      <Field><FieldLabel htmlFor="hero-export-age">Возраст</FieldLabel><Input id="hero-export-age" type="number" min={18} value={age} onChange={(event) => setAge(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="hero-export-personality">Характер</FieldLabel><Textarea id="hero-export-personality" value={personality} onChange={(event) => setPersonality(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="hero-export-appearance">Внешность</FieldLabel><Textarea id="hero-export-appearance" value={appearanceText} onChange={(event) => setAppearanceText(event.target.value)} /><FieldDescription>{appearance ? 'Внешность из анкеты сохранена в сессии.' : 'Для каталога требуется описание внешности.'}</FieldDescription></Field>
    </FieldGroup>
    <Button type="button" variant="outline" disabled={!canSave} onClick={() => void save()}>{pending ? 'Сохраняем…' : 'Сохранить героя в каталог'}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
