import { useRef, useState, type FormEvent } from 'react'

import { api, ApiRequestError, type StoryIdentitySection } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

type Props = {
  storyId: string
  value: StoryIdentitySection
  saving: boolean
  onChange: (value: StoryIdentitySection) => void
  onSave: (value?: StoryIdentitySection) => Promise<boolean>
}

export function IdentityStep({ storyId, value, saving, onChange, onSave }: Props) {
  const [cover, setCover] = useState<File | null>(null)
  const [creator, setCreator] = useState('')
  const [license, setLicense] = useState('')
  const [source, setSource] = useState('')
  const [genresText, setGenresText] = useState((value.genres ?? []).join(', '))
  const [toneText, setToneText] = useState((value.tone ?? []).join(', '))
  const [uploadError, setUploadError] = useState('')
  const coverInput = useRef<HTMLInputElement>(null)

  const change = <K extends keyof StoryIdentitySection>(field: K, next: StoryIdentitySection[K]) => onChange({ ...value, [field]: next })
  async function submit(event: FormEvent) {
    event.preventDefault()
    let next = value
    if (cover) {
      try {
        const material = await api.uploadStoryCover(storyId, cover, { creator, license, source })
        next = { ...value, cover_material_id: material.id }
        onChange(next)
        setCover(null)
        if (coverInput.current) coverInput.current.value = ''
        setUploadError('')
      } catch (cause) {
        setUploadError(cause instanceof ApiRequestError ? cause.message : 'Не удалось загрузить обложку.')
        return
      }
    }
    await onSave(next)
  }

  return <form onSubmit={(event) => void submit(event)}>
    <Card>
      <CardHeader><CardTitle>Основа новеллы</CardTitle><CardDescription>Название, завязка, мир и обложка будущей истории.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
      {uploadError && <Alert variant="destructive"><AlertDescription>{uploadError}</AlertDescription></Alert>}
      <Field><FieldLabel htmlFor="story-title">Название</FieldLabel><Input id="story-title" data-diagnostic-field="identity.title" value={value.title} onChange={(event) => change('title', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-slug">Адресное имя</FieldLabel><Input id="story-slug" data-diagnostic-field="identity.slug" value={value.slug ?? ''} onChange={(event) => change('slug', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-description">Краткое описание</FieldLabel><Textarea id="story-description" data-diagnostic-field="identity.short_description" value={value.short_description} onChange={(event) => change('short_description', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-premise">Завязка</FieldLabel><Textarea id="story-premise" data-diagnostic-field="identity.premise" value={value.premise} onChange={(event) => change('premise', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-setting">Место и время</FieldLabel><Textarea id="story-setting" data-diagnostic-field="identity.setting" value={value.setting} onChange={(event) => change('setting', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-opening">Начальная ситуация</FieldLabel><Textarea id="story-opening" data-diagnostic-field="identity.opening_situation" value={value.opening_situation} onChange={(event) => change('opening_situation', event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="story-genres">Жанры</FieldLabel><Input id="story-genres" data-diagnostic-field="identity.genres" value={genresText} onChange={(event) => { setGenresText(event.target.value); change('genres', event.target.value.split(',').map((item) => item.trim()).filter(Boolean)) }} /></Field>
      <Field><FieldLabel htmlFor="story-tone">Тон</FieldLabel><Input id="story-tone" data-diagnostic-field="identity.tone" value={toneText} onChange={(event) => { setToneText(event.target.value); change('tone', event.target.value.split(',').map((item) => item.trim()).filter(Boolean)) }} /></Field>
      <Field><FieldLabel htmlFor="story-cover">Файл обложки</FieldLabel><Input ref={coverInput} id="story-cover" data-diagnostic-field="identity.cover_material_id" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} /><FieldDescription>PNG, JPEG или WebP. Для публикации укажите происхождение материала.</FieldDescription></Field>
      <Field><FieldLabel htmlFor="cover-creator">Автор обложки</FieldLabel><Input id="cover-creator" value={creator} onChange={(event) => setCreator(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="cover-license">Лицензия обложки</FieldLabel><Input id="cover-license" value={license} onChange={(event) => setLicense(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="cover-source">Источник обложки</FieldLabel><Input id="cover-source" value={source} onChange={(event) => setSource(event.target.value)} /></Field>
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
  </form>
}
