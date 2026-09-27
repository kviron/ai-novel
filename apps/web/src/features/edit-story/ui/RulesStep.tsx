import { useState, type FormEvent } from 'react'

import type { StoryRulesSection } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

type Props = { value: StoryRulesSection; saving: boolean; onChange: (value: StoryRulesSection) => void; onSave: () => Promise<boolean> }

const splitThemes = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]

export function RulesStep({ value, saving, onChange, onSave }: Props) {
  const [allowedText, setAllowedText] = useState(value.themes_allowed.join(', '))
  const [blockedText, setBlockedText] = useState(value.themes_blocked.join(', '))
  const policy = value.generation_policy
  const countError = policy.choice_policy !== 'free_input_only' && policy.min_choices > policy.max_choices
    ? 'Минимум не может быть больше максимума.' : ''
  const collision = value.themes_allowed.find((theme) => value.themes_blocked.some((blocked) => blocked.toLocaleLowerCase() === theme.toLocaleLowerCase()))
  const boundsError = policy.choice_policy !== 'free_input_only' && (policy.min_choices < 1 || policy.max_choices > 8) ? 'Количество вариантов должно быть от 1 до 8.' : ''
  const invalid = Boolean(countError || boundsError || collision)
  const updatePolicy = <K extends keyof typeof policy>(field: K, next: typeof policy[K]) => onChange({ ...value, generation_policy: { ...policy, [field]: next } })
  const submit = (event: FormEvent) => { event.preventDefault(); if (!invalid) void onSave() }

  return <form onSubmit={submit}>
    <Card>
      <CardHeader><CardTitle>Правила генерации</CardTitle><CardDescription>Границы, темы и формат следующего хода для модели.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        {collision && <Alert variant="destructive"><AlertDescription>Тема «{collision}» одновременно разрешена и запрещена.</AlertDescription></Alert>}
        <FieldSet><FieldLegend>Ответ игроку</FieldLegend>
          <Field><FieldTitle id="choice-policy-label">Формат выбора</FieldTitle><ToggleGroup type="single" variant="outline" value={policy.choice_policy} onValueChange={(next) => { if (next) updatePolicy('choice_policy', next as typeof policy.choice_policy) }} aria-labelledby="choice-policy-label">
            <ToggleGroupItem value="choices_and_free_input">Варианты и свой ответ</ToggleGroupItem><ToggleGroupItem value="choices_only">Только варианты</ToggleGroupItem><ToggleGroupItem value="free_input_only">Только свой ответ</ToggleGroupItem>
          </ToggleGroup></Field>
          {policy.choice_policy !== 'free_input_only' && <div className="grid gap-3 sm:grid-cols-2">
            <Field data-invalid={Boolean(countError || boundsError)}><FieldLabel htmlFor="rules-min-choices">Минимум вариантов</FieldLabel><Input id="rules-min-choices" data-diagnostic-field="rules.generation_policy.min_choices" type="number" min={1} max={8} value={policy.min_choices} aria-invalid={Boolean(countError || boundsError)} onChange={(event) => updatePolicy('min_choices', Number(event.target.value))} /></Field>
            <Field data-invalid={Boolean(countError || boundsError)}><FieldLabel htmlFor="rules-max-choices">Максимум вариантов</FieldLabel><Input id="rules-max-choices" data-diagnostic-field="rules.generation_policy.max_choices" type="number" min={1} max={8} value={policy.max_choices} aria-invalid={Boolean(countError || boundsError)} onChange={(event) => updatePolicy('max_choices', Number(event.target.value))} /></Field>
            {(countError || boundsError) && <FieldError>{countError || boundsError}</FieldError>}
          </div>}
        </FieldSet>
        <Field><FieldLabel htmlFor="rules-ending-policy">Завершение истории</FieldLabel><Select value={value.ending_policy} onValueChange={(ending_policy) => onChange({ ...value, ending_policy: ending_policy as StoryRulesSection['ending_policy'] })}><SelectTrigger id="rules-ending-policy" data-diagnostic-field="rules.ending_policy"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="open_ended">Открытая история</SelectItem><SelectItem value="model_may_end">Модель может завершить</SelectItem><SelectItem value="required_beats_then_end">После обязательных событий</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="rules-perspective">Перспектива рассказчика</FieldLabel><Select value={policy.narration_perspective} onValueChange={(next) => updatePolicy('narration_perspective', next as typeof policy.narration_perspective)}><SelectTrigger id="rules-perspective"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="first_person">Первое лицо</SelectItem><SelectItem value="second_person">Второе лицо</SelectItem><SelectItem value="third_person">Третье лицо</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="rules-density">Плотность прозы</FieldLabel><Select value={policy.prose_density} onValueChange={(next) => updatePolicy('prose_density', next as typeof policy.prose_density)}><SelectTrigger id="rules-density"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="concise">Краткая</SelectItem><SelectItem value="balanced">Сбалансированная</SelectItem><SelectItem value="detailed">Подробная</SelectItem></SelectGroup></SelectContent></Select></Field>
        <FieldSet><FieldLegend>Допустимое содержание</FieldLegend>{([
          ['allow_romance', 'Романтика'], ['allow_violence', 'Насилие'], ['allow_horror', 'Ужас'], ['allow_sexual_themes', 'Сексуальные темы'],
        ] as const).map(([field, label]) => <Field key={field} orientation="horizontal"><FieldLabel htmlFor={`rules-${field}`}>{label}</FieldLabel><Switch id={`rules-${field}`} checked={policy[field]} onCheckedChange={(checked) => updatePolicy(field, checked)} /></Field>)}</FieldSet>
        <Field><FieldLabel htmlFor="rules-allowed">Разрешённые темы</FieldLabel><Input id="rules-allowed" value={allowedText} onChange={(event) => { setAllowedText(event.target.value); onChange({ ...value, themes_allowed: splitThemes(event.target.value) }) }} /><FieldDescription>Через запятую.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="rules-blocked">Запрещённые темы</FieldLabel><Input id="rules-blocked" value={blockedText} onChange={(event) => { setBlockedText(event.target.value); onChange({ ...value, themes_blocked: splitThemes(event.target.value) }) }} /></Field>
        <Field><FieldLabel htmlFor="rules-desired">Желаемые мотивы</FieldLabel><Textarea id="rules-desired" value={policy.desired_themes} onChange={(event) => updatePolicy('desired_themes', event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="rules-forbidden">Запрещённые исходы</FieldLabel><Textarea id="rules-forbidden" value={policy.forbidden_outcomes} onChange={(event) => updatePolicy('forbidden_outcomes', event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="rules-provider">Рекомендуемый провайдер</FieldLabel><Input id="rules-provider" data-diagnostic-field="rules.recommended_provider_id" value={value.recommended_provider_id} onChange={(event) => onChange({ ...value, recommended_provider_id: event.target.value })} /></Field>
        <Field><FieldLabel htmlFor="rules-model">Рекомендуемая модель</FieldLabel><Input id="rules-model" data-diagnostic-field="rules.recommended_model_id" value={value.recommended_model_id} onChange={(event) => onChange({ ...value, recommended_model_id: event.target.value })} /></Field>
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving || invalid}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
  </form>
}
