import { DialogueHistory, StoryScene, useStoryPlayer } from '@/features/play-story'
import { resolveStoryTheme, routes } from '@/shared/config'

export function StoryPlayerPage({ sessionId }: { sessionId: string }) {
  const player = useStoryPlayer(sessionId)
  const theme = resolveStoryTheme(player.session?.story.slug)

  return <div className="game-shell" data-testid="story-player-route" data-session-id={sessionId} data-story-theme={theme.id} style={theme.variables}>
    <header className="game-header">
      <div className="game-header-title"><h1>{player.session?.story.title ?? 'Ваше прохождение'}</h1><DialogueHistory sessionId={sessionId} storySlug={player.session?.story.slug} characters={player.session?.characters} /></div>
      <a className="mode-link" href={routes.studioSession(sessionId)}>Студия</a>
    </header>
    <StoryScene player={player} />
  </div>
}
