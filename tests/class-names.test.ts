import assert from 'node:assert/strict'
import { test } from 'node:test'


test('Datumsfelder werden in Ortszeit befüllt', async () => {
  const { toLocalDateTimeInput, toLocalDateInput } = await import('../src/lib/utils')
  const date = new Date(2026, 8, 30, 0, 30) // 30.09.2026 00:30 Ortszeit
  assert.equal(toLocalDateTimeInput(date), '2026-09-30T00:30')
  assert.equal(toLocalDateInput(date), '2026-09-30')
  assert.equal(toLocalDateTimeInput(null), '')
  assert.equal(toLocalDateTimeInput('kaputt'), '')
})
