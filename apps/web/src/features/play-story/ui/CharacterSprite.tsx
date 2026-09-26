import type { StorySession } from '@/shared/api'

const expressionLabels: Record<string, string> = { neutral: 'Нейтральная', happy: 'Радость', sad: 'Грусть', angry: 'Злость', surprised: 'Удивление', determined: 'Решительность', fan: 'С веером', fear: 'Страх', villain: 'Злодей', lust: 'Похоть' }

export function CharacterSprite({ session }: { session: StorySession }) {
  const directive = session.latest_turn?.visual_directive
  const presentIds = directive?.present_character_ids ?? [directive?.character_id ?? session.characters[0]?.id]
  const present = [...new Set(presentIds)]
    .map((id) => session.characters.find((item) => item.id === id))
    .filter((character): character is StorySession['characters'][number] => Boolean(character))
  if (!present.length) return null

  return <div className="character-cast" data-cast-size={present.length} data-sprite-scale="full" data-testid="character-cast">
    {present.map((character) => <div key={character.id} className="character-cast-slot" data-active={character.id === directive?.character_id}>
      <CharacterImage character={character} session={session} active={character.id === directive?.character_id} />
    </div>)}
  </div>
}

function CharacterImage({ character, session, active }: { character: StorySession['characters'][number]; session: StorySession; active: boolean }) {
  const characterId = character.id
  const emotion = active ? (session.latest_turn?.visual_directive.emotion ?? session.visual_state?.emotion ?? 'neutral') : 'neutral'
  const sprites = character.sprites ?? {}
  const selectedEmotion = sprites[emotion]?.length ? emotion : 'neutral'
  const sprite = sprites[selectedEmotion]?.[0]?.material
  if (sprite) return <img className="character-fullbody object-contain object-bottom" src={sprite.url} alt={`${character.name}: ${expressionLabels[selectedEmotion] ?? selectedEmotion}`} data-expression={selectedEmotion} />

  if (!characterId) {
    return <div className="character-portrait grid place-items-center rounded-full bg-card/70 text-8xl font-semibold text-muted-foreground" role="img" aria-label={`${character.name}: иллюстрация пока недоступна`}>
      <span aria-hidden="true">{character.name.slice(0, 1)}</span>
    </div>
  }

  return <div className="character-portrait grid place-items-center rounded-full bg-card/70 text-8xl font-semibold text-muted-foreground" role="img" aria-label={`${character.name}: иллюстрация пока недоступна`}><span aria-hidden="true">{character.name.slice(0, 1)}</span></div>
}
