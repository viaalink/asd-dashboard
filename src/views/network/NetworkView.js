// @ts-check
/**
 * Interactive Network & Workspace Service Topology view for Viaalink Dashboard.
 * Implements the Claude Design SystemMap & Popouts specification:
 * - Draggable color-coded SVG nodes with right-hand connection handles
 * - Interactive edge drawing, route labels, and route inspection annotations
 * - Sticky notes (seeded + user-created, draggable & editable)
 * - Always-visible right Detail Drawer (MapOverview, NodeDetail 4 tabs, EdgeDetail, NoteDetail)
 * - Popout modals: TtydPopout, WidgetPopout (with minimize pill), and GapAnalysis table
 * @module views/network/NetworkView
 */
import { StorageManager } from '../../storage/StorageManager.js'
import { buildWorkspaceTopology, NODE_FILLS } from './topologyBuilder.js'
import { showServiceModal } from '../../component/modal/serviceLaunchModal.js'
import { addWidget, findServiceLocation } from '../../component/widget/widgetManagement.js'
import { switchBoard } from '../../component/board/boardManagement.js'
import { getCurrentBoardId, getCurrentViewId } from '../../utils/elements.js'
import { resolveServiceConfig, serviceLimitKey } from '../../utils/serviceUtils.js'
import { showNotification } from '../../component/dialog/notification.js'
import { openModal } from '../../component/modal/modalFactory.js'
import { getActiveHub } from '../../hubs/hubRegistry.js'

const HIDDEN_NODES_KEY = 'networkHiddenNodes.v2'
const STICKIES_KEY = 'networkStickies.v2'
const NODE_POS_KEY = 'networkNodePositions.v2'
const CUSTOM_EDGES_KEY = 'networkCustomEdges.v2'
const INJECTED_MITM_KEY = 'networkInjectedMitm.v2'
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Escape a string for safe HTML interpolation.
 * @function escapeHtml
 * @param {any} val
 * @returns {string}
 */
