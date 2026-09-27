import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'

import type { StoryBeat, StoryBeatCondition, StoryCanonFact, StoryCanonSection, StoryModeSection } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'

type CanonCharacter = { character_id: string; name: string }
type Props = { mode: StoryModeSection['mode']; value: StoryCanonSection; characters: CanonCharacter[]; saving: boolean; onChange: (value: StoryCanonSection) => void; onSave: () => Promise<boolean> }
let idSequence = 0
const nextId = (kind: 'fact' | 'beat') => `${kind}-${Date.now()}-${++idSequence}`
const withOrder = <T extends { order_index: number }>(items: T[]) => items.map((item, order_index) => ({ ...item, order_index }))

function move<T extends { order_index: number }>(items: T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return withOrder(next)
}

function normalizeBeats(items: StoryBeat[]): StoryBeat[] {
  const ordered = withOrder(items)
  const positions = new Map(ordered.map((beat, index) => [beat.id, index]))
  return ordered.map((beat, index) => beat.activation_condition.kind === 'after_beat' && (positions.get(beat.activation_condition.beat_id) ?? index) >= index
    ? { ...beat, activation_condition: { kind: 'always' } }
    : beat)
}

const newFact = (): StoryCanonFact => ({ id: nextId('fact'), order_index: 0, title: '', statement: '', severity: 'hard', scope: 'world', referenced_character_ids: [] })
const newBeat = (): StoryBeat => ({ id: nextId('beat'), order_index: 0, title: '', description: '', activation_condition: { kind: 'always' }, completion_evidence: '', required: false, ending_gate: false })

