import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cn } from '../src/lib/utils'

// Die Design-Tokens aus globals.css müssen tailwind-merge bekannt sein,
// sonst verschwinden Klassen stillschweigend.
test('cn kennt die eigenen Tokens', () => {
  assert.equal(cn('text-caption text-fg'), 'text-caption text-fg')
  assert.equal(cn('text-caption text-body'), 'text-body')
  assert.equal(cn('rounded-control rounded-card'), 'rounded-card')
  assert.equal(cn('text-fg text-fg-muted'), 'text-fg-muted')
  assert.equal(cn('bg-surface bg-surface-raised'), 'bg-surface-raised')
  assert.equal(cn('text-[13px] text-fg'), 'text-[13px] text-fg')
})

test('Datumsfelder werden in Ortszeit befüllt', async () => {
  const { toLocalDateTimeInput, toLocalDateInput } = await import('../src/lib/utils')
  const date = new Date(2026, 8, 30, 0, 30) // 30.09.2026 00:30 Ortszeit
  assert.equal(toLocalDateTimeInput(date), '2026-09-30T00:30')
  assert.equal(toLocalDateInput(date), '2026-09-30')
  assert.equal(toLocalDateTimeInput(null), '')
  assert.equal(toLocalDateTimeInput('kaputt'), '')
})
