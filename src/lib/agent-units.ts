export function normalizeUnitKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  )).map((item) => item.trim())))
}

export function agentUnitKeys(agent: { units?: unknown; unit?: string | null }): string[] {
  const units = normalizeUnitKeys(agent.units)
  if (units.length > 0) return units
  return agent.unit ? [agent.unit] : []
}
