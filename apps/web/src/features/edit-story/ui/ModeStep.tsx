import { useState, type FormEvent } from 'react'

import type { StoryModeSection } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldTitle } from '@/shared/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

type Props = { value: StoryModeSection; savedValue: StoryModeSection; hasIncompatibleCanon: boolean; saving: boolean; onChange: (value: StoryModeSection) => void; onSave: (value?: StoryModeSection, options?: { confirmClearIncompatible?: boolean }) => Promise<boolean> }

export function ModeStep({ value, savedValue, hasIncompatibleCanon, saving, onChange, onSave }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const needsConfirmation = value.mode !== savedValue.mode && hasIncompatibleCanon
  const submit = (event: FormEvent) => { event.preventDefault(); if (needsConfirmation) setConfirmOpen(true); else void onSave() }
  return <form onSubmit={submit}>
    <Card>
      <CardHeader><CardTitle>Режим истории</CardTitle><CardDescription>Выберите, насколько строго движок должен следовать авторскому маршруту.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        <Field><FieldTitle id="story-mode-label">Режим</FieldTitle><ToggleGroup type="single" variant="outline" value={value.mode} onValueChange={(mode) => { if (mode) onChange({ mode: mode as StoryModeSection['mode'] }) }} aria-labelledby="story-mode-label">
          <ToggleGroupItem value="freeform" role="radio">Свободный</ToggleGroupItem><ToggleGroupItem value="hybrid" role="radio">Гибридный</ToggleGroupItem>
        </ToggleGroup></Field>
        <p>Свободный режим развивает историю без обязательного маршрута и заранее заданных ключевых событий.</p>
        <p>Гибридный режим сохраняет свободу игрока, но ведёт повествование через ключевые события автора.</p>
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>Очистить несовместимые данные?</DialogTitle><DialogDescription>Смена режима удалит цели, факты или события, которые не поддерживает новый режим. Это действие выполняется только после явного подтверждения.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button type="button" variant="outline">Отмена</Button></DialogClose><Button type="button" variant="destructive" onClick={async () => { if (await onSave(value, { confirmClearIncompatible: true })) setConfirmOpen(false) }}>Переключить и очистить</Button></DialogFooter></DialogContent></Dialog>
  </form>
}
