import { ModuleWorkspace } from '@/components/modules/module-workspace'

const EMPTY_DETECTIVE_DOCUMENT = `# Neues Detective-Dokument

## Überblick

- Fall / Ermittlungslage
- Beteiligte

## Maßnahmen

| Thema | Status | Notiz |
| --- | --- | --- |
|  | Offen |  |
`

export default function DetectivePage() {
  return (
    <ModuleWorkspace
      module="DETECTIVE"
      title="Detective Unit"
      documentTitle="Detective Dokumente"
      documentDescription="Interne Unterlagen, Fallnotizen und Vorlagen der Detective Unit"
      emptyDocument={EMPTY_DETECTIVE_DOCUMENT}
      taskTitle="Detective Aufgaben"
      taskDescription="Aufgabenlisten für Ermittlungen, Fallbearbeitung, Nachbereitung und interne Abläufe."
      taskAccentLabel="Detective Unit"
      calendarTitle="Detective Kalender"
      calendarDescription="Besprechungen, Trainings und Termine der Detective Unit"
      calendarEmptyLabel="Keine Detective-Termine vorhanden"
      createToastTitle="Detective-Termin erstellt"
      deleteToastTitle="Detective-Termin gelöscht"
      eventTypes={[
        { value: 'TRAINING', label: 'Training' },
        { value: 'MEETING', label: 'Besprechung' },
        { value: 'OTHER', label: 'Sonstiges' },
      ]}
      defaultType="MEETING"
      color="#a78bfa"
      viewPermission="detective:view"
      managePermission="detective:manage"
    />
  )
}
