// @ts-check
/**
 * Command Palette (⌘K / Ctrl+K) for the Viaalink Dashboard.
 * Provides instant keyboard-driven navigation across Boards, Network topology, Services, and Hubs.
 * @module component/palette/CommandPalette
 */
import { StorageManager } from '../../storage/StorageManager.js'
import { switchBoard, switchView } from '../board/boardManagement.js'
import { addWidget, findServiceLocation } from '../widget/widgetManagement.js'
import { getCurrentBoardId, getCurrentViewId } from '../../utils/elements.js'
import { resolveServiceConfig, serviceLimitKey } from '../../utils/serviceUtils.js'
import { openConfigModal } from '../modal/configModal.js'
import { openHubManagerModal } from '../../hubs/HubSwitcher.js'
import { applyTheme, THEME } from '../../ui/theme.js'
import { showNotification } from '../dialog/notification.js'

/**
 * @typedef {Object} PaletteCommand
 * @property {string} id
 * @property {string} group
 * @property {string} label
 * @property {string} meta
 * @property {() => void | Promise<void>} run
 */

/**
 * Build the current list of searchable commands for the Command Palette.
 * @function buildPaletteCommands
 * @param {{switchSurface: (s: 'boards'|'network') => void, openInNetwork: (id: string) => void}} ctx
 * @returns {PaletteCommand[]}
 */
export function buildPaletteCommands (ctx) {
  /** @type {PaletteCommand[]} */
  const cmds = [
    {
      id: 'nav-boards',
      group: 'Navigation',
      label: 'Go to Boards View',
      meta: '⌘B',
      run: () => ctx.switchSurface('boards')
    },
    {
      id: 'nav-network',
      group: 'Navigation',
      label: 'Go to Network Topology View',
      meta: '⌘N',
      run: () => ctx.switchSurface('network')
    },
    {
      id: 'sys-hubs',
      group: 'Workspace',
      label: 'Manage Viaalink Workspace Hubs…',
      meta: 'Hubs',
      run: () => openHubManagerModal()
    },
    {
      id: 'sys-config',
      group: 'Workspace',
      label: 'Open Dashboard Configuration & Snapshots',
      meta: 'Config',
      run: async () => { await openConfigModal() }
    },
    {
      id: 'sys-theme',
      group: 'Workspace',
      label: 'Toggle Theme (Light / Dark)',
      meta: 'Theme',
      run: () => {
        const current = document.documentElement.getAttribute('data-theme') || THEME.LIGHT
        const next = current === THEME.DARK ? THEME.LIGHT : THEME.DARK
        applyTheme(next)
        const cfg = StorageManager.getConfig() || { globalSettings: {} }
        if (!cfg.globalSettings) cfg.globalSettings = {}
        cfg.globalSettings.theme = next
        StorageManager.setConfig(cfg)
      }
    }
  ]

  // Boards & Views
  const boards = StorageManager.getBoards() || []
  for (const b of boards) {
    if (!b || !b.id) continue
    cmds.push({
      id: `board-${b.id}`,
      group: 'Boards & Views',
      label: `Switch to Board: ${b.name || b.id}`,
      meta: `${(b.views || []).length} views`,
      run: async () => {
        ctx.switchSurface('boards')
        await switchBoard(b.id)
      }
    })
    for (const v of b.views || []) {
      if (!v || !v.id) continue
      cmds.push({
        id: `view-${b.id}-${v.id}`,
        group: 'Boards & Views',
        label: `View: ${b.name || b.id} / ${v.name || v.id}`,
        meta: 'View',
        run: async () => {
          ctx.switchSurface('boards')
          await switchBoard(b.id, v.id)
          await switchView(b.id, v.id)
        }
      })
    }
  }

  // Workspace Services
  const services = StorageManager.getServices() || []
  for (const s of services) {
    if (!s) continue
    const resolved = resolveServiceConfig(s)
    const id = String(resolved.id || resolved.name || '')
    if (!id) continue
    const displayName = String(resolved.name || id).replace(/^ASD\s+/i, 'Viaalink ')
    cmds.push({
      id: `svc-net-${id}`,
      group: 'Workspace Services',
      label: `Inspect "${displayName}" in Network Map`,
      meta: `${resolved.state || 'online'} · Network`,
      run: () => ctx.openInNetwork(id)
    })
    if (resolved.url) {
      cmds.push({
        id: `svc-add-${id}`,
        group: 'Workspace Services',
        label: `Add "${displayName}" Widget to Board`,
        meta: resolved.url,
        run: async () => {
          ctx.switchSurface('boards')
          const loc = findServiceLocation(serviceLimitKey(resolved))
          if (loc && typeof resolved.maxInstances === 'number' && resolved.maxInstances <= 1) {
            await switchBoard(loc.boardId, loc.viewId)
            showNotification(`Navigated to existing "${displayName}" widget`, 2000, 'success')
          } else {
            await addWidget(resolved.url, undefined, undefined, 'iframe', getCurrentBoardId(), getCurrentViewId())
          }
        }
      })
    }
  }

  return cmds
}

