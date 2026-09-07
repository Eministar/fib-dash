import { ModuleWorkspace } from '@/components/modules/module-workspace'

const EMPTY_AIR_SUPPORT_DOCUMENT = `# Neues Air-Support-Dokument

## Überblick

- Einsatzlage
- Voraussetzungen

## Maßnahmen

| Thema | Status | Notiz |
| --- | --- | --- |
|  | Offen |  |
`

export default function AirSupportPage() {
  return (
    <ModuleWorkspace
      module="AIR_SUPPORT"
      title="Air-Support Division"
      documentTitle="Air-Support Dokumente"
      documentDescription="Interne Unterlagen, Einsatznotizen und Vorlagen der Air-Support Division"
      emptyDocument={EMPTY_AIR_SUPPORT_DOCUMENT}
      taskTitle="Air-Support Aufgaben"
      taskDescription="Aufgabenlisten für Flugdienst, Einsatzvorbereitung, Nachbereitung und interne Abläufe."
      taskAccentLabel="Air-Support Division"
      calendarTitle="Air-Support Kalender"
      calendarDescription="Trainings, Einsätze und Besprechungen der Air-Support Division"
      calendarEmptyLabel="Keine Air-Support-Termine vorhanden"
      createToastTitle="Air-Support-Termin erstellt"
      deleteToastTitle="Air-Support-Termin gelöscht"
      eventTypes={[
        { value: 'AIR_SUPPORT_TRAINING', label: 'Training' },
        { value: 'AIR_SUPPORT_OPERATION', label: 'Einsatz' },
        { value: 'MEETING', label: 'Besprechung' },
        { value: 'OTHER', label: 'Sonstiges' },
      ]}
      defaultType="AIR_SUPPORT_TRAINING"
      color="#38bdf8"
      viewPermission="air-support:view"
      managePermission="air-support:manage"
    />
  )
}