export function escapeHtml (val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Upstream framework gap analysis rows.
 * @constant {Array<{area: string, have: string, need: string, viaYaml: string, ticket: string, where: string}>}
 */
const GAPS = [
  {
    area: 'Services inventory',
    have: 'Local services.json / hub-services.json',
    need: 'via-cli `via services list --json` endpoint (hub-served)',
    viaYaml: 'hub.services.inventory_endpoint',
    ticket: 'via-cli#services-list-json',
    where: 'Selector panel, command palette, system map nodes'
  },
  {
    area: 'Service state (online/offline)',
    have: 'Client-side state[] on each service',
    need: 'via-hub `/state/stream` SSE with per-service health + port liveness',
    viaYaml: 'hub.health.stream_endpoint',
    ticket: 'via-hub#health-sse',
    where: 'Widget offline overlay, runtime panel, node border glow'
  },
  {
    area: 'Service start/stop',
    have: 'ttyd interactive terminal session via CLI fallback URL',
    need: '`via net start --id=<id>` / `via net stop --id=<id>` via ttyd-or-RPC',
    viaYaml: 'cli.rpc.socket',
    ticket: 'via-cli#rpc-socket',
    where: 'Offline start button, runtime stop, node drawer'
  },
  {
    area: 'Caddy live routing',
    have: 'Static caddy config via `via net apply`',
    need: 'caddy-api-client to PATCH `/config/apps/http/servers/srv0/routes` live',
    viaYaml: 'caddy.admin_socket',
    ticket: 'via-hub#caddy-api-proxy',
    where: 'mitmproxy edge insertion, rewrite rules, rate limits'
  },
  {
    area: 'mitmproxy injection',
    have: 'Interactive topology route annotation',
    need: 'via-hub creates mitmproxy tap + rewrites 2 caddy routes atomically',
    viaYaml: 'hub.mitm.enabled, hub.mitm.image',
    ticket: 'via-hub#mitm-inject',
    where: 'SystemMap edge → Annotate mitmproxy flow'
  },
  {
    area: 'ttyd attach to container',
    have: 'ttyd web terminal service (`/asde/terminal`)',
    need: 'ttyd entrypoint accepts `?target=<id>` OR `via shell --attach <id>`',
    viaYaml: 'cli.shell.ttyd_target_param',
    ticket: 'via-cli#shell-attach',
    where: 'Pop out to ttyd button, Node → Shell tab'
  },
  {
    area: 'Container logs',
    have: 'MCP `/asde/mcp/api/logs/:id` endpoint',
    need: 'via-hub `/logs/:id?tail=N&follow=true` (WS or SSE)',
    viaYaml: 'hub.logs.stream_endpoint',
    ticket: 'via-hub#logs-stream',
    where: 'Node → Logs tab'
  }
]

/**
 * Open the Architecture & Gap Analysis modal with filter and Markdown copy support.
 * @function openGapAnalysisModal
 * @returns {void}
 */
export function openGapAnalysisModal () {
  const services = StorageManager.getServices() || []
  const onlineCount = services.filter(s => String(s?.state || 'online').toLowerCase() !== 'offline').length
  const ttydSvc = services.find(s => s?.id === 'ttyd')
  const ttydUp = Boolean(ttydSvc && String(ttydSvc.state || '').toLowerCase() === 'online')

  const buildMarkdown = () => [
    '# Viaalink Workspace Topology & Gap Analysis',
    '',
    `- **Active Hub**: ${getActiveHub().name} (${getActiveHub().url})`,
    `- **Workspace Services**: ${onlineCount}/${services.length} online`,
    `- **Web Terminal (ttyd)**: ${ttydUp ? 'Online (service actions enabled)' : 'Offline (start/stop actions unavailable)'}`,
    '',
    ...GAPS.map(g => `## ${g.area}\n- **have:** ${g.have}\n- **need:** ${g.need}\n- **via.yaml:** \`${g.viaYaml}\`\n- **ticket:** ${g.ticket}\n- **used in:** ${g.where}\n`)
  ].join('\n')

  openModal({
    id: 'network-gap-modal',
    buildContent: (modal, closeModal) => {
      modal.style.width = 'min(980px, 95vw)'
      modal.style.maxHeight = '86vh'
      modal.style.display = 'flex'
      modal.style.flexDirection = 'column'

      const hdr = document.createElement('div')
      hdr.style.display = 'flex'
      hdr.style.alignItems = 'center'
      hdr.style.gap = '10px'
      hdr.style.marginBottom = '10px'

      const h3 = document.createElement('h3')
      h3.textContent = 'Gap Analysis & Framework Tickets'
      h3.style.margin = '0'

      const sub = document.createElement('span')
      sub.style.fontSize = '12px'
      sub.style.color = 'var(--fg-3)'
      sub.textContent = `Active hub: ${getActiveHub().name} · ${onlineCount}/${services.length} services online`

      const spacer = document.createElement('span')
      spacer.style.flex = '1'

      const filterInput = document.createElement('input')
      filterInput.type = 'search'
      filterInput.className = 'asd-input'
      filterInput.placeholder = 'Filter tickets…'
      filterInput.style.width = '180px'

      hdr.append(h3, sub, spacer, filterInput)
      modal.appendChild(hdr)

      const tableWrap = document.createElement('div')
      tableWrap.style.overflow = 'auto'
      tableWrap.style.flex = '1'
      tableWrap.style.border = '1px solid var(--line)'
      tableWrap.style.borderRadius = '8px'
      modal.appendChild(tableWrap)

      const pre = document.createElement('pre')
      pre.className = 'drawer-log-box'
      pre.dataset.testid = 'gap-analysis-markdown'
      pre.style.display = 'none'
      pre.textContent = buildMarkdown()
      modal.appendChild(pre)

      const renderTable = (q = '') => {
        const ql = q.trim().toLowerCase()
        const rows = GAPS.filter(g => !ql || JSON.stringify(g).toLowerCase().includes(ql))
        tableWrap.innerHTML = `
          <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
              <tr style="background:var(--bg-2); text-align:left; color:var(--fg-3); font-size:10px; text-transform:uppercase; letter-spacing:0.08em;">
                <th style="padding:10px 12px;">Area</th>
                <th style="padding:10px 12px;">Have today</th>
                <th style="padding:10px 12px;">Need</th>
                <th style="padding:10px 12px;">via.yaml key</th>
                <th style="padding:10px 12px;">Ticket</th>
                <th style="padding:10px 12px;">Used in</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(g => `
                <tr style="border-top:1px solid var(--line-soft);">
                  <td style="padding:10px 12px; font-weight:600;">${escapeHtml(g.area)}</td>
                  <td style="padding:10px 12px; color:var(--fg-2);">${escapeHtml(g.have)}</td>
                  <td style="padding:10px 12px; color:var(--fg);">${escapeHtml(g.need)}</td>
                  <td style="padding:10px 12px;"><code class="asd-mono" style="color:var(--accent);">${escapeHtml(g.viaYaml)}</code></td>
                  <td style="padding:10px 12px;"><span class="asd-pill">${escapeHtml(g.ticket)}</span></td>
                  <td style="padding:10px 12px; color:var(--fg-2); font-size:11px;">${escapeHtml(g.where)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
      }
      renderTable('')
      filterInput.addEventListener('input', () => renderTable(filterInput.value))

      const bar = document.createElement('div')
      bar.style.display = 'flex'
      bar.style.justifyContent = 'space-between'
      bar.style.alignItems = 'center'
      bar.style.gap = '8px'
      bar.style.marginTop = '12px'

      const footNote = document.createElement('span')
      footNote.className = 'asd-mono'
      footNote.style.fontSize = '11px'
      footNote.style.color = 'var(--fg-3)'
      footNote.textContent = `${GAPS.length} items · runtime target: bun + caddy-api`

      const btnGroup = document.createElement('div')
      btnGroup.style.display = 'flex'
      btnGroup.style.gap = '8px'

      const copyBtn = document.createElement('button')
      copyBtn.type = 'button'
      copyBtn.className = 'asd-btn primary'
      copyBtn.textContent = 'Copy as Markdown'
      copyBtn.addEventListener('click', () => {
        const md = buildMarkdown()
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(md).catch(() => {})
        }
        showNotification('Copied gap analysis Markdown to clipboard', 2000, 'success')
      })

      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.className = 'asd-btn'
      closeBtn.textContent = 'Close'
      closeBtn.addEventListener('click', closeModal)

      btnGroup.append(copyBtn, closeBtn)
      bar.append(footNote, btnGroup)
      modal.appendChild(bar)
    }
  })
}

/**
 * Load hidden node IDs from StorageManager.misc.
 * @function loadHiddenNodeIds
 * @returns {Set<string>}
 */
function loadHiddenNodeIds () {
  const arr = StorageManager.misc.getItem(HIDDEN_NODES_KEY)
  return new Set(Array.isArray(arr) ? arr : [])
}

/**
 * Save hidden node IDs to StorageManager.misc.
 * @function saveHiddenNodeIds
 * @param {Set<string>} set
 * @returns {void}
 */
function saveHiddenNodeIds (set) {
  StorageManager.misc.setItem(HIDDEN_NODES_KEY, Array.from(set))
}

/**
 * Load sticky notes for the network canvas (seeded with default notes if never initialized).
 * @function loadStickyNotes
 * @returns {Array<{id: string, text: string, x: number, y: number}>}
 */
function loadStickyNotes () {
  const raw = StorageManager.misc.getItem(STICKIES_KEY)
  if (Array.isArray(raw)) return raw
  return [
    {
      id: 'seed-note-1',
      text: 'All ingress terminates at Caddy — click any route edge to annotate or inspect.',
      x: 56,
      y: 78
    }
  ]
}

/**
 * Save sticky notes for the network canvas.
 * @function saveStickyNotes
 * @param {Array<{id: string, text: string, x: number, y: number}>} notes
 * @returns {void}
 */
function saveStickyNotes (notes) {
  StorageManager.misc.setItem(STICKIES_KEY, notes)
}

/**
 * Load custom node positions from StorageManager.misc.
 * @function loadNodePositions
 * @returns {Record<string, {x: number, y: number}>}
 */
function loadNodePositions () {
  const raw = StorageManager.misc.getItem(NODE_POS_KEY)
  return raw && typeof raw === 'object' ? raw : {}
}

/**
 * Save custom node positions to StorageManager.misc.
 * @function saveNodePositions
 * @param {Record<string, {x: number, y: number}>} map
 * @returns {void}
 */
function saveNodePositions (map) {
  StorageManager.misc.setItem(NODE_POS_KEY, map)
}

/**
 * Load user-drawn custom edges from StorageManager.misc.
 * @function loadCustomEdges
 * @returns {Array<import('./topologyBuilder.js').TopologyEdge>}
 */
function loadCustomEdges () {
  const raw = StorageManager.misc.getItem(CUSTOM_EDGES_KEY)
  return Array.isArray(raw) ? raw : []
}

/**
 * Save user-drawn custom edges to StorageManager.misc.
 * @function saveCustomEdges
 * @param {Array<import('./topologyBuilder.js').TopologyEdge>} list
 * @returns {void}
 */
function saveCustomEdges (list) {
  StorageManager.misc.setItem(CUSTOM_EDGES_KEY, list)
}

/**
 * Load route mitmproxy annotations from StorageManager.misc.
 * @function loadInjectedMitm
 * @returns {Array<{edgeId: string, mitmId: string, from: string, to: string, label: string, x: number, y: number}>}
 */
function loadInjectedMitm () {
  const raw = StorageManager.misc.getItem(INJECTED_MITM_KEY)
  return Array.isArray(raw) ? raw : []
}

/**
 * Save route mitmproxy annotations to StorageManager.misc.
 * @function saveInjectedMitm
 * @param {Array<{edgeId: string, mitmId: string, from: string, to: string, label: string, x: number, y: number}>} list
 * @returns {void}
 */
function saveInjectedMitm (list) {
  StorageManager.misc.setItem(INJECTED_MITM_KEY, list)
}

/**
 * Mount the interactive Network View into #network-surface.
 * @function mountNetworkView
 * @param {{onSwitchToBoards?: () => void}} [opts]
 * @returns {{refresh: () => void, focusNode: (id: string) => void}|null}
 */
export function mountNetworkView (opts = {}) {
  const root = document.getElementById('network-surface')
  if (!root) return null
  root.innerHTML = ''

  const NODE_W = 190
  const NODE_H = 74

  const state = {
    tool: /** @type {'select'|'note'|'edge'} */ ('select'),
    filter: /** @type {'all'|'online'|'offline'|'tunnel'} */ ('all'),
    search: '',
    selectedNodeId: /** @type {string|null} */ (null),
    selectedEdgeId: /** @type {string|null} */ (null),
    selectedNoteId: /** @type {string|null} */ (null),
    activeTab: /** @type {'info'|'logs'|'shell'|'network'} */ ('info'),
    zoom: 1,
    panX: 0,
    panY: 0,
    showStickies: true,
    logAbort: /** @type {AbortController|null} */ (null),
    edgeLabelOverrides: /** @type {Record<string, string>} */ ({})
  }

  // Toolbar
  const toolbar = document.createElement('div')
  toolbar.className = 'network-toolbar'

  const toolModeGroup = document.createElement('div')
  toolModeGroup.className = 'network-toolbar-group'

  const statsGroup = document.createElement('div')
  statsGroup.className = 'network-toolbar-group'
  statsGroup.dataset.testid = 'network-stats'

  const filterGroup = document.createElement('div')
  filterGroup.className = 'network-toolbar-group'

  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.className = 'asd-input'
  searchInput.style.width = '180px'
  searchInput.placeholder = 'Filter topology nodes…'
  searchInput.dataset.testid = 'network-search'

  const spacer = document.createElement('div')
  spacer.className = 'network-toolbar-spacer'

  const actionsGroup = document.createElement('div')
  actionsGroup.className = 'network-toolbar-group'

  toolbar.append(toolModeGroup, statsGroup, filterGroup, searchInput, spacer, actionsGroup)

  // Body (Canvas + Always-Visible Right Detail Drawer)
  const body = document.createElement('div')
  body.className = 'network-body'

  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'network-canvas-wrap'
  canvasWrap.dataset.testid = 'network-canvas'

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'network-svg')
  svg.setAttribute('viewBox', '0 0 980 540')

  const stickyLayer = document.createElement('div')
  stickyLayer.className = 'network-sticky-layer'
  stickyLayer.dataset.testid = 'network-sticky-layer'

  // Floating hint pill (top-right of canvas)
  const hintPill = document.createElement('div')
  hintPill.className = 'network-hint-pill'

  // Bottom-left Map Legend
  const legendBox = document.createElement('div')
  legendBox.className = 'network-legend-box'
  const legendKinds = ['client', 'proxy', 'hub', 'app', 'studio', 'api', 'db', 'mail', 'terminal', 'mitm']
  legendBox.innerHTML = legendKinds.map(k => `
    <span class="network-legend-item">
      <span class="network-legend-swatch" style="background:${NODE_FILLS[k] || 'var(--bg-3)'}"></span>
      <span>${escapeHtml(k)}</span>
    </span>
  `).join('')

  // Bottom-right Stack Summary
  const stackBox = document.createElement('div')
  stackBox.className = 'network-stack-box'

  // Minimized Widget Popout Dock
  const popoutDock = document.createElement('div')
  popoutDock.className = 'network-popout-dock'

  canvasWrap.append(svg, stickyLayer, hintPill, legendBox, stackBox, popoutDock)

  const drawer = document.createElement('aside')
  drawer.className = 'network-detail-drawer open'
  drawer.dataset.testid = 'network-detail-drawer'

  body.append(canvasWrap, drawer)
  root.append(toolbar, body)

  // Coordinate helpers
  const screenToWorld = (/** @type {number} */ sx, /** @type {number} */ sy) => {
    const rect = svg.getBoundingClientRect()
    return {
      x: (sx - rect.left - state.panX) / state.zoom,
      y: (sy - rect.top - state.panY) / state.zoom
    }
  }

  // Interactive Pan / Node Drag / Sticky Drag / Edge Draft
  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  /** @type {{id: string, type: 'node'|'note', dx: number, dy: number, moved: boolean}|null} */
  let dragTarget = null
  /** @type {{fromId: string, x1: number, y1: number, x2: number, y2: number}|null} */
  let edgeDraft = null

  canvasWrap.addEventListener('mousedown', (e) => {
    const tgt = /** @type {Element} */ (e.target)
    if (tgt.closest('.net-node-handle') || tgt.closest('.net-node-group') || tgt.closest('.net-edge-group') || tgt.closest('.network-sticky-card') || tgt.closest('button')) {
      return
    }
    if (e.button === 0 && state.tool === 'note') {
      const w = screenToWorld(e.clientX, e.clientY)
      const notes = loadStickyNotes()
      const newNote = {
        id: `note-${Date.now().toString(36)}`,
        text: 'New architecture note — click to edit in drawer.',
        x: Math.max(16, Math.round(w.x)),
        y: Math.max(16, Math.round(w.y))
      }
      notes.push(newNote)
      saveStickyNotes(notes)
      state.tool = 'select'
      state.selectedNodeId = null
      state.selectedEdgeId = null
      state.selectedNoteId = newNote.id
      refresh()
      return
    }
    isPanning = true
    panStartX = e.clientX - state.panX
    panStartY = e.clientY - state.panY
    canvasWrap.classList.add('panning')
  })

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const delta = -e.deltaY * 0.0015
    const nextZoom = Math.max(0.35, Math.min(2.2, state.zoom * (1 + delta)))
    const wx = (mx - state.panX) / state.zoom
    const wy = (my - state.panY) / state.zoom
    state.zoom = nextZoom
    state.panX = Math.round(mx - wx * nextZoom)
    state.panY = Math.round(my - wy * nextZoom)
    updateViewportTransform()
  }, { passive: false })

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      state.panX = e.clientX - panStartX
      state.panY = e.clientY - panStartY
      updateViewportTransform()
    } else if (dragTarget) {
      const w = screenToWorld(e.clientX, e.clientY)
      const nx = Math.round(w.x - dragTarget.dx)
      const ny = Math.round(w.y - dragTarget.dy)
      dragTarget.moved = true
      if (dragTarget.type === 'node') {
        const posMap = loadNodePositions()
        posMap[dragTarget.id] = { x: nx, y: ny }
        saveNodePositions(posMap)
        refreshCanvasOnly()
      } else if (dragTarget.type === 'note') {
        const notes = loadStickyNotes().map(n => n.id === dragTarget?.id ? { ...n, x: Math.max(8, nx), y: Math.max(8, ny) } : n)
        saveStickyNotes(notes)
        renderStickies()
      }
    } else if (edgeDraft) {
      const w = screenToWorld(e.clientX, e.clientY)
      edgeDraft.x2 = w.x
      edgeDraft.y2 = w.y
      const draftLine = svg.querySelector('#net-edge-draft')
      if (draftLine) {
        draftLine.setAttribute('x2', String(edgeDraft.x2))
        draftLine.setAttribute('y2', String(edgeDraft.y2))
      }
    }
  })

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false
      canvasWrap.classList.remove('panning')
    }
    if (dragTarget) {
      dragTarget = null
    }
    if (edgeDraft) {
      edgeDraft = null
      svg.querySelector('#net-edge-draft')?.remove()
    }
  })

  /**
   * Update the SVG viewport group transform for pan/zoom.
   * @returns {void}
   */
  function updateViewportTransform () {
    const vp = svg.querySelector('#net-viewport')
    if (vp) {
      vp.setAttribute('transform', `translate(${state.panX}, ${state.panY}) scale(${state.zoom})`)
    }
    canvasWrap.style.backgroundSize = `${Math.max(10, Math.round(24 * state.zoom))}px ${Math.max(10, Math.round(24 * state.zoom))}px`
    canvasWrap.style.backgroundPosition = `${state.panX}px ${state.panY}px`
    const zoomLbl = toolbar.querySelector('[data-testid="network-zoom-reset"]')
    if (zoomLbl) zoomLbl.textContent = `${Math.round(state.zoom * 100)}%`
  }

  /**
   * Build the full graph including custom positions, custom edges, and annotated mitmproxy nodes.
   * @returns {{nodes: import('./topologyBuilder.js').TopologyNode[], edges: import('./topologyBuilder.js').TopologyEdge[], ttydOnline: boolean}}
   */
  function getFullGraph () {
    const rawServices = StorageManager.getServices() || []
    const hiddenIds = loadHiddenNodeIds()
    const posMap = loadNodePositions()
    const base = buildWorkspaceTopology(rawServices, hiddenIds, posMap)

    // Apply custom edges
    const customEdges = loadCustomEdges().filter(ce => !hiddenIds.has(ce.from) && !hiddenIds.has(ce.to))
    for (const ce of customEdges) {
      if (!base.edges.some(e => e.id === ce.id)) {
        base.edges.push(ce)
      }
    }

    // Apply edge label overrides
    for (const e of base.edges) {
      if (state.edgeLabelOverrides[e.id] !== undefined) {
        e.label = state.edgeLabelOverrides[e.id]
      }
    }

    // Apply route mitmproxy annotations
    const taps = loadInjectedMitm()
    for (const tap of taps) {
      if (hiddenIds.has(tap.mitmId)) continue
      const origIdx = base.edges.findIndex(e => e.id === tap.edgeId)
      if (origIdx === -1) continue
      const origEdge = base.edges[origIdx]
      const savedPos = posMap[tap.mitmId] || { x: tap.x, y: tap.y }
      base.nodes.push({
        id: tap.mitmId,
        label: 'mitmproxy',
        sublabel: 'route annotation',
        kind: 'mitm',
        state: 'online',
        x: savedPos.x,
        y: savedPos.y,
        url: '',
        port: null,
        fallback: null,
        isTtyd: false,
        isSynthetic: true,
        flowing: true
      })
      base.edges.splice(
        origIdx,
        1,
        {
          id: `${tap.mitmId}-in`,
          from: origEdge.from,
          to: tap.mitmId,
          label: origEdge.label || '→',
          status: 'live',
          protocol: origEdge.protocol,
          flowing: true
        },
        {
          id: `${tap.mitmId}-out`,
          from: tap.mitmId,
          to: origEdge.to,
          label: 'annotated',
          status: 'live',
          protocol: origEdge.protocol,
          flowing: true
        }
      )
    }

    return base
  }

  /**
   * Annotate a mitmproxy node on an existing edge in the local topology diagram.
   * @param {import('./topologyBuilder.js').TopologyEdge} edge
   * @param {{nodes: import('./topologyBuilder.js').TopologyNode[]}} graph
   * @returns {void}
   */
  function insertMitmOnEdge (edge, graph) {
    const a = graph.nodes.find(n => n.id === edge.from)
    const b = graph.nodes.find(n => n.id === edge.to)
    if (!a || !b) return
    const mx = Math.round((a.x + NODE_W + b.x) / 2 - NODE_W / 2)
    const my = Math.round((a.y + b.y) / 2)
    const mitmId = `mitm-${Date.now().toString(36)}`
    const taps = loadInjectedMitm()
    taps.push({
      edgeId: edge.id,
      mitmId,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      x: mx,
      y: my
    })
    saveInjectedMitm(taps)
    state.selectedEdgeId = null
    state.selectedNodeId = mitmId
    refresh()
    showNotification(`Added mitmproxy topology annotation on ${a.label} → ${b.label}`, 2400, 'success')
  }

  /**
   * Open the Edit Edge / Annotate mitmproxy modal.
   * @param {import('./topologyBuilder.js').TopologyEdge} edge
   * @param {{nodes: import('./topologyBuilder.js').TopologyNode[]}} graph
   * @returns {void}
   */
  function openMitmEdgeModal (edge, graph) {
    const a = graph.nodes.find(n => n.id === edge.from)
    const b = graph.nodes.find(n => n.id === edge.to)
    openModal({
      id: 'network-mitm-modal',
      buildContent: (modal, closeModal) => {
        modal.style.width = 'min(480px, 94vw)'
        const hdr = document.createElement('div')
        hdr.style.display = 'flex'
        hdr.style.alignItems = 'center'
        hdr.style.gap = '10px'
        hdr.style.marginBottom = '12px'
        hdr.innerHTML = `
          <b style="font-size:14px;">Inspect / Annotate Route Edge</b>
          <span class="asd-mono" style="font-size:12px; color:var(--fg-3);">${escapeHtml(a?.label || edge.from)} → ${escapeHtml(b?.label || edge.to)}</span>
        `
        modal.appendChild(hdr)

        const lblRow = document.createElement('div')
        lblRow.style.display = 'flex'
        lblRow.style.alignItems = 'center'
        lblRow.style.gap = '10px'
        lblRow.style.marginBottom = '12px'
        const lblSpan = document.createElement('span')
        lblSpan.style.fontSize = '12px'
        lblSpan.style.color = 'var(--fg-2)'
        lblSpan.style.width = '60px'
        lblSpan.textContent = 'Label'
        const lblInput = document.createElement('input')
        lblInput.className = 'asd-input'
        lblInput.style.flex = '1'
        lblInput.value = edge.label || ''
        lblInput.addEventListener('change', () => {
          state.edgeLabelOverrides[edge.id] = lblInput.value
          refresh()
        })
        lblRow.append(lblSpan, lblInput)
        modal.appendChild(lblRow)

        const diagram = document.createElement('div')
        diagram.style.display = 'grid'
        diagram.style.gridTemplateColumns = '1fr auto 1fr'
        diagram.style.alignItems = 'center'
        diagram.style.gap = '10px'
        diagram.style.padding = '12px'
        diagram.style.background = 'var(--bg-2)'
        diagram.style.border = '1px dashed var(--line)'
        diagram.style.borderRadius = '8px'
        diagram.style.marginBottom = '12px'
        diagram.innerHTML = `
          <div class="asd-mono" style="font-size:12px; text-align:center; padding:8px; background:var(--bg-3); border-radius:6px;">${escapeHtml(a?.label || edge.from)}</div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span class="asd-pill" style="color:var(--accent); border-color:var(--accent);">
              <span class="asd-dot" style="background:var(--accent);"></span>
              <span class="asd-mono">mitmproxy</span>
            </span>
            <span style="font-size:10px; color:var(--fg-3);">topology annotation</span>
          </div>
          <div class="asd-mono" style="font-size:12px; text-align:center; padding:8px; background:var(--bg-3); border-radius:6px;">${escapeHtml(b?.label || edge.to)}</div>
        `
        modal.appendChild(diagram)

        const cmdPre = document.createElement('pre')
        cmdPre.className = 'drawer-log-box'
        cmdPre.style.minHeight = 'auto'
        cmdPre.style.marginBottom = '14px'
        cmdPre.textContent = `Route: ${a?.id || edge.from} -> ${b?.id || edge.to} (${edge.protocol})\nNote: Places a visual mitmproxy inspection node on the topology map.`
        modal.appendChild(cmdPre)

        const foot = document.createElement('div')
        foot.style.display = 'flex'
        foot.style.justifyContent = 'flex-end'
        foot.style.gap = '8px'

        const cancelBtn = document.createElement('button')
        cancelBtn.type = 'button'
        cancelBtn.className = 'asd-btn'
        cancelBtn.textContent = 'Cancel'
        cancelBtn.addEventListener('click', closeModal)

        const injectBtn = document.createElement('button')
        injectBtn.type = 'button'
        injectBtn.className = 'asd-btn primary'
        injectBtn.dataset.testid = 'confirm-insert-mitm'
        injectBtn.textContent = 'Insert mitmproxy'
        injectBtn.addEventListener('click', () => {
          closeModal()
          insertMitmOnEdge(edge, graph)
        })

        foot.append(cancelBtn, injectBtn)
        modal.appendChild(foot)
      }
    })
  }

  /**
   * Open the TtydPopout terminal modal.
   * @param {import('./topologyBuilder.js').TopologyNode} node
   * @param {boolean} ttydOnline
   * @param {string} ttydUrl
   * @returns {void}
   */
  function openTtydPopoutModal (node, ttydOnline, ttydUrl) {
    openModal({
      id: 'network-ttyd-popout-modal',
      buildContent: (modal, closeModal) => {
        modal.style.width = 'min(880px, 95vw)'
        const hdr = document.createElement('div')
        hdr.style.display = 'flex'
        hdr.style.alignItems = 'center'
        hdr.style.gap = '10px'
        hdr.style.marginBottom = '10px'
        hdr.innerHTML = `
          <b style="font-size:14px;">ttyd · ${escapeHtml(node.label)}</b>
          <span class="asd-mono" style="font-size:11px; color:var(--fg-3);">service=${escapeHtml(node.id)}</span>
          <span class="asd-pill ${ttydOnline ? 'ok' : 'err'}"><span class="asd-dot ${ttydOnline ? 'ok' : 'err'}"></span>${ttydOnline ? 'connected' : 'offline'}</span>
          <span style="flex:1;"></span>
        `
        const closeBtn = document.createElement('button')
        closeBtn.type = 'button'
        closeBtn.className = 'asd-btn ghost sm'
        closeBtn.textContent = '✕'
        closeBtn.addEventListener('click', closeModal)
        hdr.appendChild(closeBtn)
        modal.appendChild(hdr)

        if (!ttydOnline) {
          const offlineNotice = document.createElement('div')
          offlineNotice.className = 'ttyd-offline-banner'
          offlineNotice.innerHTML = '<strong>Web Terminal (ttyd) is offline</strong><span>Start the workspace ttyd service to open an interactive terminal session.</span>'
          modal.appendChild(offlineNotice)
          return
        }

        const iframe = document.createElement('iframe')
        iframe.src = ttydUrl || '/asde/terminal/'
        iframe.style.width = '100%'
        iframe.style.height = '420px'
        iframe.style.border = '1px solid var(--line)'
        iframe.style.borderRadius = '8px'
        iframe.style.background = '#05070a'
        modal.appendChild(iframe)
      }
    })
  }

  /**
   * Open the WidgetPopout modal with Minimize-to-dock support.
   * @param {import('./topologyBuilder.js').TopologyNode} node
   * @returns {void}
   */
  function openWidgetPopoutModal (node) {
    openModal({
      id: 'network-widget-popout-modal',
      buildContent: (modal, closeModal) => {
        modal.style.width = 'min(960px, 95vw)'
        const hdr = document.createElement('div')
        hdr.style.display = 'flex'
        hdr.style.alignItems = 'center'
        hdr.style.gap = '10px'
        hdr.style.marginBottom = '10px'

        const title = document.createElement('b')
        title.textContent = `${node.label} (${node.kind})`
        const meta = document.createElement('span')
        meta.className = 'asd-mono'
        meta.style.fontSize = '11px'
        meta.style.color = 'var(--fg-3)'
        meta.textContent = `${node.id} · ${node.sublabel}`

        const sp = document.createElement('span')
        sp.style.flex = '1'

        const minBtn = document.createElement('button')
        minBtn.type = 'button'
        minBtn.className = 'asd-btn sm'
        minBtn.textContent = '— Minimize'
        minBtn.addEventListener('click', () => {
          closeModal()
          renderMinimizedPill(node)
        })

        const closeBtn = document.createElement('button')
        closeBtn.type = 'button'
        closeBtn.className = 'asd-btn ghost sm'
        closeBtn.textContent = '✕'
        closeBtn.addEventListener('click', closeModal)

        hdr.append(title, meta, sp, minBtn, closeBtn)
        modal.appendChild(hdr)

        const frameWrap = document.createElement('div')
        frameWrap.style.height = '440px'
        frameWrap.style.border = '1px solid var(--line)'
        frameWrap.style.borderRadius = '8px'
        frameWrap.style.overflow = 'hidden'
        frameWrap.style.background = 'var(--bg-1)'

        if (node.url && node.state === 'online') {
          const iframe = document.createElement('iframe')
          iframe.src = node.url
          iframe.style.width = '100%'
          iframe.style.height = '100%'
          iframe.style.border = 'none'
          frameWrap.appendChild(iframe)
        } else {
          frameWrap.innerHTML = `
            <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--fg-2);">
              <div class="asd-mono" style="font-size:12px; color:var(--fg-3);">${escapeHtml(node.state.toUpperCase())} PREVIEW</div>
              <div style="font-size:16px; font-weight:600; color:var(--fg);">${escapeHtml(node.label)}</div>
              <code class="asd-mono" style="padding:4px 10px; background:var(--bg-2); border-radius:6px;">${escapeHtml(node.url || node.sublabel)}</code>
            </div>
          `
        }
        modal.appendChild(frameWrap)
      }
    })
  }

  /**
   * Render a minimized widget pill in the bottom-right dock.
   * @param {import('./topologyBuilder.js').TopologyNode} node
   * @returns {void}
   */
  function renderMinimizedPill (node) {
    popoutDock.innerHTML = ''
    const pill = document.createElement('div')
    pill.className = 'network-minimized-pill'
    pill.innerHTML = `
      <span class="asd-dot ok"></span>
      <b>${escapeHtml(node.label)}</b>
      <span class="asd-mono" style="font-size:11px; color:var(--fg-3);">minimized</span>
    `
    const restoreBtn = document.createElement('button')
    restoreBtn.type = 'button'
    restoreBtn.className = 'asd-btn ghost sm'
    restoreBtn.textContent = '⤢ Restore'
    restoreBtn.addEventListener('click', () => {
      popoutDock.innerHTML = ''
      openWidgetPopoutModal(node)
    })
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'asd-btn ghost sm'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => {
      popoutDock.innerHTML = ''
    })
    pill.append(restoreBtn, closeBtn)
    popoutDock.appendChild(pill)
  }

  /**
   * Render sticky notes overlay.
   * @returns {void}
   */
  function renderStickies () {
    stickyLayer.innerHTML = ''
    if (!state.showStickies) return
    const notes = loadStickyNotes()
    for (const note of notes) {
      const card = document.createElement('div')
      card.className = `network-sticky-card${state.selectedNoteId === note.id ? ' selected' : ''}`
      card.dataset.testid = `sticky-note-${note.id}`
      card.style.left = `${note.x}px`
      card.style.top = `${note.y}px`

      card.addEventListener('mousedown', (e) => {
        if (/** @type {Element} */ (e.target).closest('button')) return
        e.stopPropagation()
        const w = screenToWorld(e.clientX, e.clientY)
        dragTarget = {
          id: note.id,
          type: 'note',
          dx: w.x - note.x,
          dy: w.y - note.y,
          moved: false
        }
        state.selectedNodeId = null
        state.selectedEdgeId = null
        state.selectedNoteId = note.id
        renderDrawer(getFullGraph())
      })

      const hdr = document.createElement('div')
      hdr.className = 'network-sticky-header'
      const title = document.createElement('span')
      title.textContent = 'NOTE'
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'asd-btn ghost sm'
      del.style.height = '18px'
      del.style.padding = '0 4px'
      del.textContent = '✕'
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        const next = loadStickyNotes().filter(n => n.id !== note.id)
        saveStickyNotes(next)
        if (state.selectedNoteId === note.id) state.selectedNoteId = null
        renderStickies()
        renderDrawer(getFullGraph())
      })
      hdr.append(title, del)

      const bodyEl = document.createElement('div')
      bodyEl.textContent = note.text
      card.append(hdr, bodyEl)
      stickyLayer.appendChild(card)
    }
  }

  /**
   * Render the always-visible right-hand detail drawer (MapOverview, NodeDetail, EdgeDetail, or NoteDetail).
   * @param {{nodes: import('./topologyBuilder.js').TopologyNode[], edges: import('./topologyBuilder.js').TopologyEdge[], ttydOnline: boolean}} graph
   * @returns {void}
   */
  function renderDrawer (graph) {
    if (state.logAbort) {
      state.logAbort.abort()
      state.logAbort = null
    }
    drawer.classList.add('open')
    drawer.innerHTML = ''

    const selectedNode = state.selectedNodeId
      ? (graph.nodes.find(n => n.id === state.selectedNodeId) || null)
      : null
    const selectedEdge = !selectedNode && state.selectedEdgeId
      ? (graph.edges.find(e => e.id === state.selectedEdgeId) || null)
      : null
    const selectedNote = !selectedNode && !selectedEdge && state.selectedNoteId
      ? (loadStickyNotes().find(n => n.id === state.selectedNoteId) || null)
      : null

    // CASE 1: Note selected -> NoteDetail
    if (selectedNote) {
      const header = document.createElement('div')
      header.className = 'drawer-header'
      header.innerHTML = `
        <div class="drawer-title-group">
          <div class="drawer-title-row">
            <span data-testid="drawer-node-title">Sticky Note</span>
            <span class="asd-pill">note</span>
          </div>
          <div class="drawer-subtitle">Canvas Annotation</div>
        </div>
      `
      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.className = 'asd-btn ghost sm'
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', () => {
        state.selectedNoteId = null
        renderDrawer(graph)
      })
      header.appendChild(closeBtn)
      drawer.appendChild(header)

      const content = document.createElement('div')
      content.className = 'drawer-content'
      const ta = document.createElement('textarea')
      ta.className = 'asd-input'
      ta.style.width = '100%'
      ta.style.minHeight = '160px'
      ta.style.padding = '10px'
      ta.style.lineHeight = '1.45'
      ta.value = selectedNote.text
      ta.addEventListener('input', () => {
        const updated = loadStickyNotes().map(n => n.id === selectedNote.id ? { ...n, text: ta.value } : n)
        saveStickyNotes(updated)
        renderStickies()
      })
      content.appendChild(ta)
      drawer.appendChild(content)
      return
    }

    // CASE 2: Edge selected -> EdgeDetail
    if (selectedEdge) {
      const a = graph.nodes.find(n => n.id === selectedEdge.from)
      const b = graph.nodes.find(n => n.id === selectedEdge.to)
      const header = document.createElement('div')
      header.className = 'drawer-header'
      header.innerHTML = `
        <div class="drawer-title-group">
          <div class="drawer-title-row">
            <span data-testid="drawer-node-title">${escapeHtml(a?.label || selectedEdge.from)} → ${escapeHtml(b?.label || selectedEdge.to)}</span>
            <span class="asd-pill">edge</span>
          </div>
          <div class="drawer-subtitle">${escapeHtml(selectedEdge.protocol)} · ${selectedEdge.flowing ? 'mitmproxy annotated' : 'direct route'}</div>
        </div>
      `
      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.className = 'asd-btn ghost sm'
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', () => {
        state.selectedEdgeId = null
        renderDrawer(graph)
      })
      header.appendChild(closeBtn)
      drawer.appendChild(header)

      const content = document.createElement('div')
      content.className = 'drawer-content'

      const kv = document.createElement('div')
      kv.className = 'drawer-kv-grid'
      kv.innerHTML = `
        <div class="drawer-kv-label">From</div>
        <div class="drawer-kv-val">${escapeHtml(a?.label || selectedEdge.from)}</div>
        <div class="drawer-kv-label">To</div>
        <div class="drawer-kv-val">${escapeHtml(b?.label || selectedEdge.to)}</div>
        <div class="drawer-kv-label">Protocol</div>
        <div class="drawer-kv-val">${escapeHtml(selectedEdge.protocol)}</div>
        <div class="drawer-kv-label">Flowing</div>
        <div class="drawer-kv-val">${selectedEdge.flowing ? 'annotated (mitmproxy)' : 'standard'}</div>
      `
      content.appendChild(kv)

      const lblWrap = document.createElement('div')
      lblWrap.style.display = 'flex'
      lblWrap.style.flexDirection = 'column'
      lblWrap.style.gap = '4px'
      const lblTitle = document.createElement('span')
      lblTitle.className = 'drawer-kv-label'
      lblTitle.textContent = 'Route Label'
      const lblInput = document.createElement('input')
      lblInput.className = 'asd-input asd-mono'
      lblInput.value = selectedEdge.label || ''
      lblInput.addEventListener('change', () => {
        state.edgeLabelOverrides[selectedEdge.id] = lblInput.value
        refresh()
      })
      lblWrap.append(lblTitle, lblInput)
      content.appendChild(lblWrap)

      const actions = document.createElement('div')
      actions.className = 'drawer-actions-stack'

      const mitmBtn = document.createElement('button')
      mitmBtn.type = 'button'
      mitmBtn.className = 'asd-btn primary'
      mitmBtn.dataset.testid = 'edge-insert-mitm'
      mitmBtn.textContent = '⟿ Annotate mitmproxy on Route'
      mitmBtn.addEventListener('click', () => insertMitmOnEdge(selectedEdge, graph))

      const modalBtn = document.createElement('button')
      modalBtn.type = 'button'
      modalBtn.className = 'asd-btn'
      modalBtn.textContent = 'Configure Route Annotation…'
      modalBtn.addEventListener('click', () => openMitmEdgeModal(selectedEdge, graph))

      const delEdgeBtn = document.createElement('button')
      delEdgeBtn.type = 'button'
      delEdgeBtn.className = 'asd-btn danger'
      delEdgeBtn.textContent = 'Remove Edge from Map'
      delEdgeBtn.addEventListener('click', () => {
        const custom = loadCustomEdges().filter(e => e.id !== selectedEdge.id)
        saveCustomEdges(custom)
        state.selectedEdgeId = null
        refresh()
        showNotification('Edge removed from map view', 1800, 'success')
      })

      actions.append(mitmBtn, modalBtn, delEdgeBtn)
      content.appendChild(actions)
      drawer.appendChild(content)
      return
    }

    // CASE 3: Nothing selected -> MapOverview
    if (!selectedNode) {
      const activeHub = getActiveHub()
      const header = document.createElement('div')
      header.className = 'drawer-header'
      header.innerHTML = `
        <div class="drawer-title-group">
          <div class="drawer-title-row">
            <span data-testid="drawer-node-title">Network Topology</span>
            <span class="asd-pill ok">live</span>
          </div>
          <div class="drawer-subtitle">Hub: ${escapeHtml(activeHub.name)}</div>
        </div>
      `
      drawer.appendChild(header)

      const content = document.createElement('div')
      content.className = 'drawer-content'
      const onlineCount = graph.nodes.filter(n => !n.isSynthetic && n.state === 'online').length
      const totalCount = graph.nodes.filter(n => !n.isSynthetic).length

      const guide = document.createElement('div')
      guide.style.fontSize = '12.5px'
      guide.style.color = 'var(--fg-2)'
      guide.style.lineHeight = '1.55'
      guide.innerHTML = `
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.12em; color:var(--fg-3); margin-bottom:6px;">Interactive Guide</div>
        <p style="margin:0 0 8px;">• Click any <b>service node</b> for metadata, live logs, interactive shell, and widget popout.</p>
        <p style="margin:0 0 8px;">• Drag any <b>node</b> to rearrange the topology layout.</p>
        <p style="margin:0 0 8px;">• Drag from a node's <b>right blue dot</b> to another node to connect two systems.</p>
        <p style="margin:0;">• Click any <b>route edge</b> to inspect or annotate <code class="asd-mono" style="color:var(--accent);">mitmproxy</code>.</p>
      `
      content.appendChild(guide)

      const rtBox = document.createElement('div')
      rtBox.style.paddingTop = '10px'
      rtBox.style.borderTop = '1px solid var(--line-soft)'
      rtBox.innerHTML = `
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.12em; color:var(--fg-3); margin-bottom:8px;">Workspace Runtime</div>
        <div class="drawer-kv-grid">
          <div class="drawer-kv-label">Runtime</div>
          <div class="drawer-kv-val" style="color:var(--ok);">bun · caddy-api</div>
          <div class="drawer-kv-label">Active Hub</div>
          <div class="drawer-kv-val">${escapeHtml(activeHub.id)}</div>
          <div class="drawer-kv-label">Web Terminal</div>
          <div class="drawer-kv-val" style="color:${graph.ttydOnline ? 'var(--ok)' : 'var(--err)'};">ttyd (${graph.ttydOnline ? 'online' : 'offline'})</div>
          <div class="drawer-kv-label">Services</div>
          <div class="drawer-kv-val">${onlineCount} / ${totalCount} online</div>
          <div class="drawer-kv-label">Routes</div>
          <div class="drawer-kv-val">${graph.edges.length} active edges</div>
        </div>
      `
      content.appendChild(rtBox)

      const gapBtn = document.createElement('button')
      gapBtn.type = 'button'
      gapBtn.className = 'asd-btn'
      gapBtn.style.width = '100%'
      gapBtn.style.justifyContent = 'center'
      gapBtn.innerHTML = '<span style="color:var(--warn);">▲</span><span>Gap analysis &amp; framework tickets</span>'
      gapBtn.addEventListener('click', openGapAnalysisModal)
      content.appendChild(gapBtn)

      drawer.appendChild(content)
      return
    }

    // CASE 4: Node selected -> NodeDetail (4 tabs: Info, Logs, Shell, Network)
    const node = selectedNode
    const header = document.createElement('div')
    header.className = 'drawer-header'

    const titleGroup = document.createElement('div')
    titleGroup.className = 'drawer-title-group'

    const titleRow = document.createElement('div')
    titleRow.className = 'drawer-title-row'
    const dot = document.createElement('span')
    dot.className = node.state === 'online' ? 'asd-dot ok' : 'asd-dot err'
    const nameEl = document.createElement('span')
    nameEl.dataset.testid = 'drawer-node-title'
    nameEl.textContent = node.label
    const pill = document.createElement('span')
    pill.className = `asd-pill ${node.state === 'online' ? 'ok' : 'err'}`
    pill.textContent = node.state
    titleRow.append(dot, nameEl, pill)

    const sub = document.createElement('div')
    sub.className = 'drawer-subtitle'
    sub.textContent = `${node.kind.toUpperCase()} · ${node.sublabel}`
    titleGroup.append(titleRow, sub)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'asd-btn ghost sm'
    closeBtn.dataset.testid = 'drawer-close-btn'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => {
      state.selectedNodeId = null
      refresh()
    })

    header.append(titleGroup, closeBtn)
    drawer.appendChild(header)

    // Tabs
    const tabsBar = document.createElement('div')
    tabsBar.className = 'drawer-tabs'
    /** @type {Array<{id: 'info'|'logs'|'shell'|'network', label: string}>} */
    const tabs = [
      { id: 'info', label: 'Info' },
      { id: 'logs', label: 'Logs' },
      { id: 'shell', label: 'Shell' },
      { id: 'network', label: 'Network' }
    ]
    for (const t of tabs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `drawer-tab-btn${state.activeTab === t.id ? ' active' : ''}`
      btn.dataset.testid = `drawer-tab-${t.id}`
      btn.textContent = t.label
      btn.addEventListener('click', () => {
        state.activeTab = t.id
        renderDrawer(graph)
      })
      tabsBar.appendChild(btn)
    }
    drawer.appendChild(tabsBar)

    const content = document.createElement('div')
    content.className = 'drawer-content'
    drawer.appendChild(content)

    if (state.activeTab === 'info') {
      const kv = document.createElement('div')
      kv.className = 'drawer-kv-grid'
      const pairs = [
        ['Service ID', node.id],
        ['Name', node.label],
        ['Kind', node.kind],
        ['State', node.state],
        ['Port', node.port ? String(node.port) : 'auto'],
        ['Endpoint', node.url || node.sublabel || '—']
      ]
      for (const [k, v] of pairs) {
        const kEl = document.createElement('div')
        kEl.className = 'drawer-kv-label'
        kEl.textContent = k
        const vEl = document.createElement('div')
        vEl.className = 'drawer-kv-val'
        vEl.textContent = String(v)
        kv.append(kEl, vEl)
      }
      content.appendChild(kv)

      const actionsStack = document.createElement('div')
      actionsStack.className = 'drawer-actions-stack'

      if (!node.isSynthetic) {
        if (!graph.ttydOnline) {
          const notice = document.createElement('div')
          notice.className = 'ttyd-offline-banner'
          notice.dataset.testid = 'ttyd-offline-notice'
          notice.innerHTML = '<strong>Web Terminal (ttyd) is offline</strong><span>Service start/stop actions run in an interactive ttyd terminal session and are disabled until ttyd is online.</span>'
          actionsStack.appendChild(notice)
        }

        // Only render a service start/stop button when the CLI provides an explicit action URL (fallback.url)
        const actionUrl = node.fallback?.url || ''
        if (actionUrl) {
          const taskBtn = document.createElement('button')
          taskBtn.type = 'button'
          const actionName = node.fallback?.name || (node.state === 'offline' ? `Start ${node.label}` : `Stop ${node.label}`)
          taskBtn.className = `asd-btn ${node.state === 'offline' ? 'ok' : 'primary'}`
          taskBtn.dataset.testid = 'drawer-service-action-btn'
          taskBtn.textContent = actionName
          taskBtn.disabled = !graph.ttydOnline
          taskBtn.addEventListener('click', () => {
            showServiceModal(
              { id: node.id, name: `${node.label} (${actionName})`, url: actionUrl },
              null,
              { onDone: () => refresh() }
            )
          })
          actionsStack.appendChild(taskBtn)
        }

        const popWidgetBtn = document.createElement('button')
        popWidgetBtn.type = 'button'
        popWidgetBtn.className = 'asd-btn sm'
        popWidgetBtn.textContent = '⤢ Pop out Widget'
        popWidgetBtn.addEventListener('click', () => openWidgetPopoutModal(node))
        actionsStack.appendChild(popWidgetBtn)
      }

      if (node.rawService && node.url) {
        const addBoardBtn = document.createElement('button')
        addBoardBtn.type = 'button'
        addBoardBtn.className = 'asd-btn'
        addBoardBtn.dataset.testid = 'drawer-add-widget'
        addBoardBtn.textContent = '+ Open as Widget on Board'
        addBoardBtn.addEventListener('click', async () => {
          const resolved = resolveServiceConfig(node.rawService)
          const location = findServiceLocation(serviceLimitKey(resolved))
          if (location && typeof resolved.maxInstances === 'number' && resolved.maxInstances <= 1) {
            await switchBoard(location.boardId, location.viewId)
          } else {
            await addWidget(resolved.url, undefined, undefined, 'iframe', getCurrentBoardId(), getCurrentViewId())
          }
          if (typeof opts.onSwitchToBoards === 'function') {
            opts.onSwitchToBoards()
          }
          showNotification(`Opened "${node.label}" on board`, 2200, 'success')
        })
        actionsStack.appendChild(addBoardBtn)
      }

      if (node.url) {
        const extLink = document.createElement('a')
        extLink.href = node.url
        extLink.target = '_blank'
        extLink.rel = 'noopener noreferrer'
        extLink.className = 'asd-btn'
        extLink.style.textDecoration = 'none'
        extLink.textContent = '↗ Open Endpoint in New Tab'
        actionsStack.appendChild(extLink)
      }

      // Visibility section
      const lifeTitle = document.createElement('div')
      lifeTitle.style.fontSize = '10px'
      lifeTitle.style.textTransform = 'uppercase'
      lifeTitle.style.letterSpacing = '0.12em'
      lifeTitle.style.color = 'var(--fg-3)'
      lifeTitle.style.marginTop = '8px'
      lifeTitle.textContent = 'Map Visibility'
      actionsStack.appendChild(lifeTitle)

      const hideBtn = document.createElement('button')
      hideBtn.type = 'button'
      hideBtn.className = 'asd-btn'
      hideBtn.dataset.testid = 'drawer-hide-node'
      hideBtn.textContent = '◎ Hide from map (local)'
      hideBtn.addEventListener('click', () => {
        const hidden = loadHiddenNodeIds()
        hidden.add(node.id)
        saveHiddenNodeIds(hidden)
        state.selectedNodeId = null
        refresh()
        showNotification(`Hidden "${node.label}" from topology map`, 2000, 'success')
      })
      actionsStack.appendChild(hideBtn)

      content.appendChild(actionsStack)
    } else if (state.activeTab === 'logs') {
      const logBox = document.createElement('div')
      logBox.className = 'drawer-log-box'
      logBox.dataset.testid = 'drawer-log-box'
      logBox.textContent = `Fetching live logs for ${node.id} from /asde/mcp/api/logs/${node.id}…`
      content.appendChild(logBox)

      const ctrl = new AbortController()
      state.logAbort = ctrl
      fetch(`/asde/mcp/api/logs/${encodeURIComponent(node.id)}?tail=80`, {
        signal: ctrl.signal,
        headers: { accept: 'text/plain, text/event-stream, application/json' }
      })
        .then(async (res) => {
          if (!res.ok) {
            logBox.textContent = `Live log stream unavailable (/asde/mcp/api/logs/${node.id} returned HTTP ${res.status}).`
            return
          }
          const text = await res.text()
          logBox.textContent = text.trim() || `No log entries returned for ${node.id}.`
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          logBox.textContent = `Live log stream unavailable (/asde/mcp/api/logs/${node.id} is offline or unreachable).`
        })
    } else if (state.activeTab === 'shell') {
      if (!graph.ttydOnline) {
        const emptyShell = document.createElement('div')
        emptyShell.className = 'ttyd-offline-banner'
        emptyShell.dataset.testid = 'shell-ttyd-offline'
        emptyShell.innerHTML = '<strong>Web Terminal (ttyd) is offline</strong><span>Interactive shell sessions require the workspace ttyd daemon to be online.</span>'
        content.appendChild(emptyShell)
      } else {
        const ttydNode = graph.nodes.find(n => n.isTtyd)
        const ttydUrl = ttydNode?.url || '/asde/terminal/'

        const popTtydBtn = document.createElement('button')
        popTtydBtn.type = 'button'
        popTtydBtn.className = 'asd-btn primary'
        popTtydBtn.textContent = '⤢ Pop out Interactive Shell (ttyd)'
        popTtydBtn.addEventListener('click', () => openTtydPopoutModal(node, graph.ttydOnline, ttydUrl))
        content.appendChild(popTtydBtn)

        const iframe = document.createElement('iframe')
        iframe.className = 'drawer-shell-frame'
        iframe.dataset.testid = 'drawer-shell-iframe'
        iframe.src = ttydUrl
        content.appendChild(iframe)
      }
    } else if (state.activeTab === 'network') {
      const connectedEdges = graph.edges.filter(e => e.from === node.id || e.to === node.id)
      const kv = document.createElement('div')
      kv.className = 'drawer-kv-grid'
      kv.innerHTML = `
        <div class="drawer-kv-label">Service ID</div>
        <div class="drawer-kv-val">${escapeHtml(node.id)}</div>
        <div class="drawer-kv-label">Port</div>
        <div class="drawer-kv-val">${escapeHtml(node.port || '—')}</div>
        <div class="drawer-kv-label">Target URL</div>
        <div class="drawer-kv-val">${escapeHtml(node.url || '—')}</div>
        <div class="drawer-kv-label">Active Routes</div>
        <div class="drawer-kv-val">${connectedEdges.length}</div>
        <div class="drawer-kv-label">Tunnel</div>
        <div class="drawer-kv-val">${String(node.url || '').includes('.tn.') || String(node.url || '').includes('viaal.ink') ? 'Public TLS Tunnel' : 'Workspace Local'}</div>
      `
      content.appendChild(kv)

      for (const edge of connectedEdges) {
        const row = document.createElement('div')
        row.style.padding = '8px 10px'
        row.style.background = 'var(--bg-2)'
        row.style.border = '1px solid var(--line)'
        row.style.borderRadius = 'var(--r-2)'
        row.style.fontSize = '12px'
        row.style.display = 'flex'
        row.style.justifyContent = 'space-between'
        row.style.alignItems = 'center'
        row.className = 'asd-mono'
        const span = document.createElement('span')
        span.textContent = `${edge.from} → ${edge.to} [${edge.protocol}]`
        row.appendChild(span)
        const tapBtn = document.createElement('button')
        tapBtn.type = 'button'
        tapBtn.className = 'asd-btn ghost sm'
        tapBtn.textContent = 'Annotate mitm'
        tapBtn.addEventListener('click', () => insertMitmOnEdge(edge, graph))
        row.appendChild(tapBtn)
        content.appendChild(row)
      }
    }
  }

  /**
   * Render only the SVG nodes and edges (used during fast drag operations).
   * @returns {{nodes: import('./topologyBuilder.js').TopologyNode[], edges: import('./topologyBuilder.js').TopologyEdge[], ttydOnline: boolean}}
   */
  function refreshCanvasOnly () {
    const graph = getFullGraph()
    svg.innerHTML = ''

    // Arrow markers
    const defs = document.createElementNS(SVG_NS, 'defs')
    defs.innerHTML = `
      <marker id="net-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="oklch(0.66 0.012 255)"/>
      </marker>
      <marker id="net-arr-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/>
      </marker>
    `
    svg.appendChild(defs)

    const vp = document.createElementNS(SVG_NS, 'g')
    vp.setAttribute('id', 'net-viewport')
    vp.setAttribute('transform', `translate(${state.panX}, ${state.panY}) scale(${state.zoom})`)
    svg.appendChild(vp)

    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))
    const needle = state.search.trim().toLowerCase()

    const matchesNode = (/** @type {import('./topologyBuilder.js').TopologyNode} */ n) => {
      if (state.filter === 'online' && n.state !== 'online') return false
      if (state.filter === 'offline' && n.state !== 'offline') return false
      if (state.filter === 'tunnel' && n.kind !== 'tunnel' && !String(n.url || '').includes('.tn.') && !String(n.url || '').includes('viaal.ink')) return false
      if (needle) {
        const hay = `${n.id} ${n.label} ${n.sublabel} ${n.kind}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    }

    // Draw edges with hit path + midpoint label pill
    for (const edge of graph.edges) {
      const fromNode = nodeMap.get(edge.from)
      const toNode = nodeMap.get(edge.to)
      if (!fromNode || !toNode) continue

      const x1 = fromNode.x + NODE_W
      const y1 = fromNode.y + NODE_H / 2
      const x2 = toNode.x
      const y2 = toNode.y + NODE_H / 2
      const dx = Math.max(44, Math.abs(x2 - x1) * 0.48)
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      const midX = Math.round((x1 + x2) / 2)
      const midY = Math.round((y1 + y2) / 2)
      const isEdgeSelected = state.selectedEdgeId === edge.id

      const eg = document.createElementNS(SVG_NS, 'g')
      eg.setAttribute('class', 'net-edge-group')
      eg.setAttribute('data-edge-id', edge.id)
      eg.style.cursor = 'pointer'

      const hitPath = document.createElementNS(SVG_NS, 'path')
      hitPath.setAttribute('d', d)
      hitPath.setAttribute('stroke', 'transparent')
      hitPath.setAttribute('stroke-width', '14')
      hitPath.setAttribute('fill', 'none')
      eg.appendChild(hitPath)

      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('class', `net-edge-path ${edge.status}${edge.flowing ? ' flowing' : ''}${isEdgeSelected ? ' selected' : ''}`)
      path.setAttribute('marker-end', isEdgeSelected || edge.flowing ? 'url(#net-arr-accent)' : 'url(#net-arr)')
      if (edge.flowing) {
        path.setAttribute('stroke-dasharray', '6 4')
        const anim = document.createElementNS(SVG_NS, 'animate')
        anim.setAttribute('attributeName', 'stroke-dashoffset')
        anim.setAttribute('values', '0;-20')
        anim.setAttribute('dur', '0.8s')
        anim.setAttribute('repeatCount', 'indefinite')
        path.appendChild(anim)
      }
      eg.appendChild(path)

      if (edge.label) {
        const lblText = edge.label.length > 18 ? `${edge.label.slice(0, 17)}…` : edge.label
        const pillW = Math.max(44, lblText.length * 6.4 + 12)
        const pillRect = document.createElementNS(SVG_NS, 'rect')
        pillRect.setAttribute('x', String(midX - pillW / 2))
        pillRect.setAttribute('y', String(midY - 9))
        pillRect.setAttribute('width', String(pillW))
        pillRect.setAttribute('height', '18')
        pillRect.setAttribute('rx', '4')
        pillRect.setAttribute('class', 'net-edge-label-bg')
        eg.appendChild(pillRect)

        const pillTxt = document.createElementNS(SVG_NS, 'text')
        pillTxt.setAttribute('x', String(midX))
        pillTxt.setAttribute('y', String(midY + 3.5))
        pillTxt.setAttribute('text-anchor', 'middle')
        pillTxt.setAttribute('class', `net-edge-label-text${edge.flowing ? ' flowing' : ''}`)
        pillTxt.textContent = lblText
        eg.appendChild(pillTxt)
      }

      eg.addEventListener('click', (ev) => {
        ev.stopPropagation()
        state.selectedNodeId = null
        state.selectedNoteId = null
        state.selectedEdgeId = edge.id
        renderDrawer(graph)
        openMitmEdgeModal(edge, graph)
      })

      vp.appendChild(eg)
    }

    // Draw nodes with NODE_FILLS, kind tag, status dot, bold label, sublabel, and right connect handle
    for (const node of graph.nodes) {
      const g = document.createElementNS(SVG_NS, 'g')
      const isSelected = state.selectedNodeId === node.id
      const isMatch = matchesNode(node)
      g.setAttribute(
        'class',
        `net-node-group${isSelected ? ' selected' : ''}${!isMatch ? ' dimmed' : ''}`
      )
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`)
      g.setAttribute('data-testid', `network-node-${node.id}`)
      g.setAttribute('data-node-id', node.id)

      if (node.flowing) {
        const glow = document.createElementNS(SVG_NS, 'rect')
        glow.setAttribute('x', '-4')
        glow.setAttribute('y', '-4')
        glow.setAttribute('width', String(NODE_W + 8))
        glow.setAttribute('height', String(NODE_H + 8))
        glow.setAttribute('rx', '11')
        glow.setAttribute('fill', 'none')
        glow.setAttribute('stroke', 'var(--accent)')
        glow.setAttribute('stroke-width', '1.5')
        g.appendChild(glow)
      }

      const rect = document.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('class', 'net-node-rect')
      rect.setAttribute('width', String(NODE_W))
      rect.setAttribute('height', String(NODE_H))
      rect.setAttribute('rx', '8')
      rect.style.fill = NODE_FILLS[node.kind] || NODE_FILLS.service
      g.appendChild(rect)

      // Top-left kind pill badge
      const kindW = Math.max(38, node.kind.length * 6.6 + 12)
      const kindBg = document.createElementNS(SVG_NS, 'rect')
      kindBg.setAttribute('x', '10')
      kindBg.setAttribute('y', '9')
      kindBg.setAttribute('width', String(kindW))
      kindBg.setAttribute('height', '16')
      kindBg.setAttribute('rx', '3.5')
      kindBg.setAttribute('fill', 'oklch(0 0 0 / 0.36)')
      g.appendChild(kindBg)

      const kindTxt = document.createElementNS(SVG_NS, 'text')
      kindTxt.setAttribute('class', 'net-node-kind')
      kindTxt.setAttribute('x', '16')
      kindTxt.setAttribute('y', '20')
      kindTxt.textContent = node.kind
      g.appendChild(kindTxt)

      // Top-right status dot
      const dot = document.createElementNS(SVG_NS, 'circle')
      dot.setAttribute('cx', String(NODE_W - 14))
      dot.setAttribute('cy', '17')
      dot.setAttribute('r', '4.5')
      dot.setAttribute('fill', node.state === 'online' ? 'oklch(0.75 0.16 150)' : 'oklch(0.65 0.2 28)')
      g.appendChild(dot)

      // Bold white title
      const titleTxt = document.createElementNS(SVG_NS, 'text')
      titleTxt.setAttribute('class', 'net-node-title')
      titleTxt.setAttribute('x', '12')
      titleTxt.setAttribute('y', '44')
      titleTxt.textContent = node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label
      g.appendChild(titleTxt)

      // Monospace metadata sublabel
      const subTxt = document.createElementNS(SVG_NS, 'text')
      subTxt.setAttribute('class', 'net-node-sub')
      subTxt.setAttribute('x', '12')
      subTxt.setAttribute('y', '62')
      subTxt.textContent = node.sublabel.length > 27 ? `${node.sublabel.slice(0, 26)}…` : node.sublabel
      g.appendChild(subTxt)

      // Right-side connect handle (circle)
      const handle = document.createElementNS(SVG_NS, 'circle')
      handle.setAttribute('class', 'net-node-handle')
      handle.setAttribute('cx', String(NODE_W))
      handle.setAttribute('cy', String(NODE_H / 2))
      handle.setAttribute('r', '5.5')
      handle.addEventListener('mousedown', (ev) => {
        ev.stopPropagation()
        const x1 = node.x + NODE_W
        const y1 = node.y + NODE_H / 2
        edgeDraft = { fromId: node.id, x1, y1, x2: x1, y2: y1 }
        const draftLine = document.createElementNS(SVG_NS, 'line')
        draftLine.setAttribute('id', 'net-edge-draft')
        draftLine.setAttribute('x1', String(x1))
        draftLine.setAttribute('y1', String(y1))
        draftLine.setAttribute('x2', String(x1))
        draftLine.setAttribute('y2', String(y1))
        draftLine.setAttribute('stroke', 'var(--accent)')
        draftLine.setAttribute('stroke-width', '2')
        draftLine.setAttribute('stroke-dasharray', '4 4')
        draftLine.setAttribute('marker-end', 'url(#net-arr-accent)')
        vp.appendChild(draftLine)
      })
      g.appendChild(handle)

      // Node drag + click
      g.addEventListener('mousedown', (ev) => {
        if (/** @type {Element} */ (ev.target).classList.contains('net-node-handle')) return
        ev.stopPropagation()
        if (state.tool === 'edge') {
          const x1 = node.x + NODE_W
          const y1 = node.y + NODE_H / 2
          edgeDraft = { fromId: node.id, x1, y1, x2: x1, y2: y1 }
          return
        }
        const w = screenToWorld(ev.clientX, ev.clientY)
        dragTarget = {
          id: node.id,
          type: 'node',
          dx: w.x - node.x,
          dy: w.y - node.y,
          moved: false
        }
      })

      g.addEventListener('mouseup', (ev) => {
        if (edgeDraft && edgeDraft.fromId !== node.id) {
          ev.stopPropagation()
          const custom = loadCustomEdges()
          const newEdgeId = `custom-${edgeDraft.fromId}-${node.id}-${Date.now().toString(36)}`
          custom.push({
            id: newEdgeId,
            from: edgeDraft.fromId,
            to: node.id,
            label: 'custom route',
            status: 'live',
            protocol: 'HTTP'
          })
          saveCustomEdges(custom)
          edgeDraft = null
          state.selectedNodeId = null
          state.selectedNoteId = null
          state.selectedEdgeId = newEdgeId
          refresh()
          showNotification(`Connected ${node.label} route`, 1800, 'success')
        }
      })

      g.addEventListener('click', (ev) => {
        ev.stopPropagation()
        state.selectedEdgeId = null
        state.selectedNoteId = null
        state.selectedNodeId = node.id
        refresh()
      })

      vp.appendChild(g)
    }

    // Update bottom-right stack summary
    const mitmCount = graph.nodes.filter(n => n.kind === 'mitm' || n.id === 'mitmproxy').length
    stackBox.innerHTML = `
      <span>nodes <b style="color:var(--fg);">${graph.nodes.length}</b></span>
      <span>edges <b style="color:var(--fg);">${graph.edges.length}</b></span>
      <span>mitm <b style="color:var(--accent);">${mitmCount}</b></span>
      <span>stack <b style="color:var(--ok);">bun · caddy-api</b></span>
    `

    // Update top-right hint pill
    hintPill.innerHTML = `
      <span>hub: <b style="color:var(--accent);">${escapeHtml(getActiveHub().id)}</b></span>
      <span>·</span>
      <span>drag node = move</span>
      <span>·</span>
      <span>drag blue dot = connect</span>
      <span>·</span>
      <span>click edge = annotate mitm</span>
    `

    return graph
  }

  /**
   * Render the entire Network View (toolbar, SVG topology, sticky notes, and drawer).
   * @returns {void}
   */
  function refresh () {
    const hiddenIds = loadHiddenNodeIds()
    const graph = refreshCanvasOnly()

    // 0. Tool mode buttons (Select | Note | Edge)
    toolModeGroup.innerHTML = ''
    /** @type {Array<{id: 'select'|'note'|'edge', label: string}>} */
    const tools = [
      { id: 'select', label: '↖ Select' },
      { id: 'note', label: '🗒 Note' },
      { id: 'edge', label: '⟿ Connect' }
    ]
    for (const t of tools) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `asd-btn sm ${state.tool === t.id ? 'primary' : 'ghost'}`
      btn.textContent = t.label
      btn.addEventListener('click', () => {
        state.tool = t.id
        refresh()
      })
      toolModeGroup.appendChild(btn)
    }

    // 1. Update toolbar stats
    const onlineNodes = graph.nodes.filter(n => !n.isSynthetic && n.state === 'online').length
    const totalSvcNodes = graph.nodes.filter(n => !n.isSynthetic).length
    statsGroup.innerHTML = ''

    const svcPill = document.createElement('span')
    svcPill.className = `asd-pill ${onlineNodes === totalSvcNodes ? 'ok' : 'warn'} asd-num`
    svcPill.innerHTML = `<span class="asd-dot ${onlineNodes === totalSvcNodes ? 'ok' : 'warn'}"></span>${onlineNodes}/${totalSvcNodes} services`

    const ttydPill = document.createElement('span')
    ttydPill.className = `asd-pill ${graph.ttydOnline ? 'ok' : 'err'}`
    ttydPill.dataset.testid = 'network-ttyd-badge'
    ttydPill.textContent = `ttyd: ${graph.ttydOnline ? 'online' : 'offline'}`

    statsGroup.append(svcPill, ttydPill)

    // 2. Filter pills
    filterGroup.innerHTML = ''
    /** @type {Array<{id: 'all'|'online'|'offline'|'tunnel', label: string}>} */
    const filters = [
      { id: 'all', label: 'All' },
      { id: 'online', label: 'Online' },
      { id: 'offline', label: 'Offline' },
      { id: 'tunnel', label: 'Tunnels' }
    ]
    for (const f of filters) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `network-filter-pill${state.filter === f.id ? ' active' : ''}`
      btn.dataset.testid = `network-filter-${f.id}`
      btn.textContent = f.label
      btn.addEventListener('click', () => {
        state.filter = f.id
        refresh()
      })
      filterGroup.appendChild(btn)
    }

    // 3. Actions group
    actionsGroup.innerHTML = ''

    if (hiddenIds.size > 0) {
      const restoreBtn = document.createElement('button')
      restoreBtn.type = 'button'
      restoreBtn.className = 'asd-btn sm'
      restoreBtn.dataset.testid = 'network-restore-hidden'
      restoreBtn.textContent = `Restore Hidden (${hiddenIds.size})`
      restoreBtn.addEventListener('click', () => {
        saveHiddenNodeIds(new Set())
        refresh()
      })
      actionsGroup.appendChild(restoreBtn)
    }

    const addNoteBtn = document.createElement('button')
    addNoteBtn.type = 'button'
    addNoteBtn.className = 'asd-btn sm'
    addNoteBtn.dataset.testid = 'network-add-sticky'
    addNoteBtn.textContent = '+ Sticky Note'
    addNoteBtn.addEventListener('click', () => {
      const notes = loadStickyNotes()
      const idx = notes.length
      const newNote = {
        id: `note-${Date.now().toString(36)}`,
        text: `Workspace annotation #${idx + 1}: verify service route & health.`,
        x: 40 + (idx % 4) * 225,
        y: 20 + Math.floor(idx / 4) * 95
      }
      notes.push(newNote)
      saveStickyNotes(notes)
      state.selectedNodeId = null
      state.selectedEdgeId = null
      state.selectedNoteId = newNote.id
      renderStickies()
      renderDrawer(graph)
    })

    const zoomOutBtn = document.createElement('button')
    zoomOutBtn.type = 'button'
    zoomOutBtn.className = 'asd-btn sm asd-mono'
    zoomOutBtn.textContent = '−'
    zoomOutBtn.title = 'Zoom out'
    zoomOutBtn.addEventListener('click', () => {
      state.zoom = Math.max(0.35, state.zoom / 1.15)
      updateViewportTransform()
    })

    const resetZoomBtn = document.createElement('button')
    resetZoomBtn.type = 'button'
    resetZoomBtn.className = 'asd-btn sm asd-mono'
    resetZoomBtn.dataset.testid = 'network-zoom-reset'
    resetZoomBtn.textContent = `${Math.round(state.zoom * 100)}%`
    resetZoomBtn.title = 'Reset pan and zoom'
    resetZoomBtn.addEventListener('click', () => {
      state.zoom = 1
      state.panX = 0
      state.panY = 0
      updateViewportTransform()
    })

    const zoomInBtn = document.createElement('button')
    zoomInBtn.type = 'button'
    zoomInBtn.className = 'asd-btn sm asd-mono'
    zoomInBtn.textContent = '+'
    zoomInBtn.title = 'Zoom in'
    zoomInBtn.addEventListener('click', () => {
      state.zoom = Math.min(2.2, state.zoom * 1.15)
      updateViewportTransform()
    })

    const gapBtn = document.createElement('button')
    gapBtn.type = 'button'
    gapBtn.className = 'asd-btn sm'
    gapBtn.dataset.testid = 'network-gap-btn'
    gapBtn.textContent = 'Architecture Report'
    gapBtn.addEventListener('click', openGapAnalysisModal)

    actionsGroup.append(addNoteBtn, zoomOutBtn, resetZoomBtn, zoomInBtn, gapBtn)

    renderStickies()
    renderDrawer(graph)
  }

  searchInput.addEventListener('input', () => {
    state.search = searchInput.value
    refresh()
  })

  document.addEventListener('state-change', (e) => {
    const reason = /** @type {CustomEvent} */ (e).detail?.reason
    if (reason === 'config') {
      refresh()
    }
  })

  document.addEventListener('services-updated', refresh)
  document.addEventListener('hubs-changed', refresh)

  /**
   * Focus and select a specific service/node ID in the Network View.
   * @param {string} id
   * @returns {void}
   */
  function focusNode (id) {
    if (!id) return
    const hidden = loadHiddenNodeIds()
    if (hidden.has(id)) {
      hidden.delete(id)
      saveHiddenNodeIds(hidden)
    }
    state.selectedEdgeId = null
    state.selectedNoteId = null
    state.selectedNodeId = id
    state.activeTab = 'info'
    refresh()
  }

  refresh()
  return { refresh, focusNode }
}
