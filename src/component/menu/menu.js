// @ts-check
/**
 * Build and initialize the main dashboard menu UI.
 *
 * @module menu
 */
import emojiList from '../../ui/unicodeEmoji.js'
import { showNotification } from '../dialog/notification.js'
import { debounceLeading } from '../../utils/utils.js'
import { StorageManager } from '../../storage/StorageManager.js'

/**
 * Initialize service worker controls in the menu.
 *
 * @function initSW
 * @returns {void}
 */
function initSW () {
  const swToggle = /** @type {HTMLInputElement} */(document.getElementById('sw-toggle'))
  const swIcon = document.querySelector('.sw-icon')
  /** @type {HTMLElement} */
  const swCheckbox = document.querySelector('.icon-checkbox')
  const swEnabled = StorageManager.misc.getItem('swEnabled') === 'true'
  swToggle.checked = swEnabled

  const buttonDebounce = 200

  /**
   * Updates the UI of the service worker toggle icon and attributes.
   * @function updateServiceWorkerUI
   * @param {boolean} isEnabled - True if the service worker should be shown as enabled.
   * @returns {void}
   */
  function updateServiceWorkerUI (isEnabled) {
    if (isEnabled) {
      swIcon.textContent = emojiList.serviceWorkerEnabled.unicode // Network On
      swCheckbox.setAttribute('aria-checked', 'true')
      swCheckbox.setAttribute('title', 'Service worker is enabled')
    } else {
      swIcon.textContent = emojiList.serviceWorkerDisabled.unicode // Network Off
      swCheckbox.setAttribute('aria-checked', 'false')
      swCheckbox.setAttribute('title', 'Service worker is disabled')
    }
  }

  updateServiceWorkerUI(swEnabled)

  if ('serviceWorker' in navigator) {
    /**
     * Registers the service worker script.
     * @function registerServiceWorker
     * @returns {void}
     */
    function registerServiceWorker () {
      navigator.serviceWorker.register('/serviceWorker.js', { scope: '/' })
        .then(function (registration) {
          console.log('Service Worker registered with scope:', registration.scope)
        })
        .catch(function (error) {
          console.error('Service Worker registration failed:', error)
        })
    }

    /**
     * Unregisters all active service workers and clears their caches.
     * @function unregisterServiceWorker
     * @returns {void}
     */
    function unregisterServiceWorker () {
      navigator.serviceWorker.getRegistrations()
        .then(function (registrations) {
          for (const registration of registrations) {
            registration.unregister()
              .then(function () {
                console.log('Service Worker unregistered')
              })
              .catch(function (error) {
                console.error('Service Worker unregistration failed:', error)
              })
          }
        })
        .catch(function (error) {
          console.error('Service Worker registration retrieval failed:', error)
        })
      caches.keys()
        .then(function (cacheNames) {
          return Promise.all(
            cacheNames.map(function (cacheName) {
              return caches.delete(cacheName)
            })
          ).then(function () {
            // console.log('All caches cleared')
          })
        })
        .catch(function (error) {
          console.error('Cache clearing failed:', error)
        })
    }

    if (swEnabled) {
      registerServiceWorker()
    } else {
      unregisterServiceWorker()
    }

    const handleSwChange = debounceLeading(() => {
      const isEnabled = swToggle.checked
      StorageManager.misc.setItem('swEnabled', String(isEnabled))
      updateServiceWorkerUI(isEnabled)
      showNotification(`Service Worker ${isEnabled ? 'Enabled' : 'Disabled'}`, 500)

      if (isEnabled) {
        registerServiceWorker()
      } else {
        unregisterServiceWorker()
      }
    }, buttonDebounce)
    swToggle.addEventListener('change', /** @type {EventListener} */(handleSwChange))
  }
}

/**
 * Create the main dashboard menu and insert it into the page.
 *
 * @function initializeMainMenu
 * @returns {void}
 */
