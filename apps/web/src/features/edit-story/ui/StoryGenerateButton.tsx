import { Sparkles } from 'lucide-react'

import type { StoryGenerationField } from '@/shared/api'
import { Button } from '@/shared/ui/button'

export type StoryFieldGenerator = (field: StoryGenerationField, currentText: string, targetId?: string) => void

export function StoryGenerateButton({ label, field, value, targetId, busy, disabled, onGenerate }: {
  label: string
  field: StoryGenerationField
  value: string
  targetId?: string
  busy: boolean
  disabled: boolean
  onGenerate: StoryFieldGenerator
}) {
  return <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onGenerate(field, value, targetId)}>
    <Sparkles aria-hidden="true" />{busy ? 'Генерируем…' : `Сгенерировать ${label.toLowerCase()}`}
  </Button>
}
