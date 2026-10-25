import { $ } from '../dom'
import { initDetail, openAgent } from '../agents/detail'
import { initList, loadList, refreshPermissions } from '../agents/list'
import { initSanctionDialog } from '../agents/sanction-dialog'

// Agents: Liste und Akte in einer Seite, wie bei den Ermittlungsakten.

export function initAgents() {
  initList((id) => void openAgent(id))
  initDetail(() => void loadList())
  initSanctionDialog()
}

export function showAgents() {
  refreshPermissions()
  if (!$('ag-list-view').hidden) void loadList()
}
