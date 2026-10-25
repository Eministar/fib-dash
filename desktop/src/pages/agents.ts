import { $ } from '../dom'
import { initDetail, openAgent, refreshOpenAgent } from '../agents/detail'
import { initList, loadList, refreshList, refreshPermissions } from '../agents/list'
import { initSanctionDialog } from '../agents/sanction-dialog'
import { autoRefresh } from '../ui/auto-refresh'

// Agents: Liste und Akte in einer Seite, wie bei den Ermittlungsakten.

export function initAgents() {
  initList((id) => void openAgent(id))
  initDetail(() => void loadList())
  initSanctionDialog()
  autoRefresh('agents', () => ($('ag-detail-view').hidden ? refreshList() : refreshOpenAgent()))
}

export function showAgents() {
  refreshPermissions()
  if (!$('ag-list-view').hidden) void loadList()
}
