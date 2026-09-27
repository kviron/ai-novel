import { Link } from 'react-router-dom'

import { routes } from '@/shared/config'
import { Button } from '@/shared/ui/button'

export function CreateStoryButton() {
  return <Button asChild><Link to={routes.studioStoryNew}>Создать новеллу</Link></Button>
}
