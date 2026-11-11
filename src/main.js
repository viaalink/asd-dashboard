// src/main.js
// @ts-check
/**
 * Entry point for the dashboard application.
 *
 * @module main
 */
import { initializeMainMenu, applyControlVisibility } from './component/menu/menu.js'
import { initializeBoards, switchBoard, updateBoardSelector, updateViewSelector } from './component/board/boardManagement.js'
import { getCurrentBoardId } from './utils/elements.js'
import { initializeDashboardMenu, applyWidgetMenuVisibility } from './component/menu/dashboardMenu.js'
import { initializeDragAndDrop } from './component/widget/events/dragDrop.js'
import { fetchServices } from './utils/fetchServices.js'
import { getConfig } from './utils/getConfig.js'
import { openConfigModal } from './component/modal/configModal.js'
import { mountBoardControl } from './component/board/BoardControl.js'
import { mountViewControl } from './component/view/ViewControl.js'
import { loadFromFragment } from './utils/fragmentLoader.js'
import { Logger } from './utils/Logger.js'
import { widgetStore } from './component/widget/widgetStore.js'
import { debounce, debounceLeading } from './utils/utils.js'
import { StorageManager, APP_STATE_CHANGED } from './storage/StorageManager.js'
import { runSilentImportFlowIfRequested } from './flows/silentImportFlow.js'
import { initThemeFromConfig } from './ui/theme.js'

import { mountServiceControl } from './component/service/ServiceControl.js'
import { mountRuntimeControl } from './component/runtime/RuntimeControl.js'
import { mountHubSwitcher } from './hubs/HubSwitcher.js'
import { mountNetworkView } from './views/network/NetworkView.js'
import { mountCommandPalette } from './component/palette/CommandPalette.js'

const logger = new Logger('main.js')
Logger.enableLogs('all')

const LAYER_ROOT_ID = 'asd-layer-root'
/** Ensure the overlay layer root exists */
function ensureLayerRoot () {
  if (!document.getElementById(LAYER_ROOT_ID)) {
    const el = document.createElement('div')
    el.id = LAYER_ROOT_ID
    document.body.appendChild(el)
  }
}

// Global state container
window.asd = {
  services: [],
  config: {},
  currentBoardId: null,
  currentViewId: null,
  widgetStore
}

window.addEventListener('hashchange', () => loadFromFragment(false))

/**
 * Switch the primary dashboard surface between 'boards' and 'network'.
 * @function switchPrimarySurface
 * @param {'boards'|'network'} surface
 * @returns {void}
 */
export function switchPrimarySurface (surface) {
  const next = surface === 'network' ? 'network' : 'boards'
  const boardEl = /** @type {HTMLElement|null} */ (document.querySelector('main > .board'))
  const controlsEl = /** @type {HTMLElement|null} */ (document.getElementById('controls'))
  const netEl = /** @type {HTMLElement|null} */ (document.getElementById('network-surface'))
  const btnBoards = document.getElementById('nav-boards')
  const btnNetwork = document.getElementById('nav-network')

  if (boardEl) {
    boardEl.style.display = next === 'boards' ? '' : 'none'
  }
  if (controlsEl) {
    controlsEl.style.display = next === 'boards' ? '' : 'none'
  }
  if (netEl) {
    netEl.classList.toggle('active', next === 'network')
    netEl.style.display = next === 'network' ? 'flex' : 'none'
  }
  if (btnBoards) btnBoards.classList.toggle('active', next === 'boards')
  if (btnNetwork) btnNetwork.classList.toggle('active', next === 'network')

  document.body.dataset.surface = next
  try {
    StorageManager.misc.setItem('activeSurface', next)
  } catch { /* ignore before StorageManager init */ }
}

/**
 * Main application initialization function.
 * Orchestrates loading configuration, services, and initializing the UI.
 */
