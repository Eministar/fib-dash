import { $ } from '../dom'
import { initDetail, openCase, refreshOpenCase } from '../investigations/detail'
import { initList, loadList, refreshPermissions } from '../investigations/list'
import { initRegisters, loadRegister, registerActive } from '../investigations/registers'
import { autoRefresh } from '../ui/auto-refresh'

// Ermittlungsakten: Liste und Detailansicht in einer Seite, wie Navigation in WinUI.

export function initInvestigations() {
  initRegisters()
  initList((id) => void openCase(id))
  initDetail(() => {})
  autoRefresh('investigations', () => registerActive() ? loadRegister() : ($('inv-detail-view').hidden ? loadList() : refreshOpenCase()))
}

export function showInvestigations() {
  refreshPermissions()
  if (registerActive()) { void loadRegister(); return }
  if (!$('inv-list-view').hidden) void loadList()
}
