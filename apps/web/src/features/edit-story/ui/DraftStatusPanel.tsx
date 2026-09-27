import { ArrowUpRight } from 'lucide-react'

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
  dirty: boolean
  actionError: string
  onValidate: () => Promise<void>
  onTest: () => Promise<void>
  onPublish: () => Promise<void>
  onClone: () => Promise<void>
  onDiagnostic: (diagnostic: DraftDiagnostic) => void
}

const stepLabels: Record<DraftDiagnostic['step'], string> = {
  identity: 'Основа', mode: 'Режим', hero: 'Герой', cast: 'Состав', rules: 'Правила', canon: 'Канон', review: 'Публикация',
}

export function DraftStatusPanel({ draft, diagnostics, busy, dirty, actionError, onValidate, onTest, onPublish, onClone, onDiagnostic }: Props) {
  const errors = diagnostics.filter((item) => item.severity === 'error').length
  const warnings = diagnostics.length - errors
  const groups = diagnostics.reduce<Partial<Record<DraftDiagnostic['step'], DraftDiagnostic[]>>>((result, item) => {
    ;(result[item.step] ??= []).push(item)
    return result
  }, {})
  const grouped = Object.entries(groups) as [DraftDiagnostic['step'], DraftDiagnostic[]][]

  return <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Статус проверки">
    <Card className="lg:max-h-[calc(100dvh-12rem)]">
      <CardHeader className="shrink-0">
        <CardTitle>Статус проверки</CardTitle>
        <CardDescription>{draft.status === 'published' ? `Версия ${draft.version_number} опубликована` : 'Проверка черновика перед тестом и публикацией'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          <Badge variant={draft.status === 'published' ? 'default' : errors ? 'destructive' : 'secondary'}>{draft.status === 'published' ? 'Опубликовано' : errors ? `${errors} ошибок` : 'Черновик'}</Badge>
          {warnings > 0 && <Badge variant="outline">{warnings} предупреждений</Badge>}
        </div>
        {dirty && <p className="text-muted-foreground">Сохраните изменения раздела перед проверкой.</p>}
        {actionError && <Alert variant="destructive"><AlertTitle>Действие не выполнено</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
        <Separator />
        {diagnostics.length ? <section className="flex flex-col gap-4" aria-label="Результаты проверки">
          {grouped.map(([step, items]) => <div key={step} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{stepLabels[step]}</h2>
            {items.map((item) => <div key={`${item.code}-${item.field}-${item.item_id}`} className="flex items-start gap-2 rounded-md border p-2">
              <p className="min-w-0 flex-1 text-xs/relaxed">{item.message}</p>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Перейти: ${item.message}`} title="Перейти к полю" disabled={dirty} onClick={() => onDiagnostic(item)}><ArrowUpRight aria-hidden="true" /></Button>
            </div>)}
          </div>)}
        </section> : <p className="text-muted-foreground">Замечаний пока нет. Запустите проверку черновика.</p>}
      </CardContent>
      <CardFooter className="flex shrink-0 flex-col items-stretch gap-2 border-t bg-card">
        {draft.status === 'published' ? <Button type="button" disabled={busy} onClick={() => void onClone()}>Создать новую редакцию</Button> : <>
          <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => void onValidate()}>Проверить черновик</Button>
          <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => void onTest()}>Запустить тест</Button>
          <Button type="button" disabled={busy || dirty || errors > 0} onClick={() => void onPublish()}>Опубликовать</Button>
        </>}
      </CardFooter>
    </Card>
  </aside>
}
