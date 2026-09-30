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