async function main () {
  logger.log('Application initialization started')

  ensureLayerRoot()

  try {
    await StorageManager.init({ persist: true })
  } catch (err) {
    console.error('Failed to initialize StorageManager', err)
    throw err
  }

  // 1. Handle configuration from URL fragment first
  const params = new URLSearchParams(location.search)
  const force = params.get('force') === 'true'

  // Run silent-import first so fragment loading only happens once
  const didImport = await runSilentImportFlowIfRequested()
  if (!didImport) await loadFromFragment(force)

  // 2. Initialize core UI elements
  initializeMainMenu()
  initializeDashboardMenu()
  const boardPanel = mountBoardControl()
  const viewPanel = mountViewControl()
  const servicePanel = mountServiceControl()
  const runtimePanel = mountRuntimeControl()
  const hubSwitcher = mountHubSwitcher()
  const networkView = mountNetworkView({
    onSwitchToBoards: () => switchPrimarySurface('boards')
  })

  const openInNetwork = (/** @type {string} */ serviceId) => {
    switchPrimarySurface('network')
    networkView?.focusNode(serviceId)
  }

  const switchSurfaceAndRefresh = (/** @type {'boards'|'network'} */ s) => {
    switchPrimarySurface(s)
    if (s === 'network') networkView?.refresh()
  }

  const commandPalette = mountCommandPalette({
    switchSurface: switchSurfaceAndRefresh,
    openInNetwork
  })

  window.asd.switchSurface = switchSurfaceAndRefresh
  window.asd.openInNetwork = openInNetwork
  window.asd.commandPalette = commandPalette

  // Bind primary surface buttons & keyboard shortcuts (⌘B, ⌘N, ⌘K)
  document.getElementById('nav-boards')?.addEventListener('click', () => switchPrimarySurface('boards'))
  document.getElementById('nav-network')?.addEventListener('click', () => {
    switchPrimarySurface('network')
    networkView?.refresh()
  })

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'k') {
      e.preventDefault()
      commandPalette.open()
    } else if (key === 'b') {
      e.preventDefault()
      switchPrimarySurface('boards')
    } else if (key === 'n') {
      e.preventDefault()
      switchPrimarySurface('network')
      networkView?.refresh()
    }
  })

  initializeDragAndDrop()

  // 3. Load services and configuration in parallel
  /** @type {import('./types.js').DashboardConfig} */
  let config
  try {
    await Promise.all([fetchServices(), getConfig()]).then(([, result]) => {
      config = result
    })
  } catch (e) {
    logger.error('Failed to load critical configuration or services:', e)
    // If config fails, getConfig() will open the modal.
    return // Stop initialization if critical data fails
  }

  // 4. Apply settings that depend on the loaded config
  // Bind unlinked /asde/terminal widgets to ttyd service when present so defaultService limit(1) isn't triggered
  const loadedServices = StorageManager.getServices() || []
  if (loadedServices.some(s => s?.id === 'ttyd') && Array.isArray(config?.boards)) {
    let patched = false
    for (const b of config.boards) {
      for (const v of (b.views || [])) {
        for (const w of (v.widgetState || [])) {
          if (!w.serviceId && typeof w.url === 'string' && w.url.includes('/asde/terminal')) {
            w.serviceId = 'ttyd'
            patched = true
          }
        }
      }
    }
    if (patched) {
      StorageManager.setConfig(config)
    }
  }
  initThemeFromConfig(config)
  applyControlVisibility()
  applyWidgetMenuVisibility()

  // 5. Initialize boards and switch to the last used or default board/view
  const initialBoardView = await initializeBoards()

  const lastUsedBoardId = StorageManager.misc.getLastBoardId()
  const lastUsedViewId = StorageManager.misc.getLastViewId()
  const boardExists = (config.boards || []).some(board => board.id === lastUsedBoardId)

  let boardIdToLoad = initialBoardView?.boardId
  let viewIdToLoad = initialBoardView?.viewId

  if (boardExists) {
    boardIdToLoad = lastUsedBoardId
    viewIdToLoad = lastUsedViewId
  }

  if (boardIdToLoad) {
    logger.log(`Switching to initial board: ${boardIdToLoad}, view: ${viewIdToLoad}`)
    await switchBoard(boardIdToLoad, viewIdToLoad)
    updateViewSelector(boardIdToLoad)
    if (boardPanel) boardPanel.refresh()
    if (viewPanel) viewPanel.refresh()
  } else {
    logger.warn('No boards available to display.')
  }

  // Initial service and hub population (after services & boards)
  servicePanel?.refresh()
  hubSwitcher?.refresh()

  // Honor ?surface=network or ?focus=<serviceId> deep links
  const focusId = params.get('focus')
  const requestedSurface = params.get('surface')
  if (focusId) {
    openInNetwork(focusId)
  } else if (requestedSurface === 'network') {
    switchPrimarySurface('network')
    networkView?.refresh()
  } else {
    switchPrimarySurface('boards')
  }

  // 7. Initialize modal triggers
  const buttonDebounce = 200
  const handleConfigModal = debounceLeading(openConfigModal, buttonDebounce)
  document.getElementById('open-config-modal')
    .addEventListener('click', /** @type {EventListener} */(handleConfigModal))

  // ACTIVE EVENT LISTENER ---
  const onStateChange = (event) => {
    const { reason } = event.detail || {}
    logger.log(`[Event Listener] Reacting to state change. Reason: ${reason || 'unknown'}`)

    const currentBoardId = getCurrentBoardId()

    switch (reason) {
      case 'config':
        updateBoardSelector()
        if (currentBoardId) updateViewSelector(currentBoardId)
        if (boardPanel) boardPanel.refresh()
        if (viewPanel) viewPanel.refresh()
        // Repopulate panel when config (e.g., boards/views) changes
        servicePanel?.refresh()
        runtimePanel?.refresh()
        hubSwitcher?.refresh()
        if (document.body.dataset.surface === 'network') networkView?.refresh()
        break

      case 'services':
        // Repopulate panel when services update
        servicePanel?.refresh()
        runtimePanel?.refresh()
        hubSwitcher?.refresh()
        if (document.body.dataset.surface === 'network') networkView?.refresh()
        break
    }
  }

  const debouncedUiUpdater = debounce(onStateChange, 150)
  window.addEventListener(APP_STATE_CHANGED, /** @type {EventListener} */(debouncedUiUpdater))
  logger.log('Active event listener for state changes has been initialized.')

  logger.log('Application initialization finished')
  // Signal to Playwright that the initial load and render is complete.
  document.dispatchEvent(new Event('main:ready'))
  document.body.dataset.ready = 'true'
}

// Start the application once the DOM is ready; ensure the event isn't missed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main().catch(err => logger.error('Failed to initialize application', err))
}
