import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TypewriterText } from './TypewriterText'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

test('постепенно показывает текст и завершает его по кнопке один раз', () => {
  vi.useFakeTimers()
  const done = vi.fn()
  render(<TypewriterText text="Привет" charactersPerSecond={10} onComplete={done} />)
  expect(screen.getByText('Привет')).toHaveClass('sr-only')
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByText('Пр')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Показать полностью' }))
  expect(screen.getByText('Привет')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1000))
  expect(done).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

test('замена текста сбрасывает анимацию и unmount очищает таймер', () => {
  vi.useFakeTimers()
  const done = vi.fn()
  const view = render(<TypewriterText text="Старый текст" charactersPerSecond={10} onComplete={done} />)
  act(() => vi.advanceTimersByTime(300))
  view.rerender(<TypewriterText text="Новый" charactersPerSecond={10} onComplete={done} />)
  expect(screen.queryByText('Ста')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(100))
  expect(screen.getByText('Н')).toBeInTheDocument()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  expect(done).not.toHaveBeenCalled()
})

test('reduced motion сразу показывает текст без таймера', () => {
  vi.useFakeTimers()
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
  const done = vi.fn()
  render(<TypewriterText text="Без анимации" onComplete={done} />)
  expect(screen.getByText('Без анимации')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(vi.getTimerCount()).toBe(0)
  expect(done).toHaveBeenCalledTimes(1)
})

test('естественное завершение останавливает таймер и вызывает актуальный callback', () => {
  vi.useFakeTimers()
  const oldDone = vi.fn()
  const done = vi.fn()
  const view = render(<TypewriterText text="Да" charactersPerSecond={10} onComplete={oldDone} />)
  view.rerender(<TypewriterText text="Да" charactersPerSecond={10} onComplete={done} />)
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByText('Да')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(done).toHaveBeenCalledTimes(1)
  expect(oldDone).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
