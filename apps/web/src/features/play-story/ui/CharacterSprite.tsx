import type { StorySession } from '@/shared/api'

const expressionLabels: Record<string, string> = { neutral: 'Нейтральная', happy: 'Радость', sad: 'Грусть', angry: 'Злость', surprised: 'Удивление', determined: 'Решительность', embarrassed: 'Смущение', embarrassment: 'Смущение', fan: 'С веером', fear: 'Страх', villain: 'Злодей', lust: 'Похоть' }

export function CharacterSprite({ session, showProtagonist = false }: { session: StorySession; showProtagonist?: boolean }) {
  const directive = session.latest_turn?.visual_directive
  const hero = showProtagonist && session.protagonist?.source_character_id && Object.values(session.protagonist.sprites ?? {}).some((variants) => variants.length > 0)
    ? session.protagonist : null
  const presentIds = directive?.present_character_ids ?? [directive?.character_id ?? session.characters[0]?.id]
  const present = [...new Set(presentIds)]
    .map((id) => session.characters.find((item) => item.id === id))
    .filter((character): character is StorySession['characters'][number] => Boolean(character))
  if (!present.length && !hero) return null

  return <div className="character-cast" data-cast-size={present.length + (hero ? 1 : 0)} data-has-protagonist={Boolean(hero)} data-sprite-scale="full" data-testid="character-cast">
    {hero && <div className="character-cast-slot" data-protagonist="true"><CharacterImage character={hero} emotion={directive?.protagonist_emotion ?? 'neutral'} /></div>}
    {present.map((character) => <div key={character.id} className="character-cast-slot" data-active={character.id === directive?.character_id}>
      <CharacterImage character={character} emotion={character.id === directive?.character_id ? (directive?.emotion ?? session.visual_state?.emotion ?? 'neutral') : 'neutral'} />
    </div>)}
  </div>
}

function CharacterImage({ character, emotion }: { character: Pick<StorySession['characters'][number], 'name' | 'sprites'>; emotion: string }) {
  const sprites = character.sprites ?? {}
  const selectedEmotion = sprites[emotion]?.length ? emotion : 'neutral'
  const sprite = sprites[selectedEmotion]?.[0]?.material
  if (sprite) return <img className="character-fullbody object-contain object-bottom" src={sprite.url} alt={`${character.name}: ${expressionLabels[selectedEmotion] ?? selectedEmotion}`} data-expression={selectedEmotion} />

  return <div className="character-portrait grid place-items-center rounded-full bg-card/70 text-8xl font-semibold text-muted-foreground" role="img" aria-label={`${character.name}: иллюстрация пока недоступна`}><span aria-hidden="true">{character.name.slice(0, 1)}</span></div>
}
