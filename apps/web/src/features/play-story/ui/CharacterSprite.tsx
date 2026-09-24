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
  // Demo assets are scoped to this story; never show Akane for another speaker.
  if (session.story.slug !== 'akane-neon-echo') return null

  const characterId = session.latest_turn?.visual_directive.character_id ?? 'akane'
  if (characterId === 'mark') {
    return <img className="character-portrait" src={markAvatar} alt={session.characters.find((item) => item.id === 'mark')?.name ?? 'Марк Ветров'} />
  }
  if (characterId !== 'akane') return null

  const emotion = session.latest_turn?.visual_directive.emotion ?? session.visual_state?.emotion ?? 'neutral'
  const expression = expressions[emotion] ?? expressions.neutral

  return <div
    className="character-sprite"
    data-expression={expressions[emotion] ? emotion : 'neutral'}
    role="img"
    aria-label={`${session.characters.find((item) => item.id === 'akane')?.name ?? 'Аканэ'}: ${expression.label}`}
    style={{ aspectRatio: '1 / 3', backgroundImage: `url(${akaneSpriteSheet})`, backgroundSize: '600% 100%', backgroundPosition: expression.position }}
  />
}
