import { useState, type FormEvent } from 'react'

import { type CharacterRevision, type CharacterWrite } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'

const emptyProfile: CharacterWrite = { name: '', gender: 'unspecified', age: 18, personality: '', appearance: '', biography: '', speech: '', role: '' }

function editableProfile(initial?: CharacterRevision): CharacterWrite {
  if (!initial) return emptyProfile
  const { name, gender, age, personality, appearance, biography, speech, role } = initial
  return { name, gender, age, personality, appearance, biography, speech, role }
}

export function CharacterEditor({ open, onOpenChange, initial, onSave }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: CharacterRevision
  onSave: (profile: CharacterWrite) => Promise<void>
}) {
  const [profile, setProfile] = useState<CharacterWrite>(() => editableProfile(initial))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function change<K extends keyof CharacterWrite>(key: K, value: CharacterWrite[K]) {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await onSave({ ...profile, name: profile.name.trim(), personality: profile.personality.trim(), appearance: profile.appearance.trim() })
      onOpenChange(false)
    } catch {
      setError('Не удалось сохранить персонажа. Проверьте поля и повторите попытку.')
    } finally {
      setPending(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[min(90dvh,760px)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{initial ? 'Новая ревизия' : 'Новый персонаж'}</DialogTitle><DialogDescription>{initial ? 'Существующие сессии сохранят прежний профиль.' : 'Создайте профиль в общем каталоге. Позже его можно закрепить за новеллой.'}</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-1.5"><Label htmlFor="character-name">Имя</Label><Input id="character-name" required maxLength={120} value={profile.name} onChange={(event) => change('name', event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="character-gender">Пол</Label><select id="character-gender" className="h-8 rounded-md border border-input bg-input/20 px-2 text-xs" value={profile.gender} onChange={(event) => change('gender', event.target.value as CharacterWrite['gender'])}><option value="unspecified">Не указан</option><option value="female">Женский</option><option value="male">Мужской</option></select></div>
          <div className="grid gap-1.5"><Label htmlFor="character-age">Возраст</Label><Input id="character-age" type="number" min={18} required value={profile.age} onChange={(event) => change('age', Number(event.target.value))} /></div>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="character-personality">Характер</Label><Textarea id="character-personality" required value={profile.personality} onChange={(event) => change('personality', event.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="character-appearance">Внешность</Label><Textarea id="character-appearance" required value={profile.appearance} onChange={(event) => change('appearance', event.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="character-biography">История</Label><Textarea id="character-biography" value={profile.biography} onChange={(event) => change('biography', event.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="character-speech">Манера речи</Label><Textarea id="character-speech" value={profile.speech} onChange={(event) => change('speech', event.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="character-role">Роль</Label><Input id="character-role" value={profile.role} onChange={(event) => change('role', event.target.value)} /></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={pending}>{pending ? 'Сохраняем…' : initial ? 'Создать ревизию' : 'Создать персонажа'}</Button>
      </form>
    </DialogContent>
  </Dialog>
}
