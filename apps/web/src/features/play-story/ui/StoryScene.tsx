import { useState } from 'react'
import { CornerUpLeft, List, LoaderCircle, Send } from 'lucide-react'

import { resolveStoryTheme } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/shared/ui/drawer'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/shared/ui/input-group'

import { useStoryPlayer } from '../model/useStoryPlayer'
import spriteSheet from './akane-sprite-sheet-v1.png'
import { TypewriterText } from './TypewriterText'

const expressions: Record<string, { label: string; position: string }> = {
  neutral: { label: 'Нейтральная', position: '0% center' }, happy: { label: 'Радость', position: '20% center' },
  sad: { label: 'Грусть', position: '40% center' }, angry: { label: 'Злость', position: '60% center' },
  surprised: { label: 'Удивление', position: '80% center' }, fan: { label: 'С веером', position: '100% center' },
}

export function StoryScene({ player }: { player: ReturnType<typeof useStoryPlayer> }) {
  const [choicesOpen, setChoicesOpen] = useState(false)
  const session = player.session
  const turn = session?.latest_turn
  const isAkaneStory = session?.story.slug === 'akane-neon-echo'
  const emotion = turn?.visual_directive.emotion ?? session?.visual_state?.emotion ?? 'neutral'
  const expression = expressions[emotion] ?? expressions.neutral
  const canRetry = player.phase === 'provider_unavailable' || player.reloadRequired || (!session && player.phase === 'error')

  const working = player.phase === 'loading' || player.phase === 'submitting' || player.rewinding || player.checking
  const choices = turn?.choices ?? (isAkaneStory ? ['Спросить о сигнале', 'Спросить о веере', 'Осмотреть комнату'] : [])

  return <section className="stage" aria-label="Игровая сцена" aria-busy={working}>
    <div className="rain" aria-hidden="true" /><div className="moon" aria-hidden="true" /><div className="city" aria-hidden="true" />
    {session && isAkaneStory && <div className="character-sprite" data-expression={expressions[emotion] ? emotion : 'neutral'} role="img" aria-label={`${session.characters[0]?.name ?? 'Аканэ'}: ${expression.label}`}
      style={{ aspectRatio: '1 / 3', backgroundImage: `url(${spriteSheet})`, backgroundSize: '600% 100%', backgroundPosition: expression.position }} />}
    <div className="dialogue">
      <div className="player-status">
        {(player.error || player.phase === 'provider_unavailable') && <Badge variant="destructive">{player.phase === 'provider_unavailable' ? 'Недоступно' : 'Ошибка'}</Badge>}
        <p id="player-status" role="status" aria-live="polite">{player.message}</p>
        {canRetry && <Button variant="outline" size="sm" disabled={player.checking} onClick={() => void player.retry()}>{player.checking ? 'Проверяем…' : 'Повторить проверку'}</Button>}
        {player.error && <p role="alert" className="text-destructive">{player.error}</p>}
      </div>
      {session && <>
        {(turn?.speaker || session.characters[0]?.name) && <p className="speaker">{turn?.speaker ?? session.characters[0]?.name}</p>}
        <div className="story-copy">
          <p className="narration">{turn?.narration ?? session.story.premise}</p>
          <TypewriterText text={turn?.dialogue ?? (isAkaneStory ? 'Вы всё-таки пришли. Что привело вас сюда?' : 'Начните историю своим действием.')} />
        </div>
        <Drawer open={choicesOpen} onOpenChange={setChoicesOpen} direction="bottom">
          <form className="action-form" onSubmit={(event) => { event.preventDefault(); void player.submit(player.action) }}>
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
