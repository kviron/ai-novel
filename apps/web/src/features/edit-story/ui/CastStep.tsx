import type { CatalogCharacter, CharacterRevisionSnapshot, StoryCastSection, StoryDraftCastMember } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { FieldGroup } from '@/shared/ui/field'

type Props = {
  value: StoryCastSection
  fixedHeroRevisionId: string | null
  revisions: CharacterRevisionSnapshot[]
  characters: CatalogCharacter[]
  catalogError: string
  saving: boolean
  onRetryCatalog: () => void
  onChange: (value: StoryCastSection) => void
  onSave: () => Promise<boolean>
}

function ageLabel(age: number) { return age % 10 === 1 && age % 100 !== 11 ? 'год' : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14) ? 'года' : 'лет' }

export function CastStep({ value, fixedHeroRevisionId, revisions, characters, catalogError, saving, onRetryCatalog, onChange, onSave }: Props) {
  const pinnedRevisionIds = new Set(value.characters.map(({ revision_id }) => revision_id))
  const pinnedCharacterIds = new Set(value.characters.map(({ character_id }) => character_id))
  const fixedHeroCharacterId = revisions.find(({ id }) => id === fixedHeroRevisionId)?.character_id
    ?? characters.find(({ current_revision_id }) => current_revision_id === fixedHeroRevisionId)?.character_id
  const available = characters.filter((character) => !pinnedRevisionIds.has(character.current_revision_id) && !pinnedCharacterIds.has(character.character_id) && character.current_revision_id !== fixedHeroRevisionId && character.character_id !== fixedHeroCharacterId)
  const snapshot = (member: StoryDraftCastMember) => revisions.find(({ id }) => id === member.revision_id)
    ?? characters.find(({ current_revision_id }) => current_revision_id === member.revision_id)
  const add = (character: CatalogCharacter) => onChange({ characters: [...value.characters, {
    id: `cast-${character.current_revision_id}`, character_id: character.character_id, revision_id: character.current_revision_id,
    order_index: value.characters.length, role: '', color: '#ffffff', playable: false,
  }] })
  const remove = (member: StoryDraftCastMember) => onChange({ characters: value.characters.filter(({ id }) => id !== member.id).map((item, order_index) => ({ ...item, order_index })) })

  return <form onSubmit={(event) => { event.preventDefault(); void onSave() }}>
    <Card>
      <CardHeader><CardTitle>Состав персонажей</CardTitle><CardDescription>Каждый участник закрепляется за точной ревизией каталога.</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        {catalogError && <Alert variant="destructive"><AlertDescription>{catalogError} <Button type="button" variant="outline" size="sm" onClick={onRetryCatalog}>Повторить загрузку персонажей</Button></AlertDescription></Alert>}
        {value.characters.length === 0 ? <p data-diagnostic-field="cast.characters" tabIndex={-1} aria-label="Состав персонажей">В составе пока нет персонажей.</p> : value.characters.map((member) => { const character = snapshot(member); return <Card size="sm" key={member.id} data-item-id={member.id} data-diagnostic-field="cast.characters" tabIndex={-1}><CardHeader><CardTitle>{character?.name ?? member.character_id}</CardTitle><CardDescription>{member.role || 'Роль пока не задана'}</CardDescription></CardHeader><CardContent><div data-diagnostic-field="cast.revision_id" tabIndex={-1}>{character && <Badge variant="secondary">{character.name} · ревизия {character.revision_number} · {character.age} {ageLabel(character.age)}</Badge>}</div></CardContent><CardFooter><Button type="button" variant="outline" onClick={() => remove(member)}>Удалить {character?.name ?? member.character_id}</Button></CardFooter></Card> })}
        {available.map((character) => <Button key={character.current_revision_id} type="button" variant="outline" onClick={() => add(character)}>Добавить {character.name} · ревизия {character.revision_number} · {character.age} {ageLabel(character.age)}</Button>)}
      </FieldGroup></CardContent>
      <CardFooter><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить раздел'}</Button></CardFooter>
    </Card>
  </form>
}
