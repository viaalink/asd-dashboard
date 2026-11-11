// @ts-check
/**
 * Pure topology graph builder for the Viaalink Network View.
 * Derives interactive SVG nodes and edges strictly from workspace services.
 * @module views/network/topologyBuilder
 */

/**
 * @typedef {'client'|'tunnel'|'proxy'|'hub'|'app'|'studio'|'api'|'db'|'mail'|'ide'|'terminal'|'mitm'|'service'} NodeKind
 */

/**
 * @typedef {Object} TopologyNode
 * @property {string} id
 * @property {string} label
 * @property {string} sublabel
 * @property {NodeKind} kind
 * @property {'online'|'offline'|'degraded'} state
 * @property {number} x
 * @property {number} y
 * @property {string} url
 * @property {number|null} [port]
 * @property {{name?: string, url?: string, method?: string}|null} fallback
 * @property {boolean} isTtyd
 * @property {boolean} isSynthetic
 * @property {boolean} [flowing]
 * @property {any} [rawService]
 */

/**
 * @typedef {Object} TopologyEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {string} label
 * @property {'live'|'off'} status
 * @property {string} protocol
 * @property {boolean} [flowing]
 */

/**
 * Color palette per node kind.
 * @constant {Record<string, string>}
 */
export const NODE_FILLS = {
  client: 'oklch(0.42 0.06 250)',
  proxy: 'oklch(0.42 0.09 30)',
  tunnel: 'oklch(0.42 0.11 290)',
  hub: 'oklch(0.42 0.10 250)',
  app: 'oklch(0.42 0.07 170)',
  studio: 'oklch(0.42 0.07 140)',
  api: 'oklch(0.42 0.09 110)',
  db: 'oklch(0.42 0.10 65)',
  mail: 'oklch(0.42 0.08 200)',
  ide: 'oklch(0.42 0.09 230)',
  terminal: 'oklch(0.38 0.02 255)',
  service: 'oklch(0.40 0.06 215)',
  mitm: 'oklch(0.50 0.18 30)'
}

/**
 * Infer port number from a service object's explicit port, URL, or `service-<port>` id.
 * @function inferServicePort
 * @param {any} svc
 * @returns {number|null}
 */
export function inferServicePort (svc) {
  if (typeof svc?.port === 'number' && svc.port > 0) return svc.port
  const url = String(svc?.url || '')
  if (url) {
    try {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.port) return Number(parsed.port)
    } catch { /* ignore */ }
  }
  const id = String(svc?.id || '')
  const portMatch = id.match(/^service-(\d+)$/i)
  if (portMatch) return Number(portMatch[1])
  return null
}

/**
 * Extract a concise route or host/port sublabel from a service URL.
 * @function formatServiceEndpoint
 * @param {string|undefined} url
 * @param {string} fallbackId
 * @param {number|null} [port]
 * @returns {string}
 */
export function formatServiceEndpoint (url, fallbackId, port = null) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    if (port) {
      return `port=${port}`
    }
    return fallbackId
  }
  try {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.hostname.includes('.tn.') || parsed.hostname.includes('asd.engineer') || parsed.hostname.includes('viaal.ink') || parsed.hostname.includes('viaalink')) {
      return parsed.hostname
    }
    if (parsed.port) {
      return `port=${parsed.port}${parsed.pathname && parsed.pathname !== '/' ? ' ' + parsed.pathname : ''}`
    }
    if (parsed.pathname && parsed.pathname !== '/') {
      return parsed.pathname
    }
    return parsed.hostname
  } catch {
    return url
  }
}

/**
 * Classify a workspace service into a topology node kind.
 * @function classifyServiceKind
 * @param {{id?: string, name?: string, url?: string, kind?: string}} svc
 * @returns {NodeKind}
 */
export function classifyServiceKind (svc) {
  const id = String(svc?.id || '').toLowerCase()
  const name = String(svc?.name || '').toLowerCase()
  if (id === 'ttyd' || name.includes('terminal') || name === 'ttyd') return 'terminal'
  if (id === 'caddy' || name === 'caddy') return 'proxy'
  if (id.startsWith('mitm-')) return 'mitm'
  if (id === 'mitmproxy' || name.includes('inspect')) return 'proxy'
  if (id === 'hub' || name.includes('dashboard')) return 'hub'
  if (id.includes('tunnel') || name.includes('tunnel')) return 'tunnel'
  if (id === 'dbgate' || id.includes('pg') || id.includes('postgres') || id.includes('db') || id.includes('search') || id.includes('elastic')) return 'db'
  if (id === 'codeserver' || name.includes('code')) return 'ide'
  if (id.includes('studio') || name.includes('studio')) return 'studio'
  if (id.includes('kong') || id === 'mcp' || name.includes('gateway') || name.includes('api')) return 'api'
  if (id.includes('mail') || name.includes('mail')) return 'mail'
  if (id.includes('sveltekit') || id.includes('manager') || id.includes('apk') || id.includes('app')) return 'app'
  return 'service'
}

