import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { Button } from './button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'
import { Progress } from './progress'

test('shadcn primitives provide accessible actions and overlays', async () => {
  render(
    <Dialog>
      <DialogTrigger asChild><Button>Открыть настройки</Button></DialogTrigger>
      <DialogContent><DialogTitle>Настройки</DialogTitle><Progress value={40} /></DialogContent>
    </Dialog>,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Открыть настройки' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
})
