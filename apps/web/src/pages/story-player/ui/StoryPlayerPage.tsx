import { StoryScene, useStoryPlayer } from '@/features/play-story'
import { resolveStoryTheme, routes } from '@/shared/config'

export function StoryPlayerPage({ sessionId }: { sessionId: string }) {
  const player = useStoryPlayer(sessionId)
  const theme = resolveStoryTheme(player.session?.story.slug)

  return <main className="game-shell" data-testid="story-player-route" data-session-id={sessionId} data-story-theme={theme.id} style={theme.variables}>
    <header className="game-header">
      <a className="logo" href={routes.novelLibrary}>МНЕМОЗИНА <span>α</span></a>
      <h1>{player.session?.story.title ?? 'Ваше прохождение'}</h1>
      <a className="mode-link" href={routes.studioSession(sessionId)}>Студия</a>
    </header>
    <StoryScene player={player} />
  </main>
}
