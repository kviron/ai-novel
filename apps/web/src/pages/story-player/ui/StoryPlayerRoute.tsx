import { useParams } from 'react-router-dom'

export function StoryPlayerRoute() {
  const { sessionId = '' } = useParams()
  return <main data-testid="story-player-route" data-session-id={sessionId} />
}