export function CanonStep({ mode, value, characters, saving, onChange, onSave }: Props) {
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave() }
  const factChange = (index: number, patch: Partial<StoryCanonFact>) => onChange({ ...value, facts: value.facts.map((item, at) => at === index ? { ...item, ...patch } : item) })
  const beatChange = (index: number, patch: Partial<StoryBeat>) => onChange({ ...value, beats: value.beats.map((item, at) => at === index ? { ...item, ...patch } : item) })

  return <form onSubmit={submit}><Card>
    <CardHeader><CardTitle>Канон и ключевые события</CardTitle><CardDescription>{mode === 'freeform' ? 'Задайте творческий вектор, не превращая его в жёсткий маршрут.' : 'Зафиксируйте факты мира и последовательность обязательных событий.'}</CardDescription></CardHeader>
    <CardContent><FieldGroup>
      <Field><FieldLabel htmlFor="canon-creative-goals">Творческие цели</FieldLabel><Textarea id="canon-creative-goals" data-diagnostic-field="canon.creative_goals" value={value.creative_goals} onChange={(event) => onChange({ ...value, creative_goals: event.target.value })} /></Field>
      {mode === 'hybrid' && <>
        <section className="flex flex-col gap-3" aria-labelledby="canon-facts-title" data-diagnostic-field="canon.facts"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="canon-facts-title">Факты канона</h2><Button type="button" variant="outline" onClick={() => onChange({ ...value, facts: withOrder([...value.facts, newFact()]) })}>Добавить факт</Button></div>
          {value.facts.map((fact, index) => <Card key={fact.id} data-item-id={fact.id}><CardHeader><CardTitle>Факт {index + 1}</CardTitle></CardHeader><CardContent><FieldGroup>
            <Field><FieldLabel htmlFor={`fact-${fact.id}-title`}>Название факта {index + 1}</FieldLabel><Input id={`fact-${fact.id}-title`} data-diagnostic-field="canon.facts" value={fact.title} onChange={(event) => factChange(index, { title: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor={`fact-${fact.id}-statement`}>Описание факта {index + 1}</FieldLabel><Textarea id={`fact-${fact.id}-statement`} data-diagnostic-field="canon.facts.statement" value={fact.statement} onChange={(event) => factChange(index, { statement: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor={`fact-${fact.id}-severity`}>Строгость факта</FieldLabel><Select value={fact.severity} onValueChange={(severity) => factChange(index, { severity: severity as StoryCanonFact['severity'] })}><SelectTrigger id={`fact-${fact.id}-severity`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="hard">Нельзя нарушать</SelectItem><SelectItem value="soft">Желательно сохранять</SelectItem></SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor={`fact-${fact.id}-scope`}>Область факта</FieldLabel><Select value={fact.scope} onValueChange={(scope) => factChange(index, { scope: scope as StoryCanonFact['scope'] })}><SelectTrigger id={`fact-${fact.id}-scope`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="world">Мир</SelectItem><SelectItem value="character">Персонаж</SelectItem><SelectItem value="relationship">Отношения</SelectItem><SelectItem value="plot">Сюжет</SelectItem></SelectGroup></SelectContent></Select></Field>
            <Field data-diagnostic-field="canon.referenced_character_ids"><FieldLabel>Связанные персонажи</FieldLabel><FieldGroup>{characters.map((character) => { const checked = fact.referenced_character_ids.includes(character.character_id); return <Field key={character.character_id} orientation="horizontal"><FieldLabel htmlFor={`fact-${fact.id}-character-${character.character_id}`}>{character.name}</FieldLabel><Checkbox id={`fact-${fact.id}-character-${character.character_id}`} checked={checked} onCheckedChange={(next) => factChange(index, { referenced_character_ids: next === true ? [...fact.referenced_character_ids, character.character_id] : fact.referenced_character_ids.filter((id) => id !== character.character_id) })} /></Field> })}</FieldGroup></Field>
            <div className="flex flex-wrap gap-2"><Button type="button" size="icon-sm" variant="outline" aria-label={`Поднять факт ${index + 1}`} disabled={index === 0} onClick={() => onChange({ ...value, facts: move(value.facts, index, -1) })}><ArrowUp data-icon="inline-start" /></Button><Button type="button" size="icon-sm" variant="outline" aria-label={`Опустить факт ${index + 1}`} disabled={index === value.facts.length - 1} onClick={() => onChange({ ...value, facts: move(value.facts, index, 1) })}><ArrowDown data-icon="inline-start" /></Button><Button type="button" size="icon-sm" variant="destructive" aria-label={`Удалить факт ${index + 1}`} onClick={() => onChange({ ...value, facts: withOrder(value.facts.filter(({ id }) => id !== fact.id)) })}><Trash2 data-icon="inline-start" /></Button></div>
          </FieldGroup></CardContent></Card>)}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="canon-beats-title" data-diagnostic-field="canon.beats"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="canon-beats-title">Ключевые события</h2><Button type="button" variant="outline" onClick={() => onChange({ ...value, beats: withOrder([...value.beats, newBeat()]) })}>Добавить событие</Button></div>
          {value.beats.map((beat, index) => <Card key={beat.id} data-item-id={beat.id}><CardHeader><CardTitle>Событие {index + 1}</CardTitle></CardHeader><CardContent><FieldGroup>
            <Field><FieldLabel htmlFor={`beat-${beat.id}-title`}>Название события {index + 1}</FieldLabel><Input id={`beat-${beat.id}-title`} data-diagnostic-field="canon.beats" value={beat.title} onChange={(event) => beatChange(index, { title: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor={`beat-${beat.id}-description`}>Описание события {index + 1}</FieldLabel><Textarea id={`beat-${beat.id}-description`} data-diagnostic-field="canon.beats.description" value={beat.description} onChange={(event) => beatChange(index, { description: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor={`beat-${beat.id}-condition`}>Условие события {index + 1}</FieldLabel><Select value={beat.activation_condition.kind} onValueChange={(kind) => {
              const condition: StoryBeatCondition = kind === 'after_turn_count' ? { kind, turn_count: 1 } : kind === 'after_beat' ? { kind, beat_id: value.beats[index - 1]?.id ?? '' } : { kind: 'always' }
              beatChange(index, { activation_condition: condition })
            }}><SelectTrigger id={`beat-${beat.id}-condition`} data-diagnostic-field="canon.activation_condition"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="always">Всегда</SelectItem><SelectItem value="after_turn_count">После числа ходов</SelectItem>{index > 0 && <SelectItem value="after_beat">После события</SelectItem>}</SelectGroup></SelectContent></Select></Field>
            {beat.activation_condition.kind === 'after_turn_count' && <Field><FieldLabel htmlFor={`beat-${beat.id}-turns`}>Число ходов</FieldLabel><Input id={`beat-${beat.id}-turns`} type="number" min={1} value={beat.activation_condition.turn_count} onChange={(event) => beatChange(index, { activation_condition: { kind: 'after_turn_count', turn_count: Number(event.target.value) } })} /></Field>}
            {beat.activation_condition.kind === 'after_beat' && <Field><FieldLabel htmlFor={`beat-${beat.id}-after`}>После события</FieldLabel><Select value={beat.activation_condition.beat_id} onValueChange={(beat_id) => beatChange(index, { activation_condition: { kind: 'after_beat', beat_id } })}><SelectTrigger id={`beat-${beat.id}-after`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{value.beats.slice(0, index).map((prior) => <SelectItem key={prior.id} value={prior.id}>{prior.title || `Событие ${prior.order_index + 1}`}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
            <Field><FieldLabel htmlFor={`beat-${beat.id}-evidence`}>Признак завершения</FieldLabel><Textarea id={`beat-${beat.id}-evidence`} value={beat.completion_evidence} onChange={(event) => beatChange(index, { completion_evidence: event.target.value })} /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor={`beat-${beat.id}-required`}>Обязательное</FieldLabel><Checkbox id={`beat-${beat.id}-required`} checked={beat.required} onCheckedChange={(checked) => beatChange(index, { required: checked === true })} /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor={`beat-${beat.id}-ending`}>Открывает финал</FieldLabel><Checkbox id={`beat-${beat.id}-ending`} checked={beat.ending_gate} onCheckedChange={(checked) => beatChange(index, { ending_gate: checked === true })} /></Field>
            <div className="flex flex-wrap gap-2"><Button type="button" size="icon-sm" variant="outline" aria-label={`Поднять событие ${index + 1}`} disabled={index === 0} onClick={() => onChange({ ...value, beats: normalizeBeats(move(value.beats, index, -1)) })}><ArrowUp data-icon="inline-start" /></Button><Button type="button" size="icon-sm" variant="outline" aria-label={`Опустить событие ${index + 1}`} disabled={index === value.beats.length - 1} onClick={() => onChange({ ...value, beats: normalizeBeats(move(value.beats, index, 1)) })}><ArrowDown data-icon="inline-start" /></Button><Button type="button" size="icon-sm" variant="destructive" aria-label={`Удалить событие ${index + 1}`} onClick={() => onChange({ ...value, beats: normalizeBeats(value.beats.filter(({ id }) => id !== beat.id)) })}><Trash2 data-icon="inline-start" /></Button></div>
          </FieldGroup></CardContent></Card>)}
        </section>
      </>}
    </FieldGroup></CardContent>
    <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
  </Card></form>
}
