/**
 * Startbestand nach dem Konzept „Lizenzen Intern“ (Dr. iur. Nova DeVil). Wird nur
 * angelegt, nie überschrieben – Texte und Sperrfristen pflegt man danach im Dashboard.
 */
export const DEFAULT_LICENSES = [
  { key: 'fahren', label: 'Fahrlizenz', cooldownDays: 7, description: 'Führen von Dienstfahrzeugen nach StVO, vor allem mit TV. Bei Einstellung als Vorschuss, wenn ein Führerschein vorhanden ist. Wieder nach 7 Tagen und Fahrt mit der Academy.' },
  { key: 'pdw', label: 'PDW', cooldownDays: 0, description: 'Nutzung der PDW nach kurzer Ausbildung, nur nach Freigabe der Leaderschaft.' },
  { key: 'pdw_plus', label: 'PDW+', cooldownDays: 0, description: 'PDW-Nutzung ohne anwesende Leader – für vertrauenswürdige Agents nach ungeschulter Prüfung. Entzug bei falscher Nutzung oder mehrfacher negativer Auffälligkeit.' },
  { key: 'akten', label: 'Akten', cooldownDays: 0, description: 'Bearbeiten von Akten nach Abschluss der GA. Entzug bei Fehlern oder nicht erklärbarer Überschreitung der Bearbeitungszeit; wieder nach erneuter GA.' },
  { key: 'inhaft', label: 'Inhaft', cooldownDays: 0, description: 'Inhaftierungen nach Erhalt der GA. Entzug bei Fehlern oder Nichteinhaltung von Absprachen mit Anwalt oder Richter; wieder wie Akten.' },
  { key: 'mk2_50er', label: 'MK2/50er', cooldownDays: 14, description: 'Nach der Probezeit mit Aufstieg zum Special Agent I. Entzug bei Gebrauch 3. Grades oder nachweisbarer Inkompetenz im Undercover; nach 2 Wochen erneut bei der Academy anfragen.' },
  { key: 'vf', label: 'VF', cooldownDays: 7, description: 'Verhandlungsführung nach der Ausbildung. Entzug bei Fehlverhalten in Verhandlungen oder Einsatzbesprechungen oder respektlosem Auftreten; wieder nach 7 Tagen, erneuter Ausbildung und positiver interner Akte.' },
  { key: 'el', label: 'EL', cooldownDays: 7, description: 'Einsatzleitung nach der Ausbildung. Entzug bei Fehlverhalten in Verhandlungen oder Einsatzbesprechungen vor Ort; wieder nach 7 Tagen, erneuter Ausbildung und positiver interner Akte.' },
  { key: 'sg', label: 'SG', cooldownDays: 0, description: 'Betreten des SG-Geländes ohne Aufsicht. Bei Einstellung; Entzug bei Fehlverhalten oder auf Anfrage der Stelle. Ausnahmen: Schießerei oder Leben retten.' },
  { key: 'pd', label: 'PD', cooldownDays: 0, description: 'Betreten des PD-Geländes ohne Aufsicht. Bei Einstellung; Entzug bei Fehlverhalten oder auf Anfrage der Stelle. Ausnahmen: Schießerei oder Leben retten.' },
  { key: 'md', label: 'MD', cooldownDays: 0, description: 'Betreten des MD-Geländes ohne Aufsicht. Bei Einstellung; Entzug bei Fehlverhalten oder auf Anfrage der Stelle. Ausnahmen: Schießerei oder Leben retten.' },
]
