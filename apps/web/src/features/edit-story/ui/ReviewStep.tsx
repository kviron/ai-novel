import type { DraftDiagnostic, StoryDraft } from '@/shared/api'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Separator } from '@/shared/ui/separator'

type Props = {
  draft: StoryDraft
  diagnostics: DraftDiagnostic[]
  busy: boolean
  actionError: string
  onValidate: () => Promise<void>
  onTest: () => Promise<void>
  onPublish: () => Promise<void>
  onClone: () => Promise<void>
  onDiagnostic: (diagnostic: DraftDiagnostic) => void
}

const stepLabels: Record<DraftDiagnostic['step'], string> = { identity: 'Основа', mode: 'Режим', hero: 'Герой', cast: 'Состав', rules: 'Правила', canon: 'Канон', review: 'Публикация' }

export function ReviewStep({ draft, diagnostics, busy, actionError, onValidate, onTest, onPublish, onClone, onDiagnostic }: Props) {
  const groups = diagnostics.reduce<Partial<Record<DraftDiagnostic['step'], DraftDiagnostic[]>>>((result, item) => {
    ;(result[item.step] ??= []).push(item)
    return result
  }, {})
  const grouped = Object.entries(groups) as [DraftDiagnostic['step'], DraftDiagnostic[]][]
  const hasErrors = diagnostics.some(({ severity }) => severity === 'error')
  return <div className="flex flex-col gap-4">
    {actionError && <Alert variant="destructive"><AlertTitle>Действие не выполнено</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Проверка перед публикацией</CardTitle><CardDescription>Полная сводка авторской версии, которую увидит игровой движок.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
      <section aria-labelledby="review-identity"><h2 id="review-identity">{draft.identity.title || 'Без названия'}</h2><p>{draft.identity.premise || 'Завязка не заполнена.'}</p><p className="text-muted-foreground">{draft.identity.setting || 'Мир не описан.'}</p></section><Separator />
      <section aria-labelledby="review-mode"><h2 id="review-mode">Режим и герой</h2><p>{draft.mode.mode === 'hybrid' ? 'Гибридная новелла' : 'Свободная новелла'} · {draft.hero.hero_policy === 'fixed' ? 'фиксированный герой' : 'выбор героя'}</p></section><Separator />
      <section aria-labelledby="review-rules"><h2 id="review-rules">Правила</h2><p>{draft.rules.generation_policy.choice_policy} · {draft.rules.generation_policy.prose_density} · {draft.rules.generation_policy.narration_perspective}</p><p>Темы: {draft.rules.themes_allowed.join(', ') || 'не заданы'}. Запрещено: {draft.rules.themes_blocked.join(', ') || 'не задано'}.</p></section><Separator />
      <section aria-labelledby="review-canon"><h2 id="review-canon">Канон</h2><p>{draft.canon.creative_goals || 'Творческие цели не заданы.'}</p><p>{draft.canon.facts.length} фактов · {draft.canon.beats.length} ключевых событий</p></section>
      {draft.status === 'published' && <Alert><AlertTitle>Опубликовано</AlertTitle><AlertDescription>Версия {draft.version_number} доступна игрокам и больше не изменяется.</AlertDescription></Alert>}
      {diagnostics.length > 0 && <section className="flex flex-col gap-3" aria-label="Результаты проверки">{grouped.map(([step, items]) => <div key={step} className="flex flex-col gap-2"><h2>{stepLabels[step]}</h2>{items.map((item) => <Button key={`${item.code}-${item.field}-${item.item_id}`} type="button" variant={item.severity === 'error' ? 'destructive' : 'outline'} className="justify-start whitespace-normal" onClick={() => onDiagnostic(item)}><Badge variant={item.severity === 'error' ? 'destructive' : 'secondary'}>{item.severity === 'error' ? 'Ошибка' : 'Предупреждение'}</Badge>{item.message}</Button>)}</div>)}</section>}
    </CardContent><CardFooter className="flex flex-wrap gap-2">
      {draft.status === 'published' ? <Button type="button" disabled={busy} onClick={() => void onClone()}>Создать новую редакцию</Button> : <><Button type="button" variant="outline" disabled={busy} onClick={() => void onValidate()}>Проверить черновик</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void onTest()}>Запустить тест</Button><Button type="button" disabled={busy || hasErrors} onClick={() => void onPublish()}>Опубликовать</Button></>}
    </CardFooter></Card>
  </div>
}
