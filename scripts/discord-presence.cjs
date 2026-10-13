/** Shared by the production launcher and Next.js gateway. Stats are cached for five minutes. */
function presenceInterval(env = process.env) {
  const seconds = Number(env.DISCORD_BOT_STATUS_INTERVAL_SECONDS || 60)
  return (Number.isInteger(seconds) && seconds >= 30 && seconds <= 3600 ? seconds : 60) * 1000
}

function botPresence(env = process.env, now = Date.now(), stats = null) {
  const configured = String(env.DISCORD_BOT_STATUS || '').trim()
  const title = configured && configured !== 'FIB HR' ? configured : '🛡️ FIB Dashboard'
  const activities = [
    { name: title, type: 3 },
    { name: stats ? `👥 ${stats.activeAgents.toLocaleString('de-DE')} aktive Agents` : '📂 Personalakten & Laufbahnen', type: 3 },
    { name: '📻 den Einsatzfunk', type: 2 },
    { name: '🔎 Ermittlungen & Dauerakten', type: 3 },
    { name: stats ? `🎓 ${stats.completedTrainings.toLocaleString('de-DE')} abgeschlossene Ausbildungen` : '🎓 Ausbildung & Teamwork', type: 3 },
    { name: '💻 FIB Dashboard · by Emin', type: 0 },
  ]
  const selected = activities[Math.floor(now / presenceInterval(env)) % activities.length]
  return { status: 'online', since: null, afk: false, activities: [{ ...selected, name: Array.from(selected.name).slice(0, 128).join('') }] }
}

async function loadPresenceStats(client) {
  const [activeAgents, completedTrainings] = await Promise.all([
    client.agent.count({ where: { status: 'ACTIVE' } }),
    client.agentTraining.count({ where: { completed: true } }),
  ])
  return { activeAgents, completedTrainings }
}

function createPresenceRotation(send, env = process.env, loadStats) {
  let timer = null
  let stats = null
  let pending = false
  let nextRefresh = 0
  async function refresh() {
    if (!loadStats || pending || Date.now() < nextRefresh) return
    pending = true
    try {
      stats = await loadStats()
    } catch {
      // A database outage must not break the gateway or display invented counts.
      stats = null
    } finally {
      nextRefresh = Date.now() + 300_000
      pending = false
    }
  }
  const current = () => botPresence(env, Date.now(), stats)
  function stop() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  return {
    current,
    start() {
      stop()
      void refresh()
      timer = setInterval(() => {
        void refresh()
        send({ op: 3, d: current() })
      }, presenceInterval(env))
      timer.unref?.()
    },
    stop,
  }
}

module.exports = { botPresence, presenceInterval, createPresenceRotation, loadPresenceStats }
