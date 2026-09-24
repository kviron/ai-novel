import { akaneAvatar, markAvatar } from '@/shared/ui/characters'

type Props = { characterId: string; name: string; className?: string }

// Bundled portraits belong to stable character IDs, not to mutable names or stories.
const portraits: Record<string, string> = { akane: akaneAvatar, mark: markAvatar }

export function CharacterArtwork({ characterId, name, className = '' }: Props) {
  const portrait = portraits[characterId]
  return <div className={`relative isolate overflow-hidden bg-muted ${className}`}>
    {portrait ? <img src={portrait} alt={`Портрет ${name}`} className="size-full object-cover object-top" />
      : <div role="img" aria-label={`Портрет ${name}`} className="grid size-full place-items-center text-6xl font-semibold text-muted-foreground">{name.slice(0, 1)}</div>}
  </div>
}
