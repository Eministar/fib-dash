import { api } from '../api'
import { openForm } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { agentOptions, corruptionCheckOptions, corruptionField, invalidate, lookups } from './lookups'
import { options, PRIORITY, STATUS } from './model'

type CreatedCase = { id: string; caseNumber: string; title: string }

export async function createCase(): Promise<CreatedCase | null> {
  const [agents, templates, reasons] = await Promise.all([agentOptions(), lookups.templates(), corruptionCheckOptions()])
  let created: CreatedCase | null = null
  const saved = await openForm({
    title: 'Neue Ermittlungsakte',
    submitLabel: 'Anlegen',
    fields: [
      { name: 'title', label: 'Titel', type: 'text', required: true, span: 2, maxLength: 200 },
      corruptionField(reasons),
      ...(templates.length
        ? [{ name: 'templateId', label: 'Vorlage', type: 'select' as const, options: [{ value: '', label: 'Ohne Vorlage' }, ...templates.map((t) => ({ value: t.id, label: t.name }))], span: 2 as const, hint: 'Übernimmt Arbeitsplan, offene Rollen und Team der Vorlage.' }]
        : []),
      { name: 'status', label: 'Status', type: 'select', options: options(STATUS), value: 'OPEN' },
      { name: 'priority', label: 'Priorität', type: 'select', options: options(PRIORITY), value: 'NORMAL' },
      { name: 'leadAgentId', label: 'Fallführung', type: 'combobox', options: agents, span: 2 },
      { name: 'summary', label: 'Zusammenfassung', type: 'textarea' },
    ],
    onSubmit: async (values) => {
      created = await api.post<CreatedCase>('/api/investigations', values)
      invalidate('cases')
      toast(`Akte ${created.caseNumber} angelegt`)
    },
  })
  return saved ? created : null
}

