import type { DraftDiagnostic } from '@/shared/api'

const fieldAliases: Record<string, string> = {
  'identity.cover_material_id': 'identity.cover_material_id',
  'rules.generation_policy': 'rules.generation_policy',
  'canon.facts': 'canon.facts',
  'canon.beats': 'canon.beats',
  'cast.characters': 'cast.characters',
}

export function focusDraftDiagnostic(diagnostic: DraftDiagnostic) {
  const scope = diagnostic.item_id
    ? document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(diagnostic.item_id)}"]`) ?? document
    : document
  const canonical = fieldAliases[diagnostic.field] ?? diagnostic.field
  const marked = scope.querySelector<HTMLElement>(`[data-diagnostic-field="${CSS.escape(canonical)}"]`)
  const target = marked?.querySelector<HTMLElement>('button,input,textarea,[tabindex]')
    ?? (marked?.matches('button,input,textarea,[tabindex]') ? marked : null)
  target?.focus()
}
