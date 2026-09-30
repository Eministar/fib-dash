/**
 * Die Kartennadel: farbiger Kopf mit optionalem Emoji über einem kurzen Schaft.
 * Der Schaftfuß sitzt exakt auf der gespeicherten Koordinate – deshalb setzt der
 * Aufrufer `transform: translate(-50%, -100%)` und `transform-origin: 50% 100%`.
 */
export function MapNeedle({
  color,
  icon,
  pending = false,
}: {
  color: string
  icon?: string | null
  pending?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-7 w-6 drop-shadow-[0_2px_2px_rgba(8,8,8,0.8)] transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 ${
        pending ? '-translate-y-0.5' : ''
      }`}
    >
      <span className="absolute bottom-0 left-1/2 h-3 w-px -translate-x-1/2 bg-[#f4f4f4]" />
      <span
        className="absolute left-1/2 top-0 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border-2 border-[#f4f4f4] text-[13px] leading-none shadow-[0_1px_0_rgba(8,8,8,0.6)]"
        style={{ backgroundColor: color }}
      >
        {icon ? (
          <span className="translate-y-px">{icon}</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-[#111111]/70" />
        )}
      </span>
    </span>
  )
}
