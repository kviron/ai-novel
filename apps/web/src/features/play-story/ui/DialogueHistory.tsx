import { Fragment, useEffect, useState } from 'react'
import { ArrowDown, MessagesSquare } from 'lucide-react'

import { api, type Character, type TurnResult } from '@/shared/api'
import { resolveStoryTheme } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Bubble, BubbleContent } from '@/shared/ui/bubble'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty'
import { Marker, MarkerContent } from '@/shared/ui/marker'
import { Message, MessageContent, MessageHeader } from '@/shared/ui/message'
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/shared/ui/message-scroller'
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
      <Button type="button" variant="outline" size="icon-lg" aria-label="История диалогов" title="История диалогов">
        <MessagesSquare aria-hidden="true" />
      </Button>
    </DialogTrigger>
    <DialogContent className="flex h-[min(80dvh,720px)] flex-col sm:max-w-2xl" style={resolveStoryTheme(storySlug).variables}>
      <DialogHeader>
        <DialogTitle>История диалогов</DialogTitle>
        <DialogDescription>Текущая ветка прохождения — от первого действия до последнего ответа.</DialogDescription>
      </DialogHeader>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1" aria-live="polite">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 pb-2">
              {loading && <MessageScrollerItem messageId="loading"><Marker><MarkerContent role="status">Загружаем переписку…</MarkerContent></Marker></MessageScrollerItem>}
              {error && <MessageScrollerItem messageId="error"><Alert variant="destructive"><AlertDescription>Не удалось загрузить переписку. Закройте окно и попробуйте снова.</AlertDescription></Alert></MessageScrollerItem>}
              {!loading && !error && turns.length === 0 && <MessageScrollerItem messageId="empty"><Empty><EmptyHeader><EmptyMedia variant="icon"><MessagesSquare aria-hidden="true" /></EmptyMedia><EmptyTitle>Диалогов пока нет.</EmptyTitle><EmptyDescription>Продолжите историю, чтобы здесь появились сообщения.</EmptyDescription></EmptyHeader></Empty></MessageScrollerItem>}
              {!loading && !error && turns.map((turn) => <Fragment key={turn.id}>
                <MessageScrollerItem messageId={`${turn.id}-player`} scrollAnchor>
                  <Message align="end" data-speaker="player">
                    <MessageContent>
                      <MessageHeader className="justify-end">Вы</MessageHeader>
                      <Bubble align="end"><BubbleContent className="whitespace-pre-wrap">{turn.action}</BubbleContent></Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
                <MessageScrollerItem messageId={`${turn.id}-reply`}>
                  <Message data-speaker="character">
                    <MessageContent>
                      {new Set(turn.segments?.filter((part) => part.kind === 'dialogue').map((part) => part.character_id)).size <= 1 && <MessageHeader className="text-primary">{turn.speaker || 'Новелла'}</MessageHeader>}
                      <Bubble variant="muted"><BubbleContent><SceneSegments segments={turn.segments} narration={turn.narration} dialogue={turn.dialogue} speaker={turn.speaker} characters={characters} /></BubbleContent></Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              </Fragment>)}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton><ArrowDown aria-hidden="true" /><span className="sr-only">К последнему сообщению</span></MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
    </DialogContent>
  </Dialog>
}
