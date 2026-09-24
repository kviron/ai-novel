import { useState } from 'react'
import { ChevronUp, LoaderCircle, Send } from 'lucide-react'

import { resolveStoryTheme } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/shared/ui/drawer'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'

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

  const working = player.phase === 'loading' || player.phase === 'submitting' || player.checking
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
        <form className="action-form" onSubmit={(event) => { event.preventDefault(); void player.submit(player.action) }}>
          <FieldGroup><Field data-disabled={player.disabled}>
            <FieldLabel htmlFor="player-action" className="sr-only">Ваше действие</FieldLabel>
            <Input id="player-action" value={player.action} disabled={player.disabled} maxLength={4000} aria-describedby="player-status action-help" placeholder="Напишите своё действие…" onChange={(event) => player.setAction(event.target.value)} />
            <FieldDescription id="action-help" className="sr-only">Введите действие или выберите готовый вариант.</FieldDescription>
          </Field></FieldGroup>
          <Button type="submit" size="lg" disabled={player.disabled || !player.action.trim()} aria-describedby="player-status action-help">{player.phase === 'submitting' || player.phase === 'loading' ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Send data-icon="inline-start" aria-hidden="true" />}{player.phase === 'submitting' ? 'Генерация…' : player.phase === 'loading' ? 'Загрузка…' : 'Отправить'}</Button>
        </form>
        {choices.length > 0 && <Drawer open={choicesOpen} onOpenChange={setChoicesOpen} direction="bottom">
          <DrawerTrigger asChild><Button className="choices-trigger" type="button" variant="ghost" size="sm"><ChevronUp data-icon="inline-start" />Варианты ({choices.length})</Button></DrawerTrigger>
          <DrawerContent className="choices-drawer" style={resolveStoryTheme(session.story.slug).variables}>
            <DrawerHeader><DrawerTitle>Варианты ответа</DrawerTitle><DrawerDescription>Выберите действие, чтобы продолжить историю.</DrawerDescription></DrawerHeader>
            <div className="choices" aria-label="Варианты действия">
              {choices.map((choice) => <Button key={choice} variant="outline" size="lg" disabled={player.disabled} aria-describedby="player-status" onClick={() => { setChoicesOpen(false); void player.submit(choice) }}>{choice}</Button>)}
            </div>
          </DrawerContent>
        </Drawer>}
      </>}
    </div>
  </section>
}
