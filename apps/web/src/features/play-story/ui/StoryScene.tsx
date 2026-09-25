import { useState } from 'react'
import { CornerUpLeft, List, LoaderCircle, Send, Settings2 } from 'lucide-react'

import { resolveStoryTheme } from '@/shared/config'
import { api, ApiRequestError } from '@/shared/api'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/shared/ui/drawer'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/shared/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Separator } from '@/shared/ui/separator'

import { useStoryPlayer } from '../model/useStoryPlayer'
import { CharacterSprite } from './CharacterSprite'
import { SceneBackground } from './SceneBackground'
import { SceneSegments } from './SceneSegments'

export function StoryScene({ player }: { player: ReturnType<typeof useStoryPlayer> }) {
  const [choicesOpen, setChoicesOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [extractedName, setExtractedName] = useState('')
  const [extractError, setExtractError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const session = player.session
  const turn = session?.latest_turn
  const isAkaneStory = session?.story.slug === 'akane-neon-echo'
  const canRetry = player.phase === 'provider_unavailable' || player.reloadRequired || (!session && player.phase === 'error')

  const working = player.phase === 'loading' || player.phase === 'submitting' || player.rewinding || player.phase === 'switching_model' || player.checking
  const choices = turn?.choices ?? (isAkaneStory ? ['Спросить о сигнале', 'Спросить о веере', 'Осмотреть комнату'] : [])
  const sceneSpeakers = new Set(turn?.segments?.filter((part) => part.kind === 'dialogue').map((part) => part.character_id))
  const singleSpeaker = sceneSpeakers.size <= 1
  const activeCharacter = session?.characters.find((character) => character.id === turn?.visual_directive.character_id)

  async function extractCharacter() {
    if (!session || !selectedCharacter) return
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

  return <section className="stage" aria-label="Игровая сцена" aria-busy={working}>
    {isAkaneStory && session
      ? <SceneBackground storySlug={session.story.slug} background={turn?.visual_directive.background ?? session.visual_state.background} />
      : <><div className="rain" aria-hidden="true" /><div className="moon" aria-hidden="true" /><div className="city" aria-hidden="true" /></>}
    {session && <CharacterSprite session={session} />}
    <div className="dialogue">
      <div className="player-status">
        {(player.error || player.phase === 'provider_unavailable') && <Badge variant="destructive">{player.phase === 'provider_unavailable' ? 'Недоступно' : 'Ошибка'}</Badge>}
        <p id="player-status" role="status" aria-live="polite">{player.message}</p>
        {canRetry && <Button variant="outline" size="sm" disabled={player.checking} onClick={() => void player.retry()}>{player.checking ? 'Проверяем…' : 'Повторить проверку'}</Button>}
        {player.error && <p role="alert" className="text-destructive">{player.error}</p>}
      </div>
      {session && <>
        {(turn?.speaker || session.characters[0]?.name) && singleSpeaker && <p className="speaker" style={activeCharacter?.color ? { backgroundColor: `color-mix(in srgb, ${activeCharacter.color} 65%, #111)` } : undefined}>{turn?.speaker?.split(/\s+/)[0] ?? session.characters[0]?.name.split(/\s+/)[0]}</p>}
        <div className="story-copy">
          <SceneSegments segments={turn?.segments} narration={turn?.narration ?? session.story.premise} dialogue={turn?.dialogue ?? (isAkaneStory ? 'Вы всё-таки пришли. Что привело вас сюда?' : 'Начните историю своим действием.')} speaker={turn?.speaker ?? session.characters[0]?.name ?? ''} characters={session.characters} animateLast hideSpeakerNames={singleSpeaker} />
        </div>
        <Drawer open={choicesOpen} onOpenChange={setChoicesOpen} direction="bottom">
          <form className="action-form" onSubmit={(event) => { event.preventDefault(); void player.submit(player.action) }}>
            <Dialog open={toolsOpen} onOpenChange={(open) => { setToolsOpen(open); if (open) { setSelectedModel(player.models.includes(session.model_id) ? session.model_id : ''); setSelectedCharacter(session.characters[0]?.id ?? ''); setExtractedName(''); setExtractError('') } }}>
              <DialogTrigger asChild><Button type="button" variant="outline" size="icon-lg" aria-label="Настройки прохождения" title="Настройки прохождения" disabled={working}><Settings2 aria-hidden="true" /></Button></DialogTrigger>
              <DialogContent style={resolveStoryTheme(session.story.slug).variables}>
                <DialogHeader><DialogTitle>Настройки прохождения</DialogTitle><DialogDescription>Модель можно сменить между ходами без потери истории.</DialogDescription></DialogHeader>
                <div className="flex flex-col gap-3">
                  <FieldGroup><Field>
                    <FieldLabel htmlFor="story-model">Модель Ollama</FieldLabel>
                    <Select value={selectedModel} onValueChange={setSelectedModel} disabled={working || player.models.length === 0}>
                      <SelectTrigger id="story-model" className="w-full"><SelectValue placeholder="Выберите установленную модель" /></SelectTrigger>
                      <SelectContent><SelectGroup>{player.models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>Сейчас: {session.model_id}{player.models.includes(session.model_id) ? '' : ' — не установлена'}</FieldDescription>
                  </Field></FieldGroup>
                  {player.models.length === 0 && <p className="text-muted-foreground">Ollama не сообщает об установленных моделях. Проверьте подключение.</p>}
                  <Separator />
                  <div className="flex flex-col gap-1"><p className="font-medium">Автосохранение</p><p className="text-muted-foreground">Прогресс сохраняется после каждого хода. Для возврата используйте стрелку рядом с полем действия.</p></div>
                  <Separator />
                  <FieldGroup><Field><FieldLabel htmlFor="extract-character">Персонаж из прохождения</FieldLabel>
                    <Select value={selectedCharacter} onValueChange={setSelectedCharacter} disabled={extracting || session.characters.length === 0}>
                      <SelectTrigger id="extract-character" className="w-full"><SelectValue placeholder="Выберите персонажа" /></SelectTrigger>
                      <SelectContent><SelectGroup>{session.characters.map((character) => <SelectItem key={character.id} value={character.id}>{character.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>Создаст независимую копию закреплённой в этом прохождении версии.</FieldDescription>
                  </Field></FieldGroup>
                  <Button type="button" variant="outline" disabled={!selectedCharacter || extracting} onClick={() => void extractCharacter()}>{extracting ? 'Сохраняем…' : 'Сохранить персонажа в каталог'}</Button>
                  {extractedName && <p role="status">{extractedName} добавлен в каталог как новый персонаж.</p>}
                  {extractError && <p role="alert" className="text-destructive">{extractError}</p>}
                </div>
                <DialogFooter><Button type="button" disabled={!selectedModel || selectedModel === session.model_id || working} onClick={() => void player.changeModel(selectedModel)}>Применить модель</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Button type="button" variant="outline" size="icon-lg" aria-label="Отменить ход" title="Отменить ход" disabled={!session.can_rewind || working || player.reloadRequired} onClick={() => void player.rewind()}><CornerUpLeft aria-hidden="true" /></Button>
            <FieldGroup><Field data-disabled={player.disabled}>
              <FieldLabel htmlFor="player-action" className="sr-only">Ваше действие</FieldLabel>
              <InputGroup>
                <InputGroupInput id="player-action" value={player.action} disabled={player.disabled} maxLength={4000} aria-describedby="player-status action-help" placeholder="Напишите своё действие…" onChange={(event) => player.setAction(event.target.value)} />
                {choices.length > 0 && <InputGroupAddon align="inline-start"><DrawerTrigger asChild><InputGroupButton size="icon-xs" aria-label={`Варианты (${choices.length})`} title="Варианты ответа"><List data-icon="inline-start" aria-hidden="true" /></InputGroupButton></DrawerTrigger></InputGroupAddon>}
              </InputGroup>
              <FieldDescription id="action-help" className="sr-only">Введите действие или выберите готовый вариант.</FieldDescription>
            </Field></FieldGroup>
            <Button type="submit" size="icon-lg" disabled={player.disabled || !player.action.trim()} aria-label={player.phase === 'submitting' ? 'Генерация…' : player.phase === 'loading' ? 'Загрузка…' : 'Отправить'} title={player.phase === 'submitting' ? 'Генерация…' : 'Отправить'} aria-describedby="player-status action-help">{player.phase === 'submitting' || player.phase === 'loading' ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Send data-icon="inline-start" aria-hidden="true" />}</Button>
          </form>
          {choices.length > 0 && <DrawerContent className="choices-drawer" style={resolveStoryTheme(session.story.slug).variables}>
            <DrawerHeader><DrawerTitle>Варианты ответа</DrawerTitle><DrawerDescription>Выберите действие, чтобы продолжить историю.</DrawerDescription></DrawerHeader>
            <div className="choices" aria-label="Варианты действия">
              {choices.map((choice) => <Button key={choice} variant="outline" size="lg" disabled={player.disabled} aria-describedby="player-status" onClick={() => { setChoicesOpen(false); void player.submit(choice) }}>{choice}</Button>)}
            </div>
          </DrawerContent>}
        </Drawer>
      </>}
    </div>
  </section>
}
