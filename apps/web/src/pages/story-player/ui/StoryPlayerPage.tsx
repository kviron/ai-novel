import { Button } from '@/shared/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import spriteSheet from './akane-sprite-sheet-v1.png'
import { useStoryPlayer } from '../model/story-player'
import { TypewriterText } from './TypewriterText'

const expressions: Record<string, { label: string; position: string }> = {
  neutral: { label: 'Нейтральная', position: '0% center' }, happy: { label: 'Радость', position: '20% center' },
  sad: { label: 'Грусть', position: '40% center' }, angry: { label: 'Злость', position: '60% center' },
  surprised: { label: 'Удивление', position: '80% center' }, fan: { label: 'С веером', position: '100% center' },
}

export function StoryPlayerPage({ sessionId }: { sessionId: string }) {
  const player = useStoryPlayer(sessionId)
  const session = player.session
  const turn = session?.latest_turn
  const emotion = turn?.visual_directive.emotion ?? session?.visual_state?.emotion ?? 'neutral'
  const expression = expressions[emotion] ?? expressions.neutral
  const canRetry = player.phase === 'provider_unavailable' || player.reloadRequired || (!session && player.phase === 'error')

  return <main className="game-shell" data-testid="story-player-route" data-session-id={sessionId}>
    <header className="game-header">
      <a className="logo" href="/">МНЕМОЗИНА <span>α</span></a>
      <h1>{session?.story.title ?? 'Ваше прохождение'}</h1>
      {session && <p className="provider-label">{session.provider_id} · {session.model_id}</p>}
    </header>
    <section className="stage" aria-label="Игровая сцена">
      <div className="rain" aria-hidden="true" /><div className="moon" aria-hidden="true" /><div className="city" aria-hidden="true" />
      {session && <div className="character-sprite" data-expression={expressions[emotion] ? emotion : 'neutral'} role="img" aria-label={`Аканэ: ${expression.label}`}
        style={{ aspectRatio: '1 / 3', backgroundImage: `url(${spriteSheet})`, backgroundSize: '600% 100%', backgroundPosition: expression.position }} />}
      <div className="dialogue">
        <div className="player-status">
          <p id="player-status" role="status" aria-live="polite">{player.message}</p>
          {canRetry && <Button variant="outline" size="sm" disabled={player.checking} onClick={() => void player.retry()}>{player.checking ? 'Проверяем…' : 'Повторить проверку'}</Button>}
          {player.error && <p role="alert" className="text-destructive">{player.error}</p>}
        </div>
        {session && <>
          <p className="speaker">{turn?.speaker ?? session.characters[0]?.name ?? 'Аканэ'}</p>
          <p className="narration">{turn?.narration ?? session.story.premise}</p>
          <TypewriterText text={turn?.dialogue ?? 'Вы всё-таки пришли. Что привело вас сюда?'} />
          <div className="choices" aria-label="Варианты действия">
            {(turn?.choices ?? ['Спросить о сигнале', 'Спросить о веере', 'Осмотреть комнату']).map((choice) => (
              <Button key={choice} variant="outline" disabled={player.disabled} aria-describedby="player-status" onClick={() => void player.submit(choice)}>{choice}</Button>
            ))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void player.submit(player.action) }}>
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
    <footer>{session && <span>Состояние · v{session.state_version}</span>}<span>Локальная сессия</span></footer>
  </main>
}
