import { useParams } from 'react-router-dom'
import { StoryPlayerPage } from './StoryPlayerPage'

export function StoryPlayerRoute() {
  const { sessionId = '' } = useParams()
  return <StoryPlayerPage key={sessionId} sessionId={sessionId} />
}