function initializeMainMenu () {
  document.getElementById('viaalink-topbar')?.remove()
  document.getElementById('controls')?.remove()

  // Viaalink v2 Top Navigation Bar (Brand, Hub Switcher, Surface Switcher, Command Palette)
  const topbar = document.createElement('header')
  topbar.id = 'viaalink-topbar'
  topbar.className = 'viaalink-topbar'
  topbar.style.display = 'flex'
  topbar.style.alignItems = 'center'

  const brandControl = document.createElement('div')
  brandControl.id = 'brand-control'
  brandControl.dataset.testid = 'brand-control'
  brandControl.style.display = 'inline-flex'
  brandControl.style.alignItems = 'center'
  const brandMark = document.createElement('span')
  brandMark.className = 'viaalink-brand-mark'
  brandMark.setAttribute('aria-hidden', 'true')
  brandMark.textContent = 'V'
  const brandText = document.createElement('span')
  brandText.className = 'viaalink-brand-text'
  brandText.textContent = 'Viaalink'
  brandControl.append(brandMark, brandText)

  const hubControl = document.createElement('div')
  hubControl.id = 'hub-control'
  hubControl.dataset.testid = 'hub-control'
  hubControl.style.display = 'inline-flex'
  hubControl.style.alignItems = 'center'

  const surfaceSwitcher = document.createElement('div')
  surfaceSwitcher.id = 'surface-switcher'
  surfaceSwitcher.dataset.testid = 'surface-switcher'
  surfaceSwitcher.style.display = 'inline-flex'
  surfaceSwitcher.style.alignItems = 'center'

  const navBoardsBtn = document.createElement('button')
  navBoardsBtn.type = 'button'
  navBoardsBtn.id = 'nav-boards'
  navBoardsBtn.className = 'surface-tab-btn active'
  navBoardsBtn.dataset.testid = 'nav-boards'
  navBoardsBtn.innerHTML = '<span>Boards</span><span class="asd-kbd">⌘B</span>'

  const navNetworkBtn = document.createElement('button')
  navNetworkBtn.type = 'button'
  navNetworkBtn.id = 'nav-network'
  navNetworkBtn.className = 'surface-tab-btn'
  navNetworkBtn.dataset.testid = 'nav-network'
  navNetworkBtn.innerHTML = '<span>Network</span><span class="asd-kbd">⌘N</span>'

  surfaceSwitcher.append(navBoardsBtn, navNetworkBtn)

  const topbarSpacer = document.createElement('div')
  topbarSpacer.style.flex = '1 1 auto'

  const paletteControl = document.createElement('div')
  paletteControl.id = 'palette-control'
  const paletteBtn = document.createElement('button')
  paletteBtn.type = 'button'
  paletteBtn.id = 'command-palette-trigger'
  paletteBtn.className = 'palette-trigger-btn'
  paletteBtn.dataset.testid = 'command-palette-trigger'
  paletteBtn.title = 'Open Command Palette (⌘K)'
  paletteBtn.innerHTML = '<span>Search…</span><span class="asd-kbd">⌘K</span>'

  const themeBtn = document.createElement('button')
  themeBtn.type = 'button'
  themeBtn.id = 'theme-toggle-btn'
  themeBtn.className = 'palette-trigger-btn'
  themeBtn.dataset.testid = 'theme-toggle-btn'
  themeBtn.title = 'Toggle Dark / Light Theme'
  themeBtn.textContent = '◐ Theme'
  themeBtn.addEventListener('click', () => {
    const nextDark = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', nextDark)
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light'
    document.body.classList.toggle('dark-mode', nextDark)
  })

  paletteControl.append(paletteBtn, themeBtn)

  topbar.append(brandControl, hubControl, surfaceSwitcher, topbarSpacer, paletteControl)

  const menu = document.createElement('menu')
  menu.id = 'controls'

  // Board control group
  const boardControl = document.createElement('div')
  boardControl.className = 'control-group'
  boardControl.id = 'board-control'

  const boardSelector = document.createElement('select')
  boardSelector.id = 'board-selector'
  boardControl.appendChild(boardSelector)

  const boardDropdown = document.createElement('div')
  boardDropdown.id = 'board-dropdown'
  boardDropdown.className = 'dropdown'

  const boardButton = document.createElement('button')
  boardButton.className = 'dropbtn'
  boardButton.textContent = 'Board Actions'
  boardDropdown.appendChild(boardButton)

  const boardDropdownContent = document.createElement('div')
  boardDropdownContent.className = 'dropdown-content';

  ['create', 'rename', 'delete'].forEach(action => {
    const actionLink = document.createElement('a')
    actionLink.href = '#'
    actionLink.dataset.action = action
    actionLink.textContent = action.charAt(0).toUpperCase() + action.slice(1) + ' Board'
    boardDropdownContent.appendChild(actionLink)
  })

  boardDropdown.appendChild(boardDropdownContent)
  boardControl.appendChild(boardDropdown)
  menu.appendChild(boardControl)

  // View control group
  const viewControl = document.createElement('div')
  viewControl.className = 'control-group'
  viewControl.id = 'view-control'

  const viewSelector = document.createElement('select')
  viewSelector.id = 'view-selector'
  viewControl.appendChild(viewSelector)

  const viewDropdown = document.createElement('div')
  viewDropdown.id = 'view-dropdown'
  viewDropdown.className = 'dropdown'

  const viewButton = document.createElement('button')
  viewButton.className = 'dropbtn'
  viewButton.textContent = 'View Actions'
  viewDropdown.appendChild(viewButton)

  const viewDropdownContent = document.createElement('div')
  viewDropdownContent.className = 'dropdown-content';

  ['create', 'rename', 'delete', 'reset'].forEach(action => {
    const actionLink = document.createElement('a')
    actionLink.href = '#'
    actionLink.dataset.action = action
    actionLink.textContent = action.charAt(0).toUpperCase() + action.slice(1) + ' View'
    viewDropdownContent.appendChild(actionLink)
  })

  viewDropdown.appendChild(viewDropdownContent)
  viewControl.appendChild(viewDropdown)
  menu.appendChild(viewControl)

  const viewButtonMenu = document.createElement('div')
  viewButtonMenu.className = 'control-group'
  viewButtonMenu.id = 'view-button-menu'
  menu.appendChild(viewButtonMenu)

  const runtimeControl = document.createElement('div')
  runtimeControl.className = 'control-group'
  runtimeControl.id = 'runtime-control'
  menu.appendChild(runtimeControl)

  // Service control group
  const serviceControl = document.createElement('div')
  serviceControl.className = 'control-group'
  serviceControl.id = 'service-control'
  const widgetHost = document.createElement('div')
  widgetHost.id = 'widget-selector-panel'
  serviceControl.appendChild(widgetHost)

  menu.appendChild(serviceControl)

  // Admin control group
  const adminControl = document.createElement('div')
  adminControl.className = 'control-group'
  adminControl.id = 'admin-control'

  const widgetMenuToggler = document.createElement('label')
  widgetMenuToggler.id = 'toggle-widget-menu'
  widgetMenuToggler.ariaLabel = 'Toggle Widget Menu'
  widgetMenuToggler.title = 'Toggle Widget Menu'
  widgetMenuToggler.textContent = emojiList.edit.unicode
  adminControl.appendChild(widgetMenuToggler)

  const swLabel = document.createElement('label')
  swLabel.htmlFor = 'sw-toggle'
  swLabel.className = 'icon-checkbox'
  swLabel.ariaLabel = 'Toggle service worker'
  swLabel.title = 'Toggle service worker'

  const swCheckbox = document.createElement('input')
  swCheckbox.type = 'checkbox'
  swCheckbox.id = 'sw-toggle'
  swLabel.appendChild(swCheckbox)

  const swIcon = document.createElement('span')
  swIcon.className = 'sw-icon'
  swLabel.appendChild(swIcon)
  adminControl.appendChild(swLabel)
  const configEditorLabel = document.createElement('label')
  configEditorLabel.id = 'open-config-modal'
  configEditorLabel.ariaLabel = 'Config editor'
  configEditorLabel.title = 'Config editor'
  configEditorLabel.textContent = emojiList.floppyDisk.unicode
  adminControl.appendChild(configEditorLabel)

  const resetButton = document.createElement('label')
  resetButton.id = 'reset-button'
  resetButton.ariaLabel = 'Reset dashboard (keeps saved states)'
  resetButton.title = 'Reset dashboard (keeps saved states)'
  resetButton.textContent = `${emojiList.crossCycle.unicode}`
  adminControl.appendChild(resetButton)

  menu.appendChild(adminControl)

  document.body.insertBefore(menu, document.body.firstChild)
  document.body.insertBefore(topbar, menu)
  initSW()
}

/**
 * Applies visibility settings to control groups based on global configuration.
 * @function applyControlVisibility
 * @returns {void}
 */
function applyControlVisibility () {
  const settings = StorageManager.getConfig()?.globalSettings || {}
  const boardControl = document.getElementById('board-control')
  if (boardControl) {
    boardControl.style.display = settings.hideBoardControl === true || settings.hideBoardControl === 'true' ? 'none' : ''
  }
  const viewControl = document.getElementById('view-control')
  if (viewControl) {
    viewControl.style.display = settings.hideViewControl === true || settings.hideViewControl === 'true' ? 'none' : ''
  }
  const serviceControl = document.getElementById('service-control')
  if (serviceControl) {
    serviceControl.style.display = settings.hideServiceControl === true || settings.hideServiceControl === 'true' ? 'none' : ''
  }
  const viewButtonMenu = document.getElementById('view-button-menu')
  if (viewButtonMenu) {
    viewButtonMenu.style.display = settings.views?.showViewOptionsAsButtons === true || settings.views?.showViewOptionsAsButtons === 'true' ? '' : 'none'
  }
}

export { initializeMainMenu, applyControlVisibility }
