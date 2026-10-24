import { $ } from '../dom'
import { initDetail, openCase } from '../investigations/detail'
import { initList, loadList, refreshPermissions } from '../investigations/list'

// Ermittlungsakten: Liste und Detailansicht in einer Seite, wie Navigation in WinUI.

export function initInvestigations() {
  initList((id) => void openCase(id))
  initDetail(() => {})
}

export function showInvestigations() {
  refreshPermissions()
  if (!$('inv-list-view').hidden) void loadList()
}
