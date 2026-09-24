import { akaneAvatar, markAvatar } from '@/shared/ui/characters'

type Props = { characterId: string; name: string; storySlug: string; coverImageUrl?: string | null; className?: string }

// Portraits are bound to a story and character, never to a display name.
const portraits: Record<string, string> = { 'akane-neon-echo:akane': akaneAvatar, 'akane-neon-echo:mark': markAvatar }

export function CharacterArtwork({ characterId, name, storySlug, coverImageUrl, className = '' }: Props) {
  const portrait = portraits[`${storySlug}:${characterId}`]
  return <div className={`relative isolate overflow-hidden bg-muted ${className}`}>
    {portrait ? <img src={portrait} alt={`Портрет ${name}`} className="size-full object-cover object-top" />
      : coverImageUrl ? <img src={coverImageUrl} alt={`Портрет ${name}`} className="size-full object-cover" />
        : <div role="img" aria-label={`Портрет ${name}`} className="grid size-full place-items-center text-6xl font-semibold text-muted-foreground">{name.slice(0, 1)}</div>}
  </div>
}
