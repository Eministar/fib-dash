'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Clipboard, Save, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/utils'
import {
  KIND_META,
  STATUS_META,
  answerText,
  correctValues,
  selectedValues,
  type FormResponse,
  type FormTestMeta,
} from '@/components/modules/form-test-shared'

interface ResponseDetailPayload {
  test: FormTestMeta
  response: FormResponse
}

export function FormTestResponseDetail({ testId, responseId }: { testId: string; responseId: string }) {
  const router = useRouter()
  const { addToast } = useToast()
  const { execute } = useApi()
  const { data, loading, error: loadError, refetch } = useFetch<ResponseDetailPayload>(
    testId && responseId ? `/api/form-tests/${testId}/responses/${responseId}` : null,
  )

  const [scoreInput, setScoreInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const response = data?.response ?? null
  const test = data?.test ?? null
  const listHref = `/form-tests/manage/${testId}/responses`

  useEffect(() => {
    if (!response) {
      setScoreInput('')
      setNoteInput('')
      return
    }
    setScoreInput(response.score === null ? '' : String(response.score))
    setNoteInput(response.reviewNote ?? '')
  }, [response])

  const saveReview = async () => {
    if (!response) return
    setSaving(true)
    try {
      await execute(`/api/form-tests/${testId}/responses/${response.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          score: scoreInput.trim() ? Number(scoreInput) : null,
          reviewNote: noteInput,
        }),
      })
      addToast({ type: 'success', title: 'Bewertung gespeichert' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Bewertung fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const deleteResponse = async () => {
    if (!response) return
    setDeleting(true)
    try {
      await execute(`/api/form-tests/${testId}/responses/${response.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Abgabe gelöscht', message: 'Der Test kann nun wiederholt werden.' })
      router.push(listHref)
    } catch (e) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loading) return <PageLoader />

  if (!data || !response || !test) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Abgabe" description="Die Abgabe konnte nicht geladen werden." eyebrow="Auswertung" />
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-14 text-center">
          <Clipboard size={26} className="mx-auto mb-2 text-[#808080]" />
          <p className="text-[13px] text-[#a6a6a6]">{loadError ?? 'Abgabe nicht verfügbar'}</p>
          <Link href={listHref} className="mt-4 inline-block">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={13} />
              Zurück zu den Abgaben
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={response.respondent?.displayName ?? response.respondentName}
        description={`Abgabe für „${test.title}"`}
        eyebrow={test.kind === 'SURVEY' ? 'Umfrage-Abgabe' : 'Test-Abgabe'}
        action={(
          <Link href={listHref}>
            <Button variant="secondary" size="sm">
              <ArrowLeft size={13} />
              Alle Abgaben
            </Button>
          </Link>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={KIND_META[test.kind].variant}>{KIND_META[test.kind].label}</Badge>
        <Badge variant={STATUS_META[test.status].variant}>{STATUS_META[test.status].label}</Badge>
        <Badge variant={response.reviewedAt ? 'success' : 'warning'}>
          {response.reviewedAt ? `Bewertet von ${response.reviewedBy?.displayName ?? 'Unbekannt'}` : 'Offen'}
        </Badge>
        <span className="text-[12px] text-[#a6a6a6]">Abgegeben {formatDateTime(response.submittedAt)}</span>
      </div>

      <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
        <div className="space-y-3">
          {response.answers.map((answer, index) => {
            const correct = correctValues(answer.question)
            const chosen = selectedValues(answer)
            const showCorrect = test.kind === 'TEST' && correct.length > 0
            const isCorrect = showCorrect && correct.length === chosen.length && correct.every((value) => chosen.includes(value))
            return (
              <div key={answer.id} className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/45 p-3">
                <div className="mb-2 flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#232323] text-[10px] font-semibold text-[#d4d4d4]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-white">{answer.question.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-[#e5e5e5]">{answerText(answer)}</p>
                  </div>
                  {showCorrect && (
                    <Badge variant={isCorrect ? 'success' : 'danger'}>{isCorrect ? 'Richtig' : 'Falsch'}</Badge>
                  )}
                </div>
                {showCorrect && (
                  <p className="pl-7 text-[11.5px] text-[#a6a6a6]">Richtig: {correct.join(', ')}</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-5 rounded-[12px] border border-[#343434]/45 bg-[#0f0f0f]/50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
            <Input
              label={`Punkte${response.maxScore > 0 ? ` von ${response.maxScore}` : ''}`}
              type="number"
              min={0}
              value={scoreInput}
              onChange={(event) => setScoreInput(event.target.value)}
            />
            <Textarea label="Bewertungsnotiz" value={noteInput} onChange={(event) => setNoteInput(event.target.value)} rows={2} />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving || deleting}>
              <Trash2 size={13} />
              Abgabe löschen
            </Button>
            <Button size="sm" onClick={saveReview} loading={saving}>
              <Save size={13} />
              Bewertung speichern
            </Button>
          </div>
        </div>
      </section>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Abgabe löschen" size="sm">
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[12px] border border-[#7f1d1d]/45 bg-[#2a1016]/55 p-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#f87171]/14 text-[#fca5a5]">
              <AlertTriangle size={17} strokeWidth={2} />
            </div>
            <p className="text-[13px] leading-6 text-[#e5e5e5]">
              Abgabe von <span className="font-semibold text-white">{response.respondent?.displayName ?? response.respondentName}</span> wirklich löschen?
              Die Person kann den {test.kind === 'SURVEY' ? 'Fragebogen' : 'Test'} danach erneut ausfüllen. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Abbrechen
            </Button>
            <Button variant="danger" size="sm" onClick={deleteResponse} loading={deleting}>
              <Trash2 size={13} />
              Abgabe löschen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
