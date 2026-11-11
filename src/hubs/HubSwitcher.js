// @ts-check
/**
 * Hub switcher pill, dropdown popover, and Hub Manager modal for Viaalink Dashboard.
 * @module hubs/HubSwitcher
 */
import {
  getHubs,
  getActiveHub,
  setActiveHubId,
  upsertHub,
  removeHub,
  probeHubHealth
} from './hubRegistry.js'
import { openModal } from '../component/modal/modalFactory.js'
import { showNotification } from '../component/dialog/notification.js'

/**
 * Map hub status to CSS dot class.
 * @function statusDotClass
 * @param {string|undefined} status
 * @returns {string}
 */
function statusDotClass (status) {
  if (status === 'online') return 'asd-dot ok'
  if (status === 'degraded') return 'asd-dot warn'
  return 'asd-dot err'
}

/**
 * Open the Hub Manager modal to add, edit, probe, or delete workspace hubs.
 * @function openHubManagerModal
 * @returns {void}
 */
export function openHubManagerModal () {
  openModal({
    id: 'hub-manager-modal',
    buildContent: (modal, closeModal) => {
      modal.style.minWidth = 'min(620px, 92vw)'
      const title = document.createElement('h3')
      title.textContent = 'Viaalink Workspace Hubs'
      title.style.margin = '0 0 10px 0'
      modal.appendChild(title)

      const subtitle = document.createElement('p')
      subtitle.textContent = 'Connect and switch between local and remote Viaalink workspace hubs.'
      subtitle.style.margin = '0 0 12px 0'
      subtitle.style.fontSize = '12.5px'
      subtitle.style.color = 'var(--fg-2)'
      modal.appendChild(subtitle)

      const listContainer = document.createElement('div')
      listContainer.dataset.testid = 'hub-manager-list'
      listContainer.style.display = 'flex'
      listContainer.style.flexDirection = 'column'
      listContainer.style.gap = '6px'
      listContainer.style.marginBottom = '14px'
      modal.appendChild(listContainer)

      const formWrap = document.createElement('form')
      formWrap.dataset.testid = 'hub-manager-form'
      formWrap.style.display = 'grid'
      formWrap.style.gridTemplateColumns = '1fr 1.4fr 100px auto'
      formWrap.style.gap = '8px'
      formWrap.style.alignItems = 'center'
      formWrap.style.padding = '10px'
      formWrap.style.background = 'var(--bg-1)'
      formWrap.style.border = '1px solid var(--line)'
      formWrap.style.borderRadius = 'var(--r-2)'

      const nameInput = document.createElement('input')
      nameInput.className = 'asd-input'
      nameInput.placeholder = 'Hub name (e.g. staging-eu)'
      nameInput.dataset.testid = 'hub-input-name'
      nameInput.required = true

      const urlInput = document.createElement('input')
      urlInput.className = 'asd-input'
      urlInput.placeholder = 'https://hub.example.com'
      urlInput.dataset.testid = 'hub-input-url'
      urlInput.required = true

      const envSelect = document.createElement('select')
      envSelect.className = 'asd-input'
      envSelect.dataset.testid = 'hub-input-env'
      ;['local', 'dev', 'staging', 'prod'].forEach(env => {
        const opt = document.createElement('option')
        opt.value = env
        opt.textContent = env
        envSelect.appendChild(opt)
      })
      envSelect.value = 'dev'

      const addBtn = document.createElement('button')
      addBtn.type = 'submit'
      addBtn.className = 'asd-btn primary'
      addBtn.dataset.testid = 'hub-add-submit'
      addBtn.textContent = '+ Add Hub'

      formWrap.append(nameInput, urlInput, envSelect, addBtn)
      modal.appendChild(formWrap)

      const renderRows = () => {
        listContainer.innerHTML = ''
        const hubs = getHubs()
        const active = getActiveHub()
        for (const h of hubs) {
          const row = document.createElement('div')
          row.className = `hub-list-row${h.id === active.id ? ' active' : ''}`
          row.dataset.hubId = h.id
          row.style.border = '1px solid var(--line)'

          const left = document.createElement('div')
          left.className = 'hub-row-main'
          const titleRow = document.createElement('div')
          titleRow.className = 'hub-row-title'
          const dot = document.createElement('span')
          dot.className = statusDotClass(h.status)
          const nameSpan = document.createElement('span')
          nameSpan.textContent = h.name
          const envBadge = document.createElement('span')
          envBadge.className = 'hub-env-badge'
          envBadge.dataset.env = h.env
          envBadge.textContent = h.env
          titleRow.append(dot, nameSpan, envBadge)

          const urlRow = document.createElement('div')
          urlRow.className = 'hub-row-url'
          urlRow.textContent = `${h.url} · ${h.servicesUp ?? 0}/${h.servicesTotal ?? 0} services online`
          left.append(titleRow, urlRow)

          const actions = document.createElement('div')
          actions.style.display = 'inline-flex'
          actions.style.gap = '6px'

          if (h.id !== active.id) {
            const useBtn = document.createElement('button')
            useBtn.type = 'button'
            useBtn.className = 'asd-btn sm'
            useBtn.textContent = 'Activate'
            useBtn.addEventListener('click', () => {
              setActiveHubId(h.id)
              renderRows()
              showNotification(`Switched active hub to "${h.name}"`, 2000, 'success')
            })
            actions.appendChild(useBtn)
          }

          const probeBtn = document.createElement('button')
          probeBtn.type = 'button'
          probeBtn.className = 'asd-btn sm'
          probeBtn.textContent = 'Probe'
          probeBtn.addEventListener('click', () => {
            probeHubHealth(h.id).then(() => renderRows()).catch(() => {})
          })
          actions.appendChild(probeBtn)

          if (h.id !== 'hub-local') {
            const delBtn = document.createElement('button')
            delBtn.type = 'button'
            delBtn.className = 'asd-btn sm danger'
            delBtn.dataset.testid = `hub-delete-${h.id}`
            delBtn.textContent = 'Remove'
            delBtn.addEventListener('click', () => {
              removeHub(h.id)
              renderRows()
            })
            actions.appendChild(delBtn)
          }

          row.append(left, actions)
          listContainer.appendChild(row)
        }
      }

      formWrap.addEventListener('submit', (e) => {
        e.preventDefault()
        const name = nameInput.value.trim()
        const url = urlInput.value.trim()
        if (!name || !url) return
        upsertHub({
          name,
          url,
          env: envSelect.value || 'dev',
          status: 'online'
        })
        nameInput.value = ''
        urlInput.value = ''
        renderRows()
        showNotification(`Added hub "${name}"`, 2000, 'success')
      })

      const footer = document.createElement('div')
      footer.style.display = 'flex'
      footer.style.justifyContent = 'flex-end'
      footer.style.marginTop = '12px'
      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.className = 'asd-btn'
      closeBtn.textContent = 'Close'
      closeBtn.addEventListener('click', closeModal)
      footer.appendChild(closeBtn)
      modal.appendChild(footer)

      renderRows()
    }
  })
}

