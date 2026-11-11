// @ts-check
/**
 * Multi-hub registry and workspace discovery for the Viaalink Dashboard.
 * Persists hubs and the active hub selection via StorageManager.misc.
 * @module hubs/hubRegistry
 */
import { StorageManager } from '../storage/StorageManager.js'
import { Logger } from '../utils/Logger.js'

const logger = new Logger('hubRegistry.js')

const HUBS_KEY = 'hubs.v2'
const ACTIVE_HUB_KEY = 'activeHub.v2'
const LOCAL_SERVICES_BACKUP_KEY = 'localServicesBackup.v2'

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
  const activeId = StorageManager.misc.getItem(ACTIVE_HUB_KEY)
  const backupSvcs = StorageManager.misc.getItem(LOCAL_SERVICES_BACKUP_KEY)
  const counts = (activeId && activeId !== 'hub-local' && Array.isArray(backupSvcs))
    ? computeLocalServiceCounts(backupSvcs)
    : computeLocalServiceCounts()
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
 * Fetch and apply services from the given hub's endpoint.
 * @function syncServicesFromHub
 * @param {HubEntry} hub
 * @returns {Promise<Array<any>>}
 */
export async function syncServicesFromHub (hub) {
  if (!hub) return []
  const baseUrl = (sanitizeHubUrl(hub.url) || hub.url).replace(/\/+$/, '')
  const urlsToTry = [`${baseUrl}/asde/hub-services.json`, `${baseUrl}/services.json`]
  for (const endpoint of urlsToTry) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store', credentials: 'omit' })
      if (res.ok) {
        const svcs = await res.json()
        if (Array.isArray(svcs)) {
          StorageManager.setServices(svcs)
          const counts = computeLocalServiceCounts(svcs)
          upsertHub({ ...hub, ...counts })
          if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('services-updated'))
          }
          return svcs
        }
      }
    } catch (err) {
      logger.warn(`Failed fetching services from ${endpoint}:`, err)
    }
  }

  if (hub.id === 'hub-local') {
    const backup = StorageManager.misc.getItem(LOCAL_SERVICES_BACKUP_KEY)
    if (Array.isArray(backup)) {
      StorageManager.setServices(backup)
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('services-updated'))
      }
      return backup
    }
  }

  // Remote hub unreachable or returned no valid services array: reflect empty/offline state honestly
  StorageManager.setServices([])
  upsertHub({ ...hub, status: 'offline', servicesUp: 0, servicesTotal: 0 })
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('services-updated'))
  }
  return []
}

/**
 * Set the active hub by ID and load its services into the workspace.
 * @function setActiveHubId
 * @param {string} id
 * @returns {HubEntry}
 */
export function setActiveHubId (id) {
  const prevId = getActiveHubId()
  const hubs = getHubs()
  const target = hubs.find(h => h.id === id) || hubs[0] || buildDefaultLocalHub()
  if (prevId === 'hub-local' && target.id !== 'hub-local') {
    StorageManager.misc.setItem(LOCAL_SERVICES_BACKUP_KEY, StorageManager.getServices() || [])
  }
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
    const baseUrl = (sanitizeHubUrl(hub.url) || hub.url).replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/asde/hub-services.json`, { cache: 'no-store', credentials: 'omit' })
    if (res.ok) {
      const svcs = await res.json()
      if (Array.isArray(svcs)) {
        const up = svcs.filter(s => String(s?.state || 'online').toLowerCase() !== 'offline').length
        const updated = {
          ...hub,
          status: /** @type {'online'|'degraded'|'offline'} */ (up === svcs.length ? 'online' : up > 0 ? 'degraded' : 'offline'),
          servicesUp: up,
          servicesTotal: svcs.length
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
