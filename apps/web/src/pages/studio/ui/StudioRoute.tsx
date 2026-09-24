import { useParams } from 'react-router-dom'

import { StudioPage } from './StudioPage'

export function StudioRoute() {
  const { sessionId } = useParams()
  return <StudioPage sessionId={sessionId} />
}
