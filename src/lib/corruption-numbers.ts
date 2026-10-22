/** Beamtennummern der Korruptionskontrollen – ohne zod, auch für den Browser. */
export function officialNumber(id: number) { return `BEA-${String(id).padStart(6, '0')}` }
export function parseOfficialNumber(value: string) {
  const match = /^(?:BEA-)?0*(\d+)$/i.exec(value.trim())
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null
}
