/**
 * Prüft die ersten Bytes einer Datei gegen den deklarierten MIME-Typ, statt
 * dem `Content-Type` des Clients zu glauben.
 *
 * Bewusste Einschränkung: WebM und MKV teilen sich die EBML-Signatur
 * `1A 45 DF A3` und lassen sich hier nicht auseinanderhalten. Geprüft wird
 * deshalb gegen die erlaubte Signaturgruppe, nicht auf exakte Übereinstimmung
 * zweier ohnehin erlaubter Containerformate. Fremde Formate weist das
 * zuverlässig ab; genau das ist die Aufgabe.
 */
export function matchesFileSignature(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())
  if (mime === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  if (mime === 'application/pdf') return b.subarray(0, 5).toString() === '%PDF-'
  if (mime === 'video/webm' || mime === 'video/x-matroska') return b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  if (mime === 'video/mp4' || mime === 'video/quicktime') return b.subarray(4, 8).toString() === 'ftyp'
  return false
}
