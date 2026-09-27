import { useState } from 'react'
import { BookUser, Cpu, MessageSquareText, Save, Settings2, UserRound, X } from 'lucide-react'

import { api, ApiRequestError, type ModelProfile, type StorySession } from '@/shared/api'
import { resolveStoryTheme } from '@/shared/config'
import { Button } from '@/shared/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { Switch } from '@/shared/ui/switch'

import { useStoryPlayer } from '../model/useStoryPlayer'
import { ProtagonistCatalogSave } from './ProtagonistCatalogSave'

type Section = 'model' | 'messages' | 'hero' | 'progress' | 'catalog'
const sections = [
  { id: 'model', label: 'Модель', icon: Cpu },
  { id: 'messages', label: 'Сообщения', icon: MessageSquareText },
  { id: 'hero', label: 'Герой', icon: UserRound },
  { id: 'progress', label: 'Прогресс', icon: Save },
  { id: 'catalog', label: 'Каталог', icon: BookUser },
] as const

export function StorySettingsDialog({ player, session, showProtagonist, onShowProtagonistChange, working }: {
  player: ReturnType<typeof useStoryPlayer>
  session: StorySession
  showProtagonist: boolean
  onShowProtagonistChange: (checked: boolean) => void
  working: boolean
}) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('model')
  const [selectedModel, setSelectedModel] = useState('')
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [extractedName, setExtractedName] = useState('')
  const [extractError, setExtractError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const protagonistSpritesAvailable = Boolean(session.protagonist?.source_character_id && Object.values(session.protagonist.sprites ?? {}).some((variants) => variants.length > 0))

  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) {
      setSection('model')
      setSelectedModel(player.models.includes(session.model_id) ? session.model_id : '')
      setSelectedCharacter(session.characters[0]?.id ?? '')
      setExtractedName('')
      setExtractError('')
      void api.modelProfiles().then(setModelProfiles).catch(() => setModelProfiles([]))
    }
  }

  async function extractCharacter() {
    if (!selectedCharacter) return
    setExtracting(true)
    setExtractError('')
    try {
      const result = await api.extractSessionCharacter(session.id, selectedCharacter)
      setExtractedName(result.name)
    } catch (error) {
      setExtractError(error instanceof ApiRequestError ? error.message : 'Не удалось сохранить персонажа в каталог.')
    } finally {
      setExtracting(false)
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="icon-lg" aria-label="Настройки прохождения" title="Настройки прохождения" disabled={working}><Settings2 aria-hidden="true" /></Button></DialogTrigger>
    <DialogContent showCloseButton={false} className="story-settings-dialog flex flex-col gap-0 p-0" style={resolveStoryTheme(session.story.slug).variables}>
      <DialogHeader className="relative shrink-0 p-5 pb-2 pr-14">
        <DialogTitle>Настройки</DialogTitle>
        <DialogDescription className="sr-only">Параметры текущего прохождения</DialogDescription>
        <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Закрыть настройки" className="absolute top-4 right-4"><X aria-hidden="true" /></Button></DialogClose>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Разделы настроек" className="flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-48 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
          {sections.map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant={section === id ? 'secondary' : 'ghost'} className="shrink-0 justify-start md:w-full" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon data-icon="inline-start" aria-hidden="true" />{label}</Button>)}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:px-7 md:pt-3 md:pb-7">
          {section === 'model' && <section className="flex flex-col gap-5" aria-labelledby="story-settings-model">
            <div><h3 id="story-settings-model" className="text-base font-semibold">Модель нейросети</h3><p className="text-muted-foreground">Модель можно сменить между ходами без потери истории.</p></div>
            <FieldGroup><Field>
              <FieldLabel htmlFor="story-model">Модель {session.provider_id === 'ollama' ? 'Ollama' : session.provider_id}</FieldLabel>
              <Select value={selectedModel} onValueChange={setSelectedModel} disabled={working || player.models.length === 0}>
                <SelectTrigger id="story-model" className="w-full"><SelectValue placeholder="Выберите установленную модель" /></SelectTrigger>
                <SelectContent><SelectGroup>{player.models.map((model) => {
                  const profile = modelProfiles.find((item) => item.provider_id === session.provider_id && item.model_id === model)
                  return <SelectItem key={model} value={model}>{model}{profile?.working_window ? ` · ${profile.working_window.toLocaleString('ru-RU')} токенов` : ''}</SelectItem>
                })}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription>Сейчас: {session.model_id}{player.models.includes(session.model_id) ? '' : ' — не установлена'}. Контекст зависит от выбранной модели.</FieldDescription>
            </Field></FieldGroup>
            {player.models.length === 0 && <p className="text-muted-foreground">Ollama не сообщает об установленных моделях. Проверьте подключение.</p>}
            <Button type="button" className="self-start" disabled={!selectedModel || selectedModel === session.model_id || working} onClick={() => void player.changeModel(selectedModel)}>Применить модель</Button>
          </section>}
          {section === 'messages' && <section className="flex flex-col gap-3" aria-labelledby="player-input-help-title">
            <h3 id="player-input-help-title" className="text-base font-semibold">Как писать сообщения</h3>
            <p className="text-muted-foreground">Обычный текст описывает действие или состояние героя.</p>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
              <li><code>*действие*</code> — явно отметить поступок.</li>
              <li><code>«речь»</code> — слова, которые слышат персонажи.</li>
              <li><code>(мысль)</code> — внутреннее, чего персонажи не слышат.</li>
            </ul>
            <p className="text-muted-foreground">Enter — отправить сообщение. Shift+Enter — перейти на новую строку. Перед отправкой разбор можно открыть в панели слева.</p>
          </section>}
          {section === 'hero' && <section className="flex flex-col gap-5" aria-labelledby="story-settings-hero">
            <div><h3 id="story-settings-hero" className="text-base font-semibold">Герой игрока</h3><p className="text-muted-foreground">{session.protagonist?.name ?? 'Герой'}</p></div>
            {protagonistSpritesAvailable ? <FieldGroup><Field orientation="horizontal"><div className="flex flex-col gap-1"><FieldLabel htmlFor="show-protagonist">Показывать своего персонажа</FieldLabel><FieldDescription>Спрайт героя появится слева рядом с другими персонажами.</FieldDescription></div><Switch id="show-protagonist" checked={showProtagonist} onCheckedChange={onShowProtagonistChange} /></Field></FieldGroup> : <p className="text-muted-foreground">Для этого героя пока нет спрайтов.</p>}
            {session.protagonist?.source_kind === 'draft' && <ProtagonistCatalogSave sessionId={session.id} name={session.protagonist.name} appearance={session.protagonist.appearance} />}
          </section>}
          {section === 'progress' && <section className="flex flex-col gap-3" aria-labelledby="story-settings-progress">
            <h3 id="story-settings-progress" className="text-base font-semibold">Прогресс</h3>
            <div className="flex flex-col gap-1"><p className="font-medium">Автосохранение</p><p className="text-muted-foreground">Прогресс сохраняется после каждого хода. Для возврата используйте стрелку рядом с полем действия.</p></div>
          </section>}
          {section === 'catalog' && <section className="flex flex-col gap-5" aria-labelledby="story-settings-catalog">
            <div><h3 id="story-settings-catalog" className="text-base font-semibold">Каталог персонажей</h3><p className="text-muted-foreground">Сохраните персонажа из текущего прохождения отдельно.</p></div>
            <FieldGroup><Field><FieldLabel htmlFor="extract-character">Персонаж из прохождения</FieldLabel>
              <Select value={selectedCharacter} onValueChange={setSelectedCharacter} disabled={extracting || session.characters.length === 0}>
                <SelectTrigger id="extract-character" className="w-full"><SelectValue placeholder="Выберите персонажа" /></SelectTrigger>
                <SelectContent><SelectGroup>{session.characters.map((character) => <SelectItem key={character.id} value={character.id}>{character.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription>Создаст независимую копию закреплённой в этом прохождении версии.</FieldDescription>
            </Field></FieldGroup>
            <Button type="button" variant="outline" className="self-start" disabled={!selectedCharacter || extracting} onClick={() => void extractCharacter()}>{extracting ? 'Сохраняем…' : 'Сохранить персонажа в каталог'}</Button>
            {extractedName && <p role="status">{extractedName} добавлен в каталог как новый персонаж.</p>}
            {extractError && <p role="alert" className="text-destructive">{extractError}</p>}
          </section>}
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