/**
 * Build the complete topology graph (nodes + edges) from workspace services.
 * @function buildWorkspaceTopology
 * @param {Array<any>} services
 * @param {Set<string>} [hiddenIds]
 * @param {Record<string, {x: number, y: number}>} [customPositions]
 * @returns {{nodes: TopologyNode[], edges: TopologyEdge[], ttydOnline: boolean}}
 */
export function buildWorkspaceTopology (services = [], hiddenIds = new Set(), customPositions = {}) {
  const list = Array.isArray(services) ? services : []
  const ttydSvc = list.find(s => String(s?.id || '').toLowerCase() === 'ttyd')
  const ttydOnline = Boolean(ttydSvc && String(ttydSvc.state || 'online').toLowerCase() === 'online')

  /** @type {TopologyNode[]} */
  const nodes = []
  /** @type {TopologyEdge[]} */
  const edges = []

  const applyPos = (/** @type {string} */ id, /** @type {number} */ defX, /** @type {number} */ defY) => {
    const saved = customPositions && customPositions[id]
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      return { x: saved.x, y: saved.y }
    }
    return { x: defX, y: defY }
  }

  // 1. Browser Client node (Col 0)
  if (!hiddenIds.has('client-browser')) {
    const pos = applyPos('client-browser', 30, 220)
    nodes.push({
      id: 'client-browser',
      label: 'Browser Client',
      sublabel: typeof window !== 'undefined' ? `via=${window.location.host || 'localhost'}` : 'via=localhost',
      kind: 'client',
      state: 'online',
      x: pos.x,
      y: pos.y,
      url: typeof window !== 'undefined' ? window.location.origin : '',
      port: null,
      fallback: null,
      isTtyd: false,
      isSynthetic: true
    })
  }

  // Check if any service uses a public tunnel URL or is a tunnel service
  let tunnelServiceUrl = ''
  let tunnelHostLabel = 'tunnel'
  for (const s of list) {
    const u = String(s?.url || '')
    if (u.includes('.tn.') || u.includes('asd.engineer') || u.includes('viaal.ink') || String(s?.id || '').includes('tunnel')) {
      tunnelServiceUrl = u
      try {
        const parsed = new URL(u)
        tunnelHostLabel = parsed.hostname
      } catch { /* ignore */ }
      break
    }
  }
  const hasTunnelRoutes = Boolean(tunnelServiceUrl) || list.some(s => String(s?.id || '').includes('tunnel'))

  if (hasTunnelRoutes && !hiddenIds.has('edge-tunnel')) {
    const pos = applyPos('edge-tunnel', 30, 340)
    nodes.push({
      id: 'edge-tunnel',
      label: 'Viaalink Edge Relay',
      sublabel: tunnelHostLabel,
      kind: 'tunnel',
      state: 'online',
      x: pos.x,
      y: pos.y,
      url: tunnelServiceUrl,
      port: null,
      fallback: null,
      isTtyd: false,
      isSynthetic: true
    })
  }

  // 2. Caddy Reverse Proxy / Ingress node (Col 1)
  const caddySvc = list.find(s => classifyServiceKind(s) === 'proxy' && String(s?.id || '').toLowerCase() === 'caddy')
  const caddyId = caddySvc?.id || 'caddy'
  const caddyState = caddySvc
    ? (String(caddySvc.state || 'online').toLowerCase() === 'offline' ? 'offline' : 'online')
    : 'online'

  if (!hiddenIds.has(caddyId)) {
    const pos = applyPos(caddyId, 255, 220)
    const caddyPort = inferServicePort(caddySvc) || (typeof window !== 'undefined' && window.location.port ? Number(window.location.port) : null)
    nodes.push({
      id: caddyId,
      label: caddySvc?.name || 'Caddy Ingress',
      sublabel: `${caddyPort ? `port=${caddyPort} ` : ''}services=${list.length}`,
      kind: 'proxy',
      state: caddyState,
      x: pos.x,
      y: pos.y,
      url: String(caddySvc?.url || ''),
      port: caddyPort,
      fallback: caddySvc?.fallback || null,
      isTtyd: false,
      isSynthetic: !caddySvc,
      rawService: caddySvc || null
    })
  }

  if (!hiddenIds.has('client-browser') && !hiddenIds.has(caddyId)) {
    edges.push({
      id: `edge-client-${caddyId}`,
      from: 'client-browser',
      to: caddyId,
      label: 'TLS / HTTP',
      status: caddyState === 'online' ? 'live' : 'off',
      protocol: 'HTTP/2'
    })
  }

  if (hasTunnelRoutes && !hiddenIds.has('edge-tunnel') && !hiddenIds.has(caddyId)) {
    edges.push({
      id: `edge-tunnel-${caddyId}`,
      from: 'edge-tunnel',
      to: caddyId,
      label: tunnelHostLabel,
      status: caddyState === 'online' ? 'live' : 'off',
      protocol: 'SSH/TLS'
    })
  }

  // 3. Separate core hub/terminal/ide services (Col 2) and workspace/app/db services (Col 3+)
  /** @type {any[]} */
  const coreServices = []
  /** @type {any[]} */
  const appServices = []

  for (const svc of list) {
    if (!svc || svc === caddySvc) continue
    const id = String(svc.id || svc.name || '')
    if (!id || hiddenIds.has(id)) continue
    const kind = classifyServiceKind(svc)
    if (kind === 'hub' || kind === 'terminal' || kind === 'ide' || id === 'mitmproxy') {
      coreServices.push(svc)
    } else {
      appServices.push(svc)
    }
  }

  if (list.length === 0) {
    if (!hiddenIds.has('hub')) {
      coreServices.push({
        id: 'hub',
        name: 'Viaalink Hub',
        url: '/asde/hub-config.json',
        state: 'online',
        __synthetic: true
      })
    }
    if (!hiddenIds.has('ttyd')) {
      coreServices.push({
        id: 'ttyd',
        name: 'ttyd Terminal',
        url: '/asde/terminal',
        state: 'offline',
        __synthetic: true
      })
    }
  }

  const col2StartY = Math.max(50, 220 - ((coreServices.length - 1) * 96) / 2)
  coreServices.forEach((svc, idx) => {
    const id = String(svc.id || svc.name || `core-${idx}`)
    const kind = classifyServiceKind(svc)
    const isOffline = String(svc.state || 'online').toLowerCase() === 'offline'
    const label = String(svc.name || id)
    const port = inferServicePort(svc)
    const effectiveUrl = String(svc.url || '')
    const pos = applyPos(id, 480, Math.round(col2StartY + idx * 96))

    nodes.push({
      id,
      label,
      sublabel: formatServiceEndpoint(effectiveUrl, id, port),
      kind,
      state: isOffline ? 'offline' : 'online',
      x: pos.x,
      y: pos.y,
      url: effectiveUrl,
      port,
      fallback: svc.fallback || null,
      isTtyd: id === 'ttyd',
      isSynthetic: Boolean(svc.__synthetic),
      rawService: svc.__synthetic ? null : svc
    })

    if (!hiddenIds.has(caddyId)) {
      const routeLabel = formatServiceEndpoint(effectiveUrl, id, port)
      edges.push({
        id: `edge-${caddyId}-${id}`,
        from: caddyId,
        to: id,
        label: routeLabel,
        status: isOffline ? 'off' : 'live',
        protocol: id === 'ttyd' ? 'WS/HTTP' : 'HTTP'
      })
    }
  })

  // 4. Workspace & App Services (Col 3 & Col 4)
  const perCol = 5
  appServices.forEach((svc, idx) => {
    const id = String(svc.id || svc.name || `svc-${idx}`)
    const kind = classifyServiceKind(svc)
    const colIdx = Math.floor(idx / perCol)
    const rowIdx = idx % perCol
    const colCount = Math.min(perCol, appServices.length - colIdx * perCol)
    const startY = Math.max(50, 220 - ((colCount - 1) * 94) / 2)
    const defX = 710 + colIdx * 220
    const defY = Math.round(startY + rowIdx * 94)
    const pos = applyPos(id, defX, defY)
    const isOffline = String(svc.state || 'online').toLowerCase() === 'offline'
    const label = String(svc.name || id)
    const port = inferServicePort(svc)
    const effectiveUrl = String(svc.url || '')

    nodes.push({
      id,
      label,
      sublabel: formatServiceEndpoint(effectiveUrl, id, port),
      kind,
      state: isOffline ? 'offline' : 'online',
      x: pos.x,
      y: pos.y,
      url: effectiveUrl,
      port,
      fallback: svc.fallback || null,
      isTtyd: false,
      isSynthetic: false,
      rawService: svc
    })

    if (!hiddenIds.has(caddyId)) {
      const shortRoute = formatServiceEndpoint(effectiveUrl, id, port)
      edges.push({
        id: `edge-${caddyId}-${id}`,
        from: caddyId,
        to: id,
        label: shortRoute,
        status: isOffline ? 'off' : 'live',
        protocol: kind === 'db' ? 'TCP/HTTP' : (effectiveUrl.startsWith('https') ? 'HTTPS' : 'HTTP')
      })
    }
  })

  return { nodes, edges, ttydOnline }
}
