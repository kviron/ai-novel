import type { CatalogCharacter, CharacterRevisionSnapshot, StoryHeroSection } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldTitle } from '@/shared/ui/field'
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
        <Field><FieldTitle id="hero-policy-label">Политика героя</FieldTitle><ToggleGroup type="single" variant="outline" value={value.hero_policy} onValueChange={(policy) => { if (policy) onChange({ ...value, hero_policy: policy as StoryHeroSection['hero_policy'], fixed_hero_revision_id: policy === 'choice' ? null : value.fixed_hero_revision_id }) }} aria-labelledby="hero-policy-label">
          <ToggleGroupItem value="choice" role="radio">Выбор игрока</ToggleGroupItem><ToggleGroupItem value="fixed" role="radio">Фиксированный герой</ToggleGroupItem>
        </ToggleGroup><FieldDescription>Закрепление хранит точную ревизию, поэтому будущие правки каталога не изменят опубликованную новеллу.</FieldDescription></Field>
        {selected && <Badge variant="secondary">{selected.name} · ревизия {selected.revision_number} · {selected.age} {ageLabel(selected.age)}</Badge>}
        {value.hero_policy === 'fixed' && characters.map((character) => <Button key={character.current_revision_id} type="button" variant={character.current_revision_id === value.fixed_hero_revision_id ? 'secondary' : 'outline'} onClick={() => onChange({ ...value, fixed_hero_revision_id: character.current_revision_id, hero_allowed_sources: ['catalog'] })}>Выбрать {character.name} · ревизия {character.revision_number} · {character.age} {ageLabel(character.age)}</Button>)}
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
  </form>
}
