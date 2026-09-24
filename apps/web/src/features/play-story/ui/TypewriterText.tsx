import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/button'

type TypewriterTextProps = { text: string; charactersPerSecond?: number; onComplete?: () => void }

export function TypewriterText(props: TypewriterTextProps) {
  // A text replacement owns a fresh timer and completion lifecycle.
  return <AnimatedText key={props.text} {...props} />
}

function AnimatedText({ text, charactersPerSecond = 35, onComplete }: TypewriterTextProps) {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [length, setLength] = useState(0)
  const complete = useRef(false)
  const callback = useRef(onComplete)
  callback.current = onComplete
  const finished = reduced || length >= text.length

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (finished) {
      setLength(text.length)
      if (!complete.current) { complete.current = true; callback.current?.() }
      return
    }
    const speed = Number.isFinite(charactersPerSecond) && charactersPerSecond > 0 ? charactersPerSecond : 35
    const timer = window.setInterval(() => setLength((previous) => Math.min(previous + 1, text.length)), 1000 / speed)
    return () => window.clearInterval(timer)
  }, [finished, charactersPerSecond, text.length])

  return <div className="typewriter">
    <p className="line">
      {finished ? text : <><span aria-hidden="true">{text.slice(0, length)}</span><span className="sr-only">{text}</span></>}
    </p>
    {!finished && <Button variant="ghost" size="sm" onClick={() => setLength(text.length)}>Показать полностью</Button>}
  </div>
}
