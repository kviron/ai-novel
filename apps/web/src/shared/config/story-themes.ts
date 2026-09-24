import type { CSSProperties } from 'react'

export type StoryTheme = {
  id: string
  variables: CSSProperties & Record<`--${string}`, string>
}

const systemTheme: StoryTheme = { id: 'system', variables: {} as StoryTheme['variables'] }

// Add a theme by story slug; every token stays local to that story's page root.
const storyThemes: Record<string, StoryTheme> = {
  'akane-neon-echo': {
    id: 'akane-neon-echo',
    variables: {
      '--background': '#0e1118',
      '--foreground': '#f1eee8',
      '--card': '#1b1b21',
      '--card-foreground': '#f1eee8',
      '--popover': '#1b1b21',
      '--popover-foreground': '#f1eee8',
      '--primary': '#d99a4c',
      '--primary-foreground': '#19140c',
      '--secondary': '#29282d',
      '--secondary-foreground': '#f1eee8',
      '--muted': '#29282d',
      '--muted-foreground': '#aaa6a2',
      '--accent': '#35312e',
      '--accent-foreground': '#f1eee8',
      '--border': '#514841',
      '--input': '#514841',
      '--ring': '#d99a4c',
      '--scene-sky': '#101824',
      '--scene-moon': '#ded2aa',
      '--radius': '0.625rem',
    },
  },
}

export function resolveStoryTheme(slug?: string): StoryTheme {
  return slug ? (storyThemes[slug] ?? systemTheme) : systemTheme
}
