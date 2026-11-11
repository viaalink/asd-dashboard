// @ts-check
/**
 * Multi-hub registry and workspace discovery for the Viaalink Dashboard.
 * Persists hubs and the active hub selection via StorageManager.misc.
 * Remote hubs are strictly read-only: remote services are never written into StorageManager.
 * @module hubs/hubRegistry
 */
import { StorageManager } from '../storage/StorageManager.js'
import { Logger } from '../utils/Logger.js'

const logger = new Logger('hubRegistry.js')

const HUBS_KEY = 'hubs.v2'
const ACTIVE_HUB_KEY = 'activeHub.v2'

/** @type {Record<string, {services: Array<any>, unreachable: boolean}>} */
const remoteHubCache = {}

/**
 * @typedef {Object} HubEntry
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {'local'|'dev'|'staging'|'prod'|string} env
 * @property {'online'|'degraded'|'offline'} status
 * @property {string} [region]
 * @property {string} [version]
 * @property {number} [servicesUp]
 * @property {number} [servicesTotal]
 * @property {boolean} [pinned]
 */

/**
 * Validate and normalize an HTTP(S) hub URL.
 * @function sanitizeHubUrl
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function sanitizeHubUrl (rawUrl) {
  try {
    const base = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:8000'
    const parsed = new URL(String(rawUrl || '').trim(), base)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin + parsed.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Validate a service or action URL.
 * Allows absolute http(s) URLs, and optionally same-origin relative URLs starting with single `/`.
 * Rejects `javascript:`, `data:`, `file:`, protocol-relative `//`, and any other scheme.
 * @function sanitizeSafeUrl
 * @param {any} rawUrl
 * @param {{allowRelative?: boolean}} [opts]
 * @returns {string}
 */
