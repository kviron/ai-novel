import { expect, test } from 'vitest'
import { parsePlayerInput } from './playerInput'

test('различает действие, произнесённую речь и мысль в порядке игрока', () => {
  expect(parsePlayerInput('Я смутился. *Отвёл взгляд* «Всё хорошо» (Она заметила?)')).toEqual([
    { kind: 'action', text: 'Я смутился.' },
    { kind: 'explicit_action', text: 'Отвёл взгляд' },
    { kind: 'speech', text: 'Всё хорошо' },
    { kind: 'thought', text: 'Она заметила?' },
  ])
})

test('незакрытый маркер оставляет текст действием', () => {
  expect(parsePlayerInput('Я открыл *дверь')).toEqual([{ kind: 'action', text: 'Я открыл *дверь' }])
})
