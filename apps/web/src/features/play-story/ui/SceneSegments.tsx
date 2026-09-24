import type { Character, SceneSegment } from '@/shared/api'
import { TypewriterText } from './TypewriterText'

type Props = {
  segments?: SceneSegment[]
  narration: string
  dialogue: string
  speaker: string
  characters: Character[]
  animateLast?: boolean
  hideSpeakerNames?: boolean
}

export function SceneSegments({ segments, narration, dialogue, speaker, characters, animateLast = false, hideSpeakerNames = false }: Props) {
  const parts = segments?.length ? segments : [
    { kind: 'narration' as const, text: narration },
    { kind: 'dialogue' as const, text: dialogue, character_id: characters.find((item) => item.name === speaker)?.id },
  ]
  return <div className="flex flex-col gap-2">
    {parts.map((part, index) => {
      if (part.kind === 'narration') return <p className="narration" key={index}>{part.text}</p>
      const character = characters.find((item) => item.id === part.character_id)
      const shortName = character?.name.trim().split(/\s+/)[0] ?? (speaker.trim().split(/\s+/)[0] || 'Персонаж')
      return <div key={index} className="whitespace-pre-wrap leading-relaxed">
        {!hideSpeakerNames && <span className="font-semibold" style={{ color: character?.color ?? 'var(--primary)' }}>{shortName}: </span>}
        {animateLast && index === parts.length - 1 ? <TypewriterText text={part.text} /> : part.text}
      </div>
    })}
  </div>
}
