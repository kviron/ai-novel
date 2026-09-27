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
  const revision = (id: string | null) => draft.character_revisions.find((item) => item.id === id)
  const yesNo = (value: boolean) => value ? 'да' : 'нет'
  const condition = (beat: StoryDraft['canon']['beats'][number]) => beat.activation_condition.kind === 'always' ? 'always' : beat.activation_condition.kind === 'after_turn_count' ? `after_turn_count: ${beat.activation_condition.turn_count}` : `after_beat: ${beat.activation_condition.beat_id}`
  return <div className="flex flex-col gap-4">
    {actionError && <Alert variant="destructive"><AlertTitle>Действие не выполнено</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Проверка перед публикацией</CardTitle><CardDescription>Полная сводка авторской версии, которую увидит игровой движок.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
      <section aria-labelledby="review-identity"><h2 id="review-identity">{draft.identity.title || 'Без названия'}</h2><dl className="grid gap-2"><dt>Slug</dt><dd>{draft.identity.slug || '—'}</dd><dt>Описание</dt><dd>{draft.identity.short_description || '—'}</dd><dt>Замысел</dt><dd>{draft.identity.premise || '—'}</dd><dt>Жанры</dt><dd>{draft.identity.genres.join(', ') || '—'}</dd><dt>Тон</dt><dd>{draft.identity.tone.join(', ') || '—'}</dd><dt>Мир</dt><dd>{draft.identity.setting || '—'}</dd><dt>Начальная ситуация</dt><dd>{draft.identity.opening_situation || '—'}</dd><dt>Обложка</dt><dd>{draft.identity.cover_material_id || '—'}</dd><dt>Возрастной рейтинг</dt><dd>{draft.identity.content_rating}</dd></dl></section><Separator />
      <section aria-labelledby="review-mode"><h2 id="review-mode">Режим и герой</h2><dl className="grid gap-2"><dt>Режим</dt><dd>{draft.mode.mode}</dd><dt>Политика героя</dt><dd>{draft.hero.hero_policy}</dd><dt>Источники героя</dt><dd>{draft.hero.hero_allowed_sources.join(', ') || '—'}</dd><dt>Ревизия героя</dt><dd>{draft.hero.fixed_hero_revision_id || '—'}{revision(draft.hero.fixed_hero_revision_id) ? ` · ${revision(draft.hero.fixed_hero_revision_id)!.name}` : ''}</dd></dl></section><Separator />
      <section aria-labelledby="review-cast"><h2 id="review-cast">Состав</h2>{draft.cast.characters.length ? [...draft.cast.characters].sort((a, b) => a.order_index - b.order_index).map((member) => <dl key={member.id} className="grid gap-2"><dt>{member.id}</dt><dd>{revision(member.revision_id)?.name ?? member.character_id} · {member.character_id} · {member.revision_id} · {member.role} · {member.color} · playable: {yesNo(member.playable)} · order: {member.order_index}</dd></dl>) : <p>Дополнительных персонажей нет.</p>}</section><Separator />
      <section aria-labelledby="review-rules"><h2 id="review-rules">Правила</h2><dl className="grid gap-2"><dt>Разрешённые темы</dt><dd>{draft.rules.themes_allowed.join(', ') || '—'}</dd><dt>Запрещённые темы</dt><dd>{draft.rules.themes_blocked.join(', ') || '—'}</dd><dt>Завершение</dt><dd>{draft.rules.ending_policy}</dd><dt>Перспектива</dt><dd>{draft.rules.generation_policy.narration_perspective}</dd><dt>Плотность прозы</dt><dd>{draft.rules.generation_policy.prose_density}</dd><dt>Выбор</dt><dd>{draft.rules.generation_policy.choice_policy} · {draft.rules.generation_policy.min_choices}–{draft.rules.generation_policy.max_choices}</dd><dt>Романтика</dt><dd>{yesNo(draft.rules.generation_policy.allow_romance)}</dd><dt>Насилие</dt><dd>{yesNo(draft.rules.generation_policy.allow_violence)}</dd><dt>Ужас</dt><dd>{yesNo(draft.rules.generation_policy.allow_horror)}</dd><dt>Сексуальные темы</dt><dd>{yesNo(draft.rules.generation_policy.allow_sexual_themes)}</dd><dt>Желаемые мотивы</dt><dd>{draft.rules.generation_policy.desired_themes || '—'}</dd><dt>Запрещённые исходы</dt><dd>{draft.rules.generation_policy.forbidden_outcomes || '—'}</dd><dt>Провайдер</dt><dd>{draft.rules.recommended_provider_id}</dd><dt>Модель</dt><dd>{draft.rules.recommended_model_id}</dd></dl></section><Separator />
      <section aria-labelledby="review-canon"><h2 id="review-canon">Канон</h2><p>{draft.canon.creative_goals || 'Творческие цели не заданы.'}</p><h3>Факты</h3>{[...draft.canon.facts].sort((a, b) => a.order_index - b.order_index).map((fact, position) => <dl key={fact.id} className="grid gap-2"><dt>{position + 1}. {fact.title}</dt><dd>ID: {fact.id} · order_index: {fact.order_index}</dd><dd>{fact.statement} · {fact.severity} · {fact.scope} · персонажи: {fact.referenced_character_ids.join(', ') || '—'}</dd></dl>)}<h3>События</h3>{[...draft.canon.beats].sort((a, b) => a.order_index - b.order_index).map((beat, position) => <dl key={beat.id} className="grid gap-2"><dt>{position + 1}. {beat.title}</dt><dd>ID: {beat.id} · order_index: {beat.order_index}</dd><dd>{beat.description} · {condition(beat)} · завершение: {beat.completion_evidence || '—'} · required: {yesNo(beat.required)} · ending_gate: {yesNo(beat.ending_gate)}</dd></dl>)}</section>
      {draft.status === 'published' && <Alert><AlertTitle>Опубликовано</AlertTitle><AlertDescription>Версия {draft.version_number} доступна игрокам и больше не изменяется.</AlertDescription></Alert>}
      {diagnostics.length > 0 && <section className="flex flex-col gap-3" aria-label="Результаты проверки">{grouped.map(([step, items]) => <div key={step} className="flex flex-col gap-2"><h2>{stepLabels[step]}</h2>{items.map((item) => <Button key={`${item.code}-${item.field}-${item.item_id}`} type="button" variant={item.severity === 'error' ? 'destructive' : 'outline'} className="justify-start whitespace-normal" onClick={() => onDiagnostic(item)}><Badge variant={item.severity === 'error' ? 'destructive' : 'secondary'}>{item.severity === 'error' ? 'Ошибка' : 'Предупреждение'}</Badge>{item.message}</Button>)}</div>)}</section>}
    </CardContent><CardFooter className="flex flex-wrap gap-2">
      {draft.status === 'published' ? <Button type="button" disabled={busy} onClick={() => void onClone()}>Создать новую редакцию</Button> : <><Button type="button" variant="outline" disabled={busy} onClick={() => void onValidate()}>Проверить черновик</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void onTest()}>Запустить тест</Button><Button type="button" disabled={busy || hasErrors} onClick={() => void onPublish()}>Опубликовать</Button></>}
    </CardFooter></Card>
  </div>
}
