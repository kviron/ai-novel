import type { StoryDraftSectionMap, StoryGenerationField } from '@/shared/api'

type Section = StoryDraftSectionMap[keyof StoryDraftSectionMap]
const splitList = (text: string) => [...new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]

export function applyGeneratedField(section: Section, field: StoryGenerationField, text: string, targetId?: string): Section {
  if (field.startsWith('identity.')) {
    const identity = section as StoryDraftSectionMap['identity']
    const key = field.slice('identity.'.length) as keyof typeof identity
    if (key === 'genres' || key === 'tone') return { ...identity, [key]: splitList(text) }
    return { ...identity, [key]: text }
  }
  if (field === 'cast.role') {
    const cast = section as StoryDraftSectionMap['cast']
    return { ...cast, characters: cast.characters.map((item) => item.id === targetId ? { ...item, role: text } : item) }
  }
  if (field.startsWith('rules.')) {
    const rules = section as StoryDraftSectionMap['rules']
    if (field === 'rules.themes_allowed' || field === 'rules.themes_blocked') {
      const key = field.slice('rules.'.length) as 'themes_allowed' | 'themes_blocked'
      return { ...rules, [key]: splitList(text) }
    }
    const key = field.split('.').at(-1) as 'desired_themes' | 'forbidden_outcomes'
    return { ...rules, generation_policy: { ...rules.generation_policy, [key]: text } }
  }
  const canon = section as StoryDraftSectionMap['canon']
  if (field === 'canon.creative_goals') return { ...canon, creative_goals: text }
  if (field.startsWith('canon.fact.')) {
    const key = field.split('.').at(-1) as 'title' | 'statement'
    return { ...canon, facts: canon.facts.map((item) => item.id === targetId ? { ...item, [key]: text } : item) }
  }
  const key = field.split('.').at(-1) as 'title' | 'description' | 'completion_evidence'
  return { ...canon, beats: canon.beats.map((item) => item.id === targetId ? { ...item, [key]: text } : item) }
}