/**
 * Mount the Command Palette overlay and bind ⌘K / Ctrl+K shortcuts.
 * @function mountCommandPalette
 * @param {{switchSurface: (s: 'boards'|'network') => void, openInNetwork: (id: string) => void}} ctx
 * @returns {{open: () => void, close: () => void}}
 */
export function mountCommandPalette (ctx) {
  let backdrop = /** @type {HTMLElement|null} */ (document.getElementById('command-palette-backdrop'))
  if (!backdrop) {
    backdrop = document.createElement('div')
    backdrop.id = 'command-palette-backdrop'
    backdrop.className = 'command-palette-backdrop'
    backdrop.dataset.testid = 'command-palette'
    document.body.appendChild(backdrop)
  }

  backdrop.innerHTML = ''
  const dialog = document.createElement('div')
  dialog.className = 'command-palette-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Command Palette')

  const searchBar = document.createElement('div')
  searchBar.className = 'command-palette-search-bar'

  const icon = document.createElement('span')
  icon.className = 'asd-mono'
  icon.style.color = 'var(--fg-2)'
  icon.textContent = '⌘K'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'command-palette-input'
  input.dataset.testid = 'command-palette-input'
  input.placeholder = 'Jump to board, view, workspace service, or network node…'

  const escKbd = document.createElement('span')
  escKbd.className = 'asd-kbd'
  escKbd.textContent = 'ESC'

  searchBar.append(icon, input, escKbd)

  const listEl = document.createElement('div')
  listEl.className = 'command-palette-list'
  listEl.dataset.testid = 'command-palette-list'

  dialog.append(searchBar, listEl)
  backdrop.appendChild(dialog)

  let activeIdx = 0
  /** @type {PaletteCommand[]} */
  let filtered = []

  const close = () => {
    backdrop?.classList.remove('open')
  }

  const renderList = () => {
    const q = input.value.trim().toLowerCase()
    const all = buildPaletteCommands(ctx)
    filtered = q
      ? all.filter(c => `${c.group} ${c.label} ${c.meta}`.toLowerCase().includes(q))
      : all
    if (activeIdx >= filtered.length) activeIdx = 0

    listEl.innerHTML = ''
    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.style.padding = '16px'
      empty.style.textAlign = 'center'
      empty.style.color = 'var(--fg-2)'
      empty.style.fontSize = '12.5px'
      empty.textContent = 'No matching commands or services'
      listEl.appendChild(empty)
      return
    }

    let lastGroup = ''
    filtered.forEach((cmd, idx) => {
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group
        const gTitle = document.createElement('div')
        gTitle.className = 'command-palette-group-title'
        gTitle.textContent = cmd.group
        listEl.appendChild(gTitle)
      }
      const item = document.createElement('div')
      item.className = `command-palette-item${idx === activeIdx ? ' active' : ''}`
      item.dataset.testid = `palette-item-${cmd.id}`

      const lbl = document.createElement('span')
      lbl.textContent = cmd.label

      const meta = document.createElement('span')
      meta.className = 'command-palette-item-meta'
      meta.textContent = cmd.meta

      item.append(lbl, meta)
      item.addEventListener('click', () => {
        close()
        Promise.resolve(cmd.run()).catch(() => {})
      })
      listEl.appendChild(item)
    })
  }

  const open = () => {
    input.value = ''
    activeIdx = 0
    renderList()
    backdrop?.classList.add('open')
    setTimeout(() => input.focus(), 10)
  }

  input.addEventListener('input', () => {
    activeIdx = 0
    renderList()
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length > 0) {
        activeIdx = (activeIdx + 1) % filtered.length
        renderList()
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length > 0) {
        activeIdx = (activeIdx - 1 + filtered.length) % filtered.length
        renderList()
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = filtered[activeIdx]
      if (chosen) {
        close()
        Promise.resolve(chosen.run()).catch(() => {})
      }
    }
  })

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })

  const triggerBtn = document.getElementById('command-palette-trigger')
  if (triggerBtn) {
    triggerBtn.addEventListener('click', open)
  }

  return { open, close }
}
