import { Sparkles } from 'lucide-react'

import { type CharacterTextField as TextFieldName } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field'
import { Textarea } from '@/shared/ui/textarea'

export function CharacterTextField({
  field,
  label,
  hint,
  value,
  required,
  generating,
  busy,
  onChange,
  onGenerate,
}: {
  field: TextFieldName
  label: string
  hint: string
  value: string
  required?: boolean
  generating: boolean
  busy: boolean
  onChange: (value: string) => void
  onGenerate: () => void
}) {
  const id = `character-${field}`
  return (
    <Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onGenerate}
        >
          <Sparkles aria-hidden="true" />
          {generating ? 'Генерируем…' : `Сгенерировать ${label.toLowerCase()}`}
        </Button>
      </div>
      <Textarea
        id={id}
        required={required}
        rows={4}
        value={value}
        disabled={generating}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  )
}
