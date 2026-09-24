import { LoaderCircle } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
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
  const session = player.session
  const turn = session?.latest_turn
  const isAkaneStory = session?.story.slug === 'akane-neon-echo'
  const emotion = turn?.visual_directive.emotion ?? session?.visual_state?.emotion ?? 'neutral'
  const expression = expressions[emotion] ?? expressions.neutral
  const canRetry = player.phase === 'provider_unavailable' || player.reloadRequired || (!session && player.phase === 'error')

  const working = player.phase === 'loading' || player.phase === 'submitting' || player.checking

  return <section className="stage" aria-label="Игровая сцена" aria-busy={working}>
    <div className="rain" aria-hidden="true" /><div className="moon" aria-hidden="true" /><div className="city" aria-hidden="true" />
    {session && isAkaneStory && <div className="character-sprite" data-expression={expressions[emotion] ? emotion : 'neutral'} role="img" aria-label={`${session.characters[0]?.name ?? 'Аканэ'}: ${expression.label}`}
      style={{ aspectRatio: '1 / 3', backgroundImage: `url(${spriteSheet})`, backgroundSize: '600% 100%', backgroundPosition: expression.position }} />}
    <div className="dialogue">
      <div className="player-status">
        <Badge variant={player.error || player.phase === 'provider_unavailable' ? 'destructive' : 'secondary'}>{working && <LoaderCircle className="animate-spin" aria-hidden="true" />}{player.phase === 'submitting' ? 'Генерация' : player.phase === 'loading' ? 'Загрузка' : player.phase === 'provider_unavailable' ? 'Недоступно' : player.phase === 'error' ? 'Ошибка' : 'Готово'}</Badge>
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
        <div className="choices" aria-label="Варианты действия">
          {(turn?.choices ?? (isAkaneStory ? ['Спросить о сигнале', 'Спросить о веере', 'Осмотреть комнату'] : [])).map((choice) => (
            <Button key={choice} variant="outline" disabled={player.disabled} aria-describedby="player-status" onClick={() => void player.submit(choice)}>{choice}</Button>
          ))}
        </div>
        <form className="action-form" onSubmit={(event) => { event.preventDefault(); void player.submit(player.action) }}>
          <FieldGroup><Field data-disabled={player.disabled}>
            <FieldLabel htmlFor="player-action">Ваше действие</FieldLabel>
            <Input id="player-action" value={player.action} disabled={player.disabled} maxLength={4000} aria-describedby="player-status action-help" placeholder="Напишите своё действие…" onChange={(event) => player.setAction(event.target.value)} />
            <FieldDescription id="action-help">Введите действие или выберите один из вариантов выше.</FieldDescription>
          </Field></FieldGroup>
          <Button type="submit" disabled={player.disabled || !player.action.trim()} aria-describedby="player-status action-help">Отправить</Button>
        </form>
      </>}
    </div>
  </section>
}
