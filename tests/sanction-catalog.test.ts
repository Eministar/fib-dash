import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGGRAVATING_CIRCUMSTANCES,
  DECISION_CHECKLIST,
  MITIGATING_CIRCUMSTANCES,
  PENAL_GRADE_ORDER,
  PENAL_GRADE_RULES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  SANCTION_VIOLATIONS,
  authorityForSanction,
  isChecklistComplete,
  isPenalGrade,
  isSanctionLevel,
  nextLevel,
  normalizeCircumstances,
  normalizeChecklist,
  recommendedLevel,
  regularLevelForGrade,
  repeatPrinciple,
  requiresDualControl,
  resolveViolation,
  violationsForGrade,
} from '../src/lib/sanction-catalog'

// --- Struktur des Katalogs -------------------------------------------------

test('Katalog deckt genau sechs Penal Grades und sieben Sanktionsstufen ab', () => {
  assert.equal(PENAL_GRADE_ORDER.length, 6)
  assert.equal(SANCTION_LEVEL_ORDER.length, 7)
  assert.deepEqual(PENAL_GRADE_ORDER, ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(SANCTION_LEVEL_ORDER, ['01', '02', '03', '04', '05', '06', '07'])
})

test('jeder Grade hat mindestens eine Regelsanktion, die es auch gibt', () => {
  for (const grade of PENAL_GRADE_ORDER) {
    const rule = PENAL_GRADE_RULES[grade]
    assert.ok(rule.regularLevels.length > 0, `PG ${grade} ohne Regelsanktion`)
    for (const level of rule.regularLevels) {
      assert.ok(isSanctionLevel(level), `PG ${grade} verweist auf unbekannte Stufe ${level}`)
    }
  }
})

test('Verstoß-Codes sind eindeutig und jeder Grade hat Beispiele', () => {
  const codes = SANCTION_VIOLATIONS.map((item) => item.code)
  assert.equal(new Set(codes).size, codes.length, 'doppelte Verstoß-Codes')

  for (const grade of PENAL_GRADE_ORDER) {
    assert.ok(violationsForGrade(grade).length > 0, `PG ${grade} ohne Beispielverstöße`)
  }
})

test('resolveViolation liefert den passenden Grade zurück', () => {
  const violation = resolveViolation('pg2.dienstweg')
  assert.ok(violation)
  assert.equal(violation.grade, '2')
  assert.equal(resolveViolation('gibt.es.nicht'), null)
  assert.equal(resolveViolation(null), null)
})

// --- Validierung -----------------------------------------------------------

test('Grade- und Stufenprüfung weist die alten römischen Werte ab', () => {
  assert.equal(isPenalGrade('3'), true)
  assert.equal(isPenalGrade('III'), false)
  assert.equal(isPenalGrade('7'), false)
  assert.equal(isSanctionLevel('05'), true)
  assert.equal(isSanctionLevel('5'), false)
  assert.equal(isSanctionLevel('08'), false)
})

// --- Wiederholungslogik (Abschnitt 04) -------------------------------------

test('Erstverstoß bekommt die Regelsanktion des Grades', () => {
  assert.equal(recommendedLevel('1', 1), '01')
  assert.equal(recommendedLevel('2', 1), '02')
  assert.equal(recommendedLevel('3', 1), '03')
  assert.equal(recommendedLevel('4', 1), '04')
  assert.equal(recommendedLevel('5', 1), '06')
  assert.equal(recommendedLevel('6', 1), '07')
})

test('zweiter gleichartiger Verstoß hebt auf die nächsthöhere Stufe', () => {
  assert.equal(recommendedLevel('1', 2), '02')
  assert.equal(recommendedLevel('2', 2), '03')
  assert.equal(recommendedLevel('3', 2), '04')
  assert.equal(recommendedLevel('4', 2), '05')
})

test('dritter Verstoß führt mindestens zu Degradierung, vierter zur Entlassung', () => {
  assert.equal(recommendedLevel('1', 3), '04')
  assert.equal(recommendedLevel('2', 3), '04')
  assert.equal(recommendedLevel('1', 4), '06')
  assert.equal(recommendedLevel('3', 4), '06')
})

test('Wiederholung stuft nie unter die Regelsanktion des Grades zurück', () => {
  for (const grade of PENAL_GRADE_ORDER) {
    const regular = regularLevelForGrade(grade)
    for (let occurrence = 1; occurrence <= 5; occurrence += 1) {
      const suggested = recommendedLevel(grade, occurrence)
      assert.ok(
        suggested >= regular,
        `PG ${grade}, ${occurrence}. Verstoß: ${suggested} liegt unter der Regelsanktion ${regular}`,
      )
    }
  }
})

test('die höchste Stufe bleibt sich selbst', () => {
  assert.equal(nextLevel('07'), '07')
  assert.equal(nextLevel('06'), '07')
  assert.equal(recommendedLevel('6', 4), '07')
})

test('repeatPrinciple ist auf die vier Stufen der Tabelle begrenzt', () => {
  assert.equal(repeatPrinciple(1), 'Regelsanktion nach Penal Grade')
  assert.equal(repeatPrinciple(2), 'Nächsthöhere Sanktionsstufe')
  assert.equal(repeatPrinciple(0), repeatPrinciple(1))
  assert.equal(repeatPrinciple(99), repeatPrinciple(4))
})

// --- Zuständigkeiten (Abschnitt 05) ----------------------------------------

test('Penal Grade 5 und 6 landen immer auf der Chief-Ebene', () => {
  assert.equal(authorityForSanction('5', '06').key, 'CHIEF_LEVEL')
  assert.equal(authorityForSanction('6', '07').key, 'CHIEF_LEVEL')
  // Selbst eine milde Stufe hebt bei diesen Graden auf die Chief-Ebene.
  assert.equal(authorityForSanction('5', '01').key, 'CHIEF_LEVEL')
})

test('leichtere Grade folgen der Zuständigkeit der Stufe', () => {
  assert.equal(authorityForSanction('1', '01').key, 'DIRECT_SUPERVISOR')
  assert.equal(authorityForSanction('2', '02').key, 'LEADERSHIP')
  assert.equal(authorityForSanction('4', '05').key, 'DEPARTMENT_HEAD')
})

test('höhere Stufen verlangen nie einen niedrigeren Mindestrang', () => {
  let previous = Number.POSITIVE_INFINITY
  for (const level of SANCTION_LEVEL_ORDER) {
    const authority = authorityForSanction('1', level)
    // Kleiner sortOrder = höherer Rang, muss also monoton fallen.
    assert.ok(
      authority.defaultMinRankSortOrder <= previous,
      `Stufe ${level} verlangt einen niedrigeren Rang als die vorherige Stufe`,
    )
    previous = authority.defaultMinRankSortOrder
  }
})

test('Vier-Augen-Prinzip greift ab Penal Grade 5', () => {
  assert.equal(requiresDualControl('4'), false)
  assert.equal(requiresDualControl('5'), true)
  assert.equal(requiresDualControl('6'), true)
})

// --- Entscheidungs-Check (Abschnitt 07) ------------------------------------

test('Checkliste gilt erst als vollständig, wenn alle neun Punkte bestätigt sind', () => {
  assert.equal(DECISION_CHECKLIST.length, 9)

  const complete: Record<string, boolean> = {}
  for (const item of DECISION_CHECKLIST) complete[item.key] = true
  assert.equal(isChecklistComplete(complete), true)

  const missingOne = { ...complete, [DECISION_CHECKLIST[3].key]: false }
  assert.equal(isChecklistComplete(missingOne), false)
  assert.equal(isChecklistComplete({}), false)
  assert.equal(isChecklistComplete(null), false)
})

test('normalizeChecklist verwirft unbekannte Schlüssel und nicht-boolesche Werte', () => {
  const result = normalizeChecklist({ facts: true, evidence: 'ja', unbekannt: true })
  assert.equal(result.facts, true)
  assert.equal(result.evidence, false)
  assert.equal('unbekannt' in result, false)
  assert.equal(Object.keys(result).length, DECISION_CHECKLIST.length)
})

// --- Umstände (Abschnitt 04) -----------------------------------------------

test('normalizeCircumstances lässt nur Einträge aus dem Katalog durch', () => {
  const result = normalizeCircumstances(
    ['Vorsatz', 'Frei erfunden', 42, 'Vertuschung'],
    AGGRAVATING_CIRCUMSTANCES,
  )
  assert.deepEqual(result, ['Vorsatz', 'Vertuschung'])
  assert.deepEqual(normalizeCircumstances('kein Array', MITIGATING_CIRCUMSTANCES), [])
})

// --- Maßnahmen-Flags -------------------------------------------------------

test('nur die Entlassungsstufen beenden das Dienstverhältnis', () => {
  const terminating = SANCTION_LEVEL_ORDER.filter((level) => SANCTION_LEVELS[level].terminates)
  assert.deepEqual(terminating, ['06', '07'])
  assert.equal(SANCTION_LEVELS['05'].suspends, true)
  assert.equal(SANCTION_LEVELS['04'].demotes, true)
})