export function sanitizeSafeUrl (rawUrl, opts = {}) {
  if (typeof rawUrl !== 'string') return ''
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''
  const allowRelative = opts.allowRelative !== false
  try {
    if (trimmed.startsWith('/')) {
      if (trimmed.startsWith('//') || !allowRelative) return ''
      const origin = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:8000'
      const parsed = new URL(trimmed, origin)
      if (parsed.origin !== origin) return ''
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
      return parsed.pathname + parsed.search + parsed.hash
    }
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

/**
 * Derive live service counts from a services array or StorageManager.
 * @function computeLocalServiceCounts
 * @param {Array<any>} [servicesList]
 * @returns {{servicesUp: number, servicesTotal: number, status: 'online'|'degraded'|'offline'}}
 */
export function computeLocalServiceCounts (servicesList) {
  const services = Array.isArray(servicesList) ? servicesList : (StorageManager.getServices() || [])
  const total = services.length
  const up = services.filter(s => String(s?.state || 'online').toLowerCase() !== 'offline').length
  /** @type {'online'|'degraded'|'offline'} */
  let status = 'online'
  if (total > 0 && up === 0) status = 'offline'
  else if (total > 0 && up < total) status = 'degraded'
  return { servicesUp: up, servicesTotal: total, status }
}

/**
 * Build the default local workspace hub entry from current origin and config.
 * @function buildDefaultLocalHub
 * @returns {HubEntry}
 */
export function buildDefaultLocalHub () {
  const cfg = /** @type {any} */ (StorageManager.getConfig() || {})
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:8000'
  const host = typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : 'localhost'
  const isTunnel = host.includes('.tn.') || host.includes('viaalink') || host.includes('asd.engineer')
  const name = cfg?.branding?.workspaceName ||
    cfg?.projectName ||
    (isTunnel ? host.split('.')[0] : 'local-workspace')
  const counts = computeLocalServiceCounts()
  return {
    id: 'hub-local',
    name: String(name || 'local-workspace'),
    url: origin,
    env: isTunnel ? 'dev' : 'local',
    status: counts.status,
    region: isTunnel ? 'remote' : 'localhost',
    version: cfg?.version ? String(cfg.version) : '',
    servicesUp: counts.servicesUp,
    servicesTotal: counts.servicesTotal,
    pinned: true
  }
}

/**
 * Load all registered hubs from StorageManager.misc, ensuring the local hub is present and synced.
 * @function getHubs
 * @returns {HubEntry[]}
 */
export function getHubs () {
  const raw = StorageManager.misc.getItem(HUBS_KEY)
  const localHub = buildDefaultLocalHub()
  /** @type {HubEntry[]} */
  let list = []
  if (Array.isArray(raw)) {
    list = raw.filter(h => h && typeof h === 'object' && typeof h.id === 'string')
  }
  const idx = list.findIndex(h => h.id === 'hub-local')
  if (idx === -1) {
    list.unshift(localHub)
  } else {
    list[idx] = {
      ...list[idx],
      name: localHub.name,
      url: localHub.url,
      status: localHub.status,
      servicesUp: localHub.servicesUp,
      servicesTotal: localHub.servicesTotal
    }
  }
  return list
}

/**
 * Save the hub list and emit a hubs-changed event.
 * @function saveHubs
 * @param {HubEntry[]} hubs
 * @returns {HubEntry[]}
 */
export function saveHubs (hubs) {
  const clean = Array.isArray(hubs) ? hubs : [buildDefaultLocalHub()]
  StorageManager.misc.setItem(HUBS_KEY, clean)
  emitHubsChanged()
  return clean
}

/**
 * Get the currently active hub ID.
 * @function getActiveHubId
 * @returns {string}
 */
export function getActiveHubId () {
  const stored = StorageManager.misc.getItem(ACTIVE_HUB_KEY)
  const hubs = getHubs()
  if (typeof stored === 'string' && hubs.some(h => h.id === stored)) {
    return stored
  }
  return hubs[0]?.id || 'hub-local'
}

/**
 * Get the active hub object.
 * @function getActiveHub
 * @returns {HubEntry}
 */
export function getActiveHub () {
  const hubs = getHubs()
  const activeId = getActiveHubId()
  return hubs.find(h => h.id === activeId) || hubs[0] || buildDefaultLocalHub()
}

/**
 * Return true when a non-local remote hub is currently selected.
 * @function isRemoteHubActive
 * @returns {boolean}
 */
export function isRemoteHubActive () {
  return getActiveHubId() !== 'hub-local'
}

/**
 * Return true when the currently selected remote hub failed its last fetch (CORS/offline).
 * @function isActiveHubUnreachable
 * @returns {boolean}
 */
export function isActiveHubUnreachable () {
  const id = getActiveHubId()
  if (id === 'hub-local') return false
  return Boolean(remoteHubCache[id]?.unreachable)
}

/**
 * Sanitize a list of services for topology rendering.
 * Remote hub services are strictly read-only (no fallback actions, no relative URLs, never stored in StorageManager).
 * Local services allow same-origin relative URLs and http(s) URLs, rejecting `javascript:` and other schemes.
 * @function sanitizeTopologyServices
 * @param {Array<any>} rawList
 * @param {boolean} isRemote
 * @returns {Array<any>}
 */
export function sanitizeTopologyServices (rawList, isRemote) {
  if (!Array.isArray(rawList)) return []
  return rawList
    .filter(s => s && typeof s === 'object' && (s.id || s.name))
    .map(s => {
      const safeUrl = sanitizeSafeUrl(s.url, { allowRelative: !isRemote })
      if (isRemote) {
        return {
          id: String(s.id || s.name),
          name: String(s.name || s.id),
          state: String(s.state || 'online'),
          port: typeof s.port === 'number' ? s.port : undefined,
          url: safeUrl,
          fallback: null,
          __readOnlyRemote: true
        }
      }
      const rawFallbackUrl = s.fallback && typeof s.fallback === 'object' ? sanitizeSafeUrl(s.fallback.url, { allowRelative: true }) : ''
      return {
        ...s,
        url: safeUrl,
        fallback: rawFallbackUrl
          ? { ...s.fallback, url: rawFallbackUrl }
          : null
      }
    })
}

/**
 * Get the services list for the currently active hub without mutating StorageManager.
 * @function getActiveTopologyServices
 * @returns {Array<any>}
 */
export function getActiveTopologyServices () {
  const activeId = getActiveHubId()
  if (activeId === 'hub-local') {
    return sanitizeTopologyServices(StorageManager.getServices() || [], false)
  }
  return remoteHubCache[activeId]?.services || []
}

/**
 * Fetch and cache read-only service status/counts/links from the given hub's endpoint.
 * Never writes remote services into StorageManager, preserving local workspace services.
 * @function syncServicesFromHub
 * @param {HubEntry} hub
 * @returns {Promise<Array<any>>}
 */
export async function syncServicesFromHub (hub) {
  if (!hub) return []
  if (hub.id === 'hub-local') {
    const localSvcs = sanitizeTopologyServices(StorageManager.getServices() || [], false)
    const counts = computeLocalServiceCounts(localSvcs)
    upsertHub({ ...hub, ...counts })
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('services-updated'))
    }
    return localSvcs
  }

  const baseUrl = sanitizeHubUrl(hub.url)
  if (!baseUrl) {
    remoteHubCache[hub.id] = { services: [], unreachable: true }
    upsertHub({ ...hub, status: 'offline', servicesUp: 0, servicesTotal: 0 })
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('services-updated'))
    }
    return []
  }

  const urlsToTry = [`${baseUrl}/asde/hub-services.json`, `${baseUrl}/services.json`]
  for (const endpoint of urlsToTry) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store', credentials: 'omit' })
      if (res.ok) {
        const svcs = await res.json()
        if (Array.isArray(svcs)) {
          const readOnlySvcs = sanitizeTopologyServices(svcs, true)
          remoteHubCache[hub.id] = { services: readOnlySvcs, unreachable: false }
          const counts = computeLocalServiceCounts(readOnlySvcs)
          upsertHub({ ...hub, ...counts })
          if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('services-updated'))
          }
          return readOnlySvcs
        }
      }
    } catch (err) {
      logger.warn(`Failed fetching services from ${endpoint}:`, err)
    }
  }

  // Remote hub unreachable (e.g. CORS or network failure): keep local StorageManager data intact and flag unreachable
  remoteHubCache[hub.id] = { services: [], unreachable: true }
  upsertHub({ ...hub, status: 'offline', servicesUp: 0, servicesTotal: 0 })
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('services-updated'))
  }
  return []
}

