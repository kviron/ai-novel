import type { CatalogCharacter, CharacterRevisionSnapshot, StoryHeroSection } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/shared/ui/field'
import { Checkbox } from '@/shared/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'

type Props = {
  value: StoryHeroSection
  revisions: CharacterRevisionSnapshot[]
  characters: CatalogCharacter[]
  catalogError: string
  saving: boolean
  onRetryCatalog: () => void
  onChange: (value: StoryHeroSection) => void
  onSave: () => Promise<boolean>
}

function ageLabel(age: number) { return age % 10 === 1 && age % 100 !== 11 ? 'год' : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14) ? 'года' : 'лет' }

export function HeroStep({ value, revisions, characters, catalogError, saving, onRetryCatalog, onChange, onSave }: Props) {
  const selected = revisions.find((revision) => revision.id === value.fixed_hero_revision_id)
    ?? characters.find((character) => character.current_revision_id === value.fixed_hero_revision_id)
  return <form onSubmit={(event) => { event.preventDefault(); void onSave() }}>
    <Card>
      <CardHeader><CardTitle>Главный герой</CardTitle><CardDescription>Игрок выбирает героя или проходит историю за закреплённого автором персонажа.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        {catalogError && <Alert variant="destructive"><AlertDescription>{catalogError} <Button type="button" variant="outline" size="sm" onClick={onRetryCatalog}>Повторить загрузку персонажей</Button></AlertDescription></Alert>}
        <Field><FieldTitle id="hero-policy-label">Политика героя</FieldTitle><ToggleGroup data-diagnostic-field="hero.hero_policy" type="single" variant="outline" value={value.hero_policy} onValueChange={(policy) => { if (policy) onChange({ ...value, hero_policy: policy as StoryHeroSection['hero_policy'], fixed_hero_revision_id: policy === 'choice' ? null : value.fixed_hero_revision_id }) }} aria-labelledby="hero-policy-label">
          <ToggleGroupItem value="choice" role="radio">Выбор игрока</ToggleGroupItem><ToggleGroupItem value="fixed" role="radio">Фиксированный герой</ToggleGroupItem>
        </ToggleGroup><FieldDescription>Закрепление хранит точную ревизию, поэтому будущие правки каталога не изменят опубликованную новеллу.</FieldDescription></Field>
        <Field data-diagnostic-field="hero.hero_allowed_sources"><FieldTitle>Разрешённые источники героя</FieldTitle>{(['catalog', 'draft'] as const).map((source) => <Field key={source} orientation="horizontal"><FieldLabel htmlFor={`hero-source-${source}`}>{source === 'catalog' ? 'Каталог' : 'Новый герой игрока'}</FieldLabel><Checkbox id={`hero-source-${source}`} checked={value.hero_allowed_sources.includes(source)} onCheckedChange={(checked) => onChange({ ...value, hero_allowed_sources: checked === true ? [...value.hero_allowed_sources, source] : value.hero_allowed_sources.filter((item) => item !== source) })} /></Field>)}</Field>
        {selected && <Badge variant="secondary">{selected.name} · ревизия {selected.revision_number} · {selected.age} {ageLabel(selected.age)}</Badge>}
        {value.hero_policy === 'fixed' && <div data-diagnostic-field="hero.fixed_hero_revision_id" tabIndex={-1} aria-label="Выбор фиксированного героя" className="flex flex-col gap-2">{characters.map((character) => <Button key={character.current_revision_id} type="button" variant={character.current_revision_id === value.fixed_hero_revision_id ? 'secondary' : 'outline'} onClick={() => onChange({ ...value, fixed_hero_revision_id: character.current_revision_id, hero_allowed_sources: ['catalog'] })}>Выбрать {character.name} · ревизия {character.revision_number} · {character.age} {ageLabel(character.age)}</Button>)}</div>}
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
  </form>
}
