export type PlayerPart = { kind: 'action' | 'explicit_action' | 'speech' | 'thought'; text: string }

const delimiters: Record<string, [string, PlayerPart['kind']]> = {
  '*': ['*', 'explicit_action'], '(': [')', 'thought'], '«': ['»', 'speech'], '"': ['"', 'speech'],
}

export function parsePlayerInput(value: string): PlayerPart[] {
  const parts: PlayerPart[] = []
  let plainStart = 0
  for (let index = 0; index < value.length;) {
    const match = delimiters[value[index]]
    if (!match) { index++; continue }
    const [closer, kind] = match
    const end = value.indexOf(closer, index + 1)
    if (end < 0 || !value.slice(index + 1, end).trim()) { index++; continue }
    const plain = value.slice(plainStart, index).trim()
    if (/[^\p{P}\s]/u.test(plain)) parts.push({ kind: 'action', text: plain })
    parts.push({ kind, text: value.slice(index + 1, end).trim() })
    index = end + 1
    plainStart = index
  }
  const tail = value.slice(plainStart).trim()
  if (/[^\p{P}\s]/u.test(tail)) parts.push({ kind: 'action', text: tail })
  return parts
}