/**
 * Set the active hub by ID and synchronize its read-only topology state.
 * @function setActiveHubId
 * @param {string} id
 * @returns {HubEntry}
 */
export function setActiveHubId (id) {
  const hubs = getHubs()
  const target = hubs.find(h => h.id === id) || hubs[0] || buildDefaultLocalHub()
  StorageManager.misc.setItem(ACTIVE_HUB_KEY, target.id)
  logger.log(`Switched active hub to ${target.name} (${target.id})`)
  emitHubsChanged()
  syncServicesFromHub(target).catch(err => logger.warn('Hub sync failed:', err))
  return target
}

/**
 * Add or update a hub in the registry.
 * @function upsertHub
 * @param {Partial<HubEntry> & {name: string, url: string}} input
 * @returns {HubEntry}
 */
export function upsertHub (input) {
  const hubs = getHubs()
  const id = input.id || `hub-${Date.now().toString(36)}`
  const existingIdx = hubs.findIndex(h => h.id === id)
  const cleanUrl = sanitizeHubUrl(input.url) || 'http://localhost:8000'
  /** @type {HubEntry} */
  const entry = {
    id,
    name: String(input.name).trim() || 'remote-hub',
    url: cleanUrl,
    env: input.env || 'dev',
    status: input.status || 'online',
    region: input.region || 'remote',
    version: input.version || '',
    servicesUp: typeof input.servicesUp === 'number' ? input.servicesUp : 0,
    servicesTotal: typeof input.servicesTotal === 'number' ? input.servicesTotal : 0,
    pinned: Boolean(input.pinned)
  }
  if (existingIdx >= 0) {
    hubs[existingIdx] = { ...hubs[existingIdx], ...entry }
  } else {
    hubs.push(entry)
  }
  saveHubs(hubs)
  return entry
}

/**
 * Remove a hub by ID (cannot remove hub-local).
 * @function removeHub
 * @param {string} id
 * @returns {boolean}
 */
export function removeHub (id) {
  if (!id || id === 'hub-local') return false
  delete remoteHubCache[id]
  const hubs = getHubs()
  const next = hubs.filter(h => h.id !== id)
  saveHubs(next)
  if (getActiveHubId() === id) {
    setActiveHubId('hub-local')
  }
  return true
}

/**
 * Probe a hub URL for health status and service counts.
 * @function probeHubHealth
 * @param {string} id
 * @returns {Promise<HubEntry|null>}
 */
export async function probeHubHealth (id) {
  const hubs = getHubs()
  const hub = hubs.find(h => h.id === id)
  if (!hub) return null
  if (id === 'hub-local') {
    const counts = computeLocalServiceCounts()
    const updated = { ...hub, ...counts }
    upsertHub(updated)
    return updated
  }
  try {
    const baseUrl = sanitizeHubUrl(hub.url)
    if (!baseUrl) throw new Error('Invalid hub URL')
    const res = await fetch(`${baseUrl}/asde/hub-services.json`, { cache: 'no-store', credentials: 'omit' })
    if (res.ok) {
      const svcs = await res.json()
      if (Array.isArray(svcs)) {
        const readOnlySvcs = sanitizeTopologyServices(svcs, true)
        remoteHubCache[id] = { services: readOnlySvcs, unreachable: false }
        const up = readOnlySvcs.filter(s => String(s?.state || 'online').toLowerCase() !== 'offline').length
        const updated = {
          ...hub,
          status: /** @type {'online'|'degraded'|'offline'} */ (up === readOnlySvcs.length ? 'online' : up > 0 ? 'degraded' : 'offline'),
          servicesUp: up,
          servicesTotal: readOnlySvcs.length
        }
        upsertHub(updated)
        return updated
      }
    }
    const updated = { ...hub, status: /** @type {'online'|'degraded'|'offline'} */ ('degraded') }
    upsertHub(updated)
    return updated
  } catch (err) {
    logger.warn('Hub probe failed:', err)
    remoteHubCache[id] = { services: [], unreachable: true }
    const updated = { ...hub, status: /** @type {'online'|'degraded'|'offline'} */ ('offline') }
    upsertHub(updated)
    return updated
  }
}

/**
 * Emit a standardized hubs-changed custom event.
 * @function emitHubsChanged
 * @returns {void}
 */
export function emitHubsChanged () {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('hubs-changed', {
      detail: { activeHubId: getActiveHubId() }
    }))
  }
}
