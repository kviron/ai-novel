import type { StorySession } from '@/shared/api'

import { akaneSpriteSheet, markAvatar } from '@/shared/ui/characters'

const expressions: Record<string, { label: string; position: string }> = {
  neutral: { label: 'Нейтральная', position: '0% center' },
  happy: { label: 'Радость', position: '20% center' },
  sad: { label: 'Грусть', position: '40% center' },
  angry: { label: 'Злость', position: '60% center' },
  surprised: { label: 'Удивление', position: '80% center' },
  fan: { label: 'С веером', position: '100% center' },
}

export function CharacterSprite({ session }: { session: StorySession }) {
  const characterId = session.latest_turn?.visual_directive.character_id ?? session.characters[0]?.id
  const character = session.characters.find((item) => item.id === characterId)
  if (!character) return null

  // Demo assets are scoped to this story; all other cast members get a neutral placeholder.
  if (session.story.slug === 'akane-neon-echo' && characterId === 'mark') {
    return <img className="character-portrait" src={markAvatar} alt={character.name} />
  }
  if (session.story.slug !== 'akane-neon-echo' || characterId !== 'akane') {
    return <div className="character-portrait grid place-items-center rounded-full bg-card/70 text-8xl font-semibold text-muted-foreground" role="img" aria-label={`${character.name}: иллюстрация пока недоступна`}>
      <span aria-hidden="true">{character.name.slice(0, 1)}</span>
    </div>
  }

  const emotion = session.latest_turn?.visual_directive.emotion ?? session.visual_state?.emotion ?? 'neutral'
  const expression = expressions[emotion] ?? expressions.neutral

  return <div
    className="character-sprite"
    data-expression={expressions[emotion] ? emotion : 'neutral'}
    role="img"
    aria-label={`${character.name}: ${expression.label}`}
    style={{ aspectRatio: '1 / 3', backgroundImage: `url(${akaneSpriteSheet})`, backgroundSize: '600% 100%', backgroundPosition: expression.position }}
  />
}
