import crossroads from './akane-neon-crossroads-v1.webp'
import archive from './akane-signal-archive-v1.webp'

const backgrounds: Record<string, string> = {
  neon_crossroads: crossroads,
  signal_archive: archive,
}

export function SceneBackground({ storySlug, background }: { storySlug: string; background?: string }) {
  if (storySlug !== 'akane-neon-echo') return null
  const location = background && Object.hasOwn(backgrounds, background) ? background : 'neon_crossroads'

  return <div
    className="scene-background"
    data-testid="scene-background"
    data-background={location}
    style={{ backgroundImage: `url(${backgrounds[location]})` }}
    aria-hidden="true"
  />
}
