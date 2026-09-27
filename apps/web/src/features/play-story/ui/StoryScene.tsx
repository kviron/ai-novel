import { useEffect, useState } from 'react'
import { CornerUpLeft, List, ListFilter, LoaderCircle, Send } from 'lucide-react'

import { resolveStoryTheme } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/shared/ui/drawer'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { InputGroup, InputGroupTextarea } from '@/shared/ui/input-group'

import { useStoryPlayer } from '../model/useStoryPlayer'
import { parsePlayerInput } from '../model/playerInput'
import { CharacterSprite } from './CharacterSprite'
import { DialogueHistory } from './DialogueHistory'
import { SceneBackground } from './SceneBackground'
import { SceneSegments } from './SceneSegments'
import { StorySettingsDialog } from './StorySettingsDialog'

export function StoryScene({ player }: { player: ReturnType<typeof useStoryPlayer> }) {
  const [openSheet, setOpenSheet] = useState<'choices' | 'analysis' | null>(null)
  const [showProtagonist, setShowProtagonist] = useState(false)
  const session = player.session

  useEffect(() => {
    if (session?.id) setShowProtagonist(localStorage.getItem(`mnemosyne.session.${session.id}.show-protagonist`) === 'true')
  }, [session?.id])

  function toggleProtagonist(checked: boolean) {
    if (!session) return
    setShowProtagonist(checked)
    localStorage.setItem(`mnemosyne.session.${session.id}.show-protagonist`, String(checked))
  }
  const turn = session?.latest_turn
  const isAkaneStory = session?.story.slug === 'akane-neon-echo'
  const hasAkaneNpc = isAkaneStory && session?.characters.some((character) => character.id === 'akane')
  const canRetry = player.phase === 'provider_unavailable' || player.reloadRequired || (!session && player.phase === 'error')

  const working = player.phase === 'loading' || player.phase === 'submitting' || player.rewinding || player.phase === 'switching_model' || player.checking
  const choices = turn?.choices ?? (isAkaneStory ? ['Спросить о сигнале', 'Спросить о веере', 'Осмотреть комнату'] : [])
  const sceneSpeakers = new Set(turn?.segments?.filter((part) => part.kind === 'dialogue').map((part) => part.character_id))
  const singleSpeaker = sceneSpeakers.size <= 1
  const activeCharacter = session?.characters.find((character) => character.id === turn?.visual_directive.character_id)

  return <section className="stage" aria-label="Игровая сцена" aria-busy={working}>
    {isAkaneStory && session
      ? <SceneBackground storySlug={session.story.slug} background={turn?.visual_directive.background ?? session.visual_state.background} />
      : <><div className="rain" aria-hidden="true" /><div className="moon" aria-hidden="true" /><div className="city" aria-hidden="true" /></>}
    {session && <CharacterSprite session={session} showProtagonist={showProtagonist} />}
    <div className="dialogue">
      <div className="scene-message"><div className="player-status">
        {(player.error || player.phase === 'provider_unavailable') && <Badge variant="destructive">{player.phase === 'provider_unavailable' ? 'Недоступно' : 'Ошибка'}</Badge>}
        <p id="player-status" role="status" aria-live="polite">{player.message}</p>
        {canRetry && <Button variant="outline" size="sm" disabled={player.checking} onClick={() => void player.retry()}>{player.checking ? 'Проверяем…' : 'Повторить проверку'}</Button>}
        {player.error && <p role="alert" className="text-destructive">{player.error}</p>}
      </div>
      {session && <>
        {(turn?.speaker || hasAkaneNpc) && singleSpeaker && <p className="speaker" style={activeCharacter?.color ? { backgroundColor: `color-mix(in srgb, ${activeCharacter.color} 65%, #111)` } : undefined}>{turn?.speaker?.split(/\s+/)[0] ?? 'Аканэ'}</p>}
        <div className="story-copy">
          <SceneSegments segments={turn?.segments} narration={turn?.narration ?? session.story.premise} dialogue={turn?.dialogue ?? (hasAkaneNpc ? 'Вы всё-таки пришли. Что привело вас сюда?' : '')} speaker={turn?.speaker ?? (hasAkaneNpc ? session.characters.find((character) => character.id === 'akane')?.name ?? '' : '')} characters={session.characters} animateLast hideSpeakerNames={singleSpeaker} />
          {!turn && !hasAkaneNpc && <p className="text-sm text-muted-foreground">Начните историю своим действием.</p>}
        </div>
      </>}
      </div>
      {session && <Drawer open={openSheet !== null} onOpenChange={(open) => { if (!open) setOpenSheet(null) }} direction="bottom">
          <form className="action-form" onSubmit={(event) => { event.preventDefault(); setOpenSheet(null); void player.submit(player.action) }}>
            <div className="scene-toolbar" role="toolbar" aria-label="Управление прохождением">
            <StorySettingsDialog player={player} session={session} showProtagonist={showProtagonist} onShowProtagonistChange={toggleProtagonist} working={working} />
            <Button type="button" variant="outline" size="icon-lg" aria-label="Отменить ход" title="Отменить ход" disabled={!session.can_rewind || working || player.reloadRequired} onClick={() => void player.rewind()}><CornerUpLeft aria-hidden="true" /></Button>
            {choices.length > 0 && <Button type="button" variant="outline" size="icon-lg" aria-label={`Варианты (${choices.length})`} title="Варианты ответа" onClick={() => setOpenSheet('choices')}><List aria-hidden="true" /></Button>}
            <Button type="button" variant="outline" size="icon-lg" aria-label="Разбор сообщения" title="Разбор сообщения" disabled={player.disabled || !player.action.trim()} onClick={() => setOpenSheet('analysis')}><ListFilter aria-hidden="true" /></Button>
            <DialogueHistory sessionId={session.id} storySlug={session.story.slug} characters={session.characters} />
            </div>
            <FieldGroup><Field data-disabled={player.disabled}>
              <FieldLabel htmlFor="player-action" className="sr-only">Ваше действие</FieldLabel>
              <InputGroup>
                <InputGroupTextarea id="player-action" className="min-h-8 max-h-[4.5rem] overflow-y-auto py-1.5 text-sm/5 md:text-sm/5" value={player.action} disabled={player.disabled} maxLength={4000} rows={1} aria-describedby="player-status action-help" placeholder="Введите сообщение…" onChange={(event) => player.setAction(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (player.action.trim() && !player.disabled) event.currentTarget.form?.requestSubmit() } }} />
              </InputGroup>
              <FieldDescription id="action-help" className="sr-only">Введите действие или выберите готовый вариант. Формат сообщения описан в настройках прохождения.</FieldDescription>
            </Field></FieldGroup>
            <Button type="submit" size="icon-lg" className="size-[2.375rem]" disabled={player.disabled || !player.action.trim()} aria-label={player.phase === 'submitting' ? 'Генерация…' : player.phase === 'loading' ? 'Загрузка…' : 'Отправить'} title={player.phase === 'submitting' ? 'Генерация…' : 'Отправить'} aria-describedby="player-status action-help">{player.phase === 'submitting' || player.phase === 'loading' ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Send data-icon="inline-start" aria-hidden="true" />}</Button>
          </form>
          {openSheet === 'analysis' && <DrawerContent className="choices-drawer" style={resolveStoryTheme(session.story.slug).variables}>
            <DrawerHeader><DrawerTitle>Разбор сообщения</DrawerTitle><DrawerDescription>Так новелла поймёт ваш текст перед отправкой.</DrawerDescription></DrawerHeader>
            <div className="player-input-breakdown" aria-label="Как новелла прочитает сообщение">
              {parsePlayerInput(player.action).map((part, index) => <div key={index} className="player-input-part" data-kind={part.kind}><strong>{part.kind === 'speech' ? 'Речь' : part.kind === 'thought' ? 'Мысль' : part.kind === 'explicit_action' ? 'Действие' : 'Описание'}</strong><span>{part.text}</span></div>)}
            </div>
          </DrawerContent>}
          {openSheet === 'choices' && choices.length > 0 && <DrawerContent className="choices-drawer" style={resolveStoryTheme(session.story.slug).variables}>
            <DrawerHeader><DrawerTitle>Варианты ответа</DrawerTitle><DrawerDescription>Выберите действие, чтобы продолжить историю.</DrawerDescription></DrawerHeader>
            <div className="choices" aria-label="Варианты действия">
              {choices.map((choice) => <Button key={choice} variant="outline" size="lg" disabled={player.disabled} aria-describedby="player-status" onClick={() => { setOpenSheet(null); void player.submit(choice) }}>{choice}</Button>)}
            </div>
          </DrawerContent>}
        </Drawer>}
    </div>
  </section>
}
