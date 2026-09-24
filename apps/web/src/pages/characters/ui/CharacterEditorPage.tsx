import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ImageIcon } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  api,
  type CharacterTextField as TextFieldName,
  type CharacterWrite,
} from '@/shared/api'
import { routes } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { CharacterArtwork } from './CharacterArtwork'
import { CharacterTextField } from './CharacterTextField'

const emptyProfile: CharacterWrite = {
  name: '',
  gender: 'unspecified',
  age: 18,
  personality: '',
  appearance: '',
  biography: '',
  speech: '',
  role: '',
}

export function CharacterEditorPage() {
  const { characterId } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<CharacterWrite>(emptyProfile)
  const [loading, setLoading] = useState(Boolean(characterId))
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState<TextFieldName | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!characterId) return
    const controller = new AbortController()
    void api
      .getCharacter(characterId, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return
        const revision = history.revisions.find(
          (item) => item.id === history.current_revision_id,
        )
        if (!revision) throw new Error('Current revision is missing')
        const {
          name,
          gender,
          age,
          personality,
          appearance,
          biography,
          speech,
          role,
        } = revision
        setProfile({
          name,
          gender,
          age,
          personality,
          appearance,
          biography,
          speech,
          role,
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [characterId])

  function change<K extends keyof CharacterWrite>(
    field: K,
    value: CharacterWrite[K],
  ) {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  async function generate(field: TextFieldName) {
    setGenerating(field)
    setError(null)
    try {
      const result = await api.generateCharacterField(field, profile)
      change(field, result.text)
    } catch {
      setError(
        'Не удалось сгенерировать описание. Проверьте Ollama и повторите.',
      )
    } finally {
      setGenerating(null)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...profile,
        name: profile.name.trim(),
        personality: profile.personality.trim(),
        appearance: profile.appearance.trim(),
      }
      const saved = characterId
        ? await api.reviseCharacter(characterId, payload)
        : await api.createCharacter(payload)
      navigate(routes.characterDetail(saved.character_id))
    } catch {
      setError(
        'Не удалось сохранить персонажа. Проверьте поля и повторите попытку.',
      )
      setSaving(false)
    }
  }

  const returnTo = characterId
    ? routes.characterDetail(characterId)
    : routes.characters
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 pt-12 sm:px-6">
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        to={returnTo}
      >
        <ArrowLeft className="size-4" />
        {characterId ? 'К персонажу' : 'Все персонажи'}
      </Link>
      <header className="max-w-2xl space-y-2">
        <p className="text-sm text-muted-foreground">Редактор персонажа</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {characterId ? 'Новая ревизия' : 'Новый персонаж'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Опишите героя для истории и агента. Генерация учитывает весь черновик,
          но ничего не сохраняет, пока вы не нажмёте кнопку сохранения.
        </p>
      </header>
      {loading ? (
        <p role="status">Загружаем профиль…</p>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Не удалось загрузить персонажа. Вернитесь к профилю и повторите
            попытку.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]"
          onSubmit={(event) => void save(event)}
        >
          <div className="grid gap-5">
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Основа персонажа
                </CardTitle>
                <CardDescription>
                  Кто этот человек в мире новеллы.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="character-name">Имя</FieldLabel>
                    <Input
                      id="character-name"
                      required
                      maxLength={120}
                      value={profile.name}
                      onChange={(event) => change('name', event.target.value)}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="character-gender">Пол</FieldLabel>
                      <Select
                        value={profile.gender}
                        onValueChange={(value) =>
                          change('gender', value as CharacterWrite['gender'])
                        }
                      >
                        <SelectTrigger id="character-gender" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unspecified">Не указан</SelectItem>
                          <SelectItem value="female">Женский</SelectItem>
                          <SelectItem value="male">Мужской</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="character-age">Возраст</FieldLabel>
                      <Input
                        id="character-age"
                        type="number"
                        min={18}
                        required
                        value={profile.age}
                        onChange={(event) =>
                          change('age', Number(event.target.value))
                        }
                      />
                    </Field>
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Характер и роль
                </CardTitle>
                <CardDescription>
                  Мотивы и поведение помогают агенту вести героя
                  последовательно.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <CharacterTextField
                    field="personality"
                    label="Характер"
                    hint="Черты, желания, страхи и внутренние противоречия."
                    required
                    value={profile.personality}
                    generating={generating === 'personality'}
                    busy={generating !== null || saving}
                    onChange={(value) => change('personality', value)}
                    onGenerate={() => void generate('personality')}
                  />
                  <CharacterTextField
                    field="role"
                    label="Роль"
                    hint="Место в истории и отношения с другими героями."
                    value={profile.role}
                    generating={generating === 'role'}
                    busy={generating !== null || saving}
                    onChange={(value) => change('role', value)}
                    onGenerate={() => void generate('role')}
                  />
                  <CharacterTextField
                    field="speech"
                    label="Манера речи"
                    hint="Лексика, интонация и особенности реплик."
                    value={profile.speech}
                    generating={generating === 'speech'}
                    busy={generating !== null || saving}
                    onChange={(value) => change('speech', value)}
                    onGenerate={() => void generate('speech')}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Внешность и образ
                </CardTitle>
                <CardDescription>
                  Постоянные признаки, на которые позже будут опираться аватар и
                  спрайты.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <CharacterTextField
                    field="appearance"
                    label="Внешность"
                    hint="Волосы, глаза, одежда, отличительные детали и художественный стиль."
                    required
                    value={profile.appearance}
                    generating={generating === 'appearance'}
                    busy={generating !== null || saving}
                    onChange={(value) => change('appearance', value)}
                    onGenerate={() => void generate('appearance')}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  История
                </CardTitle>
                <CardDescription>
                  События прошлого и связи, влияющие на решения персонажа.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <CharacterTextField
                    field="biography"
                    label="Биография"
                    hint="Укажите только важные для сюжета факты."
                    value={profile.biography}
                    generating={generating === 'biography'}
                    busy={generating !== null || saving}
                    onChange={(value) => change('biography', value)}
                    onGenerate={() => void generate('biography')}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline">
                <Link to={returnTo}>Отмена</Link>
              </Button>
              <Button type="submit" disabled={saving || generating !== null}>
                {saving
                  ? 'Сохраняем…'
                  : characterId
                    ? 'Создать ревизию'
                    : 'Создать персонажа'}
              </Button>
            </div>
          </div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Визуальные материалы
              </CardTitle>
              <CardDescription>
                Место для будущих аватара, спрайтов и образов.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {characterId ? (
                <CharacterArtwork
                  characterId={characterId}
                  name={profile.name}
                  className="aspect-[3/4] rounded-lg"
                />
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 text-muted-foreground">
                  <ImageIcon className="size-8" />
                  <span className="text-xs">Портрет появится здесь</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Генерацию и загрузку изображений добавим отдельным шагом;
                структура страницы уже оставляет для них место.
              </p>
            </CardContent>
          </Card>
        </form>
      )}
    </main>
  )
}
