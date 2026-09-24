import { useEffect, useState } from 'react'
import { MessagesSquare } from 'lucide-react'

import { api, type Character, type TurnResult } from '@/shared/api'
import { resolveStoryTheme } from '@/shared/config'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { SceneSegments } from './SceneSegments'

export function DialogueHistory({ sessionId, storySlug, characters = [] }: { sessionId: string; storySlug?: string; characters?: Character[] }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<TurnResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void api.getDialogueHistory(sessionId, controller.signal)
      .then((history) => { if (!controller.signal.aborted) setTurns(history) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, sessionId])

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="История диалогов" title="История диалогов" className="text-white hover:bg-white/15 hover:text-white">
        <MessagesSquare aria-hidden="true" />
      </Button>
    </DialogTrigger>
    <DialogContent className="flex max-h-[min(80dvh,720px)] flex-col sm:max-w-2xl" style={resolveStoryTheme(storySlug).variables}>
      <DialogHeader>
        <DialogTitle>История диалогов</DialogTitle>
        <DialogDescription>Текущая ветка прохождения — от первого действия до последнего ответа.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {loading && <p role="status" className="text-muted-foreground">Загружаем переписку…</p>}
        {error && <p role="alert" className="text-destructive">Не удалось загрузить переписку. Закройте окно и попробуйте снова.</p>}
        {!loading && !error && turns.length === 0 && <p className="py-10 text-center text-muted-foreground">Диалогов пока нет.</p>}
        {!loading && !error && turns.map((turn) => <div key={turn.id} className="space-y-3">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-primary-foreground" data-speaker="player">
            <p className="mb-1 text-xs opacity-75">Вы</p>
            <p className="whitespace-pre-wrap">{turn.action}</p>
          </div>
          <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-foreground" data-speaker="character">
            {new Set(turn.segments?.filter((part) => part.kind === 'dialogue').map((part) => part.character_id)).size <= 1 && <p className="mb-1 text-xs font-semibold text-primary">{turn.speaker || 'Новелла'}</p>}
            <SceneSegments segments={turn.segments} narration={turn.narration} dialogue={turn.dialogue} speaker={turn.speaker} characters={characters} />
          </div>
        </div>)}
      </div>
    </DialogContent>
  </Dialog>
}