/**
 * Mount the Hub Switcher pill and popover into #hub-control.
 * @function mountHubSwitcher
 * @returns {{refresh: () => void}|null}
 */
export function mountHubSwitcher () {
  const root = document.getElementById('hub-control')
  if (!root) return null
  root.innerHTML = ''

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hub-switcher-btn'
  btn.dataset.testid = 'hub-switcher'
  btn.setAttribute('aria-haspopup', 'dialog')
  btn.setAttribute('aria-expanded', 'false')

  const popover = document.createElement('div')
  popover.className = 'hub-switcher-popover'
  popover.dataset.testid = 'hub-switcher-popover'

  const closePopover = () => {
    popover.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
  }

  const renderPopover = () => {
    const active = getActiveHub()
    const hubs = getHubs()
    popover.innerHTML = ''
    const header = document.createElement('div')
    header.className = 'hub-popover-header'
    header.innerHTML = `<span>Workspace Hubs (${hubs.length})</span>`
    popover.appendChild(header)

    const list = document.createElement('div')
    list.className = 'hub-list-items'

    for (const h of hubs) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `hub-list-row${h.id === active.id ? ' active' : ''}`
      row.dataset.testid = `hub-option-${h.id}`
      row.addEventListener('click', () => {
        setActiveHubId(h.id)
        closePopover()
        refresh()
      })

      const main = document.createElement('div')
      main.className = 'hub-row-main'

      const titleRow = document.createElement('div')
      titleRow.className = 'hub-row-title'
      const hDot = document.createElement('span')
      hDot.className = statusDotClass(h.status)
      const hName = document.createElement('span')
      hName.textContent = h.name
      const hEnv = document.createElement('span')
      hEnv.className = 'hub-env-badge'
      hEnv.dataset.env = h.env
      hEnv.textContent = h.env
      titleRow.append(hDot, hName, hEnv)

      const urlRow = document.createElement('div')
      urlRow.className = 'hub-row-url'
      urlRow.textContent = h.url
      main.append(titleRow, urlRow)

      const meta = document.createElement('span')
      meta.className = 'asd-mono asd-num'
      meta.style.fontSize = '11px'
      meta.style.color = 'var(--fg-2)'
      meta.textContent = `${h.servicesUp ?? 0}/${h.servicesTotal ?? 0}`

      row.append(main, meta)
      list.appendChild(row)
    }

    popover.appendChild(list)

    const footer = document.createElement('div')
    footer.className = 'hub-popover-footer'
    const manageBtn = document.createElement('button')
    manageBtn.type = 'button'
    manageBtn.className = 'asd-btn sm'
    manageBtn.dataset.testid = 'open-hub-manager'
    manageBtn.textContent = '+ Add / Manage Hubs…'
    manageBtn.addEventListener('click', () => {
      closePopover()
      openHubManagerModal()
    })
    footer.appendChild(manageBtn)
    popover.appendChild(footer)
  }

  const refresh = () => {
    const active = getActiveHub()
    btn.innerHTML = ''

    const dot = document.createElement('span')
    dot.className = statusDotClass(active.status)

    const label = document.createElement('span')
    label.className = 'hub-switcher-name'
    label.textContent = active.name

    const env = document.createElement('span')
    env.className = 'hub-env-badge'
    env.dataset.env = active.env
    env.textContent = active.env

    const count = document.createElement('span')
    count.className = 'asd-mono asd-num'
    count.style.fontSize = '11px'
    count.style.color = 'var(--fg-2)'
    count.textContent = `${active.servicesUp ?? 0}/${active.servicesTotal ?? 0}`

    const caret = document.createElement('span')
    caret.style.fontSize = '10px'
    caret.style.color = 'var(--fg-2)'
    caret.textContent = '▾'

    btn.append(dot, label, env, count, caret)

    if (popover.classList.contains('open')) {
      renderPopover()
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const nextOpen = !popover.classList.contains('open')
    popover.classList.toggle('open', nextOpen)
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
    if (nextOpen) renderPopover()
  })

  document.addEventListener('click', (e) => {
    if (!root.contains(/** @type {Node} */ (e.target))) {
      closePopover()
    }
  })

  document.addEventListener('hubs-changed', refresh)
  document.addEventListener('state-change', (e) => {
    const reason = /** @type {CustomEvent} */ (e).detail?.reason
    if (reason === 'services' || reason === 'config') refresh()
  })

  root.append(btn, popover)
  refresh()
  return { refresh }
}
