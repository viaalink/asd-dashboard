// @ts-check
import { test, expect } from './fixtures'
import { routeServicesConfig } from './shared/mocking'
import { clearStorage, getServices, navigate } from './shared/common'
import { ciConfig } from './data/ciConfig'

const workspaceServices = [
  {
    id: 'ttyd',
    name: 'ttyd',
    url: 'http://localhost:8000/asde/terminal',
    state: 'online',
    maxInstances: 10
  },
  {
    id: 'caddy',
    name: 'Caddy',
    url: 'http://127.0.0.1:37772/config/',
    state: 'online',
    maxInstances: 10
  },
  {
    id: 'supabase:studio',
    name: 'Studio',
    url: 'https://studio-kelvin.eu1.tn.asd.engineer/project/default',
    state: 'online',
    maxInstances: 5,
    fallback: {
      name: 'Stop Service',
      url: '/asde/terminal/?arg=via&arg=net&arg=stop&arg=--id%3Dsupabase%3Astudio',
      method: 'GET'
    }
  },
  {
    id: 'service-19876',
    name: 'service-19876',
    url: 'http://localhost:19876',
    state: 'offline',
    maxInstances: 5,
    fallback: {
      name: 'Start Service',
      url: '/asde/terminal/?arg=via&arg=net&arg=start&arg=--id%3Dservice-19876',
      method: 'GET'
    }
  }
]

test.describe('Viaalink Dashboard v2 — Surface Switcher, Network Topology, Hub Registry & Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await routeServicesConfig(page)
    await page.route('**/config.json', route => route.fulfill({ json: ciConfig }))
    await page.route('**/services.json', route => route.fulfill({ json: workspaceServices }))
    await navigate(page, '/')
  })

  test('renders Viaalink brand and switches between Boards and Network views without hijacking inputs', async ({ page }) => {
    await expect(page.locator('[data-testid="brand-control"]')).toContainText('Viaalink')
    await expect(page.locator('[data-testid="nav-boards"]')).toHaveClass(/active/)
    await expect(page.locator('main > .board')).toBeVisible()
    await expect(page.locator('[data-testid="network-surface"]')).toBeHidden()

    // Switch to Network view via top-bar button
    await page.click('[data-testid="nav-network"]')
    await expect(page.locator('[data-testid="nav-network"]')).toHaveClass(/active/)
    await expect(page.locator('[data-testid="network-surface"]')).toBeVisible()
    await expect(page.locator('main > .board')).toBeHidden()

    // Shortcuts must NOT fire while focused inside an input field
    const searchInput = page.locator('[data-testid="network-search"]')
    await searchInput.focus()
    await page.keyboard.press('Alt+b')
    await expect(page.locator('[data-testid="network-surface"]')).toBeVisible()

    // Blur input and switch back to Boards via keyboard shortcut Alt+b
    await searchInput.evaluate(el => /** @type {HTMLElement} */ (el).blur())
    await page.keyboard.press('Alt+b')
    await expect(page.locator('[data-testid="nav-boards"]')).toHaveClass(/active/)
    await expect(page.locator('main > .board')).toBeVisible()
  })

  test('renders workspace services in Network topology, omits stop button for ttyd, and launches exact fallback.url', async ({ page }) => {
    await page.click('[data-testid="nav-network"]')

    await expect(page.locator('[data-testid="network-node-ttyd"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-node-supabase:studio"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-node-service-19876"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-ttyd-badge"]')).toHaveText('ttyd: online')

    const drawer = page.locator('[data-testid="network-detail-drawer"]')

    // Click ttyd node -> CLI omits fallback for ttyd, so no start/stop action button should exist
    await page.click('[data-testid="network-node-ttyd"]')
    await expect(drawer.locator('[data-testid="drawer-node-title"]')).toHaveText('ttyd')
    await expect(drawer.locator('[data-testid="drawer-service-action-btn"]')).toHaveCount(0)

    // Click offline service node that has fallback.url
    await page.click('[data-testid="network-node-service-19876"]')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('[data-testid="drawer-node-title"]')).toHaveText('service-19876')

    // Because ttyd is online, Start Service button is enabled and opens the modal with exact fallback.url
    const actionBtn = drawer.locator('[data-testid="drawer-service-action-btn"]')
    await expect(actionBtn).toBeEnabled()
    await expect(actionBtn).toHaveText('Start Service')

    await page.route('**/asde/terminal/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ttyd</body></html>' })
    )
    await actionBtn.click()
    await expect(page.locator('.service-action-modal')).toBeVisible()
    const iframeSrc = await page.locator('.service-action-iframe').getAttribute('src')
    expect(iframeSrc).toContain('/asde/terminal/?arg=via&arg=net&arg=start&arg=--id%3Dservice-19876')
    await page.click('.service-action-btn-secondary') // Minimize

    // Local reversible Hide from map & Restore
    await page.click('[data-testid="drawer-hide-node"]')
    await expect(page.locator('[data-testid="network-node-service-19876"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="network-restore-hidden"]')).toBeVisible()
    await page.click('[data-testid="network-restore-hidden"]')
    await expect(page.locator('[data-testid="network-node-service-19876"]')).toBeVisible()
  })

  test('shows clear offline notice in drawer and Shell tab when ttyd is offline', async ({ page }) => {
    const offlineTtydServices = workspaceServices.map(s =>
      s.id === 'ttyd' ? { ...s, state: 'offline' } : s
    )
    await page.route('**/services.json', route => route.fulfill({ json: offlineTtydServices }))
    await clearStorage(page)
    await navigate(page, '/?surface=network')

    await expect(page.locator('[data-testid="network-ttyd-badge"]')).toHaveText('ttyd: offline')
    await page.click('[data-testid="network-node-service-19876"]')

    const drawer = page.locator('[data-testid="network-detail-drawer"]')
    await expect(drawer.locator('[data-testid="ttyd-offline-notice"]')).toBeVisible()
    await expect(drawer.locator('[data-testid="drawer-service-action-btn"]')).toBeDisabled()

    await page.click('[data-testid="drawer-tab-shell"]')
    await expect(drawer.locator('[data-testid="shell-ttyd-offline"]')).toBeVisible()
  })

  test('manages workspace hubs via Hub Switcher in read-only mode, blocks hostile fallback.url/javascript:, re-syncs on reload, and preserves local data on unreachable hub', async ({ page }) => {
    const stagingServices = [
      {
        id: 'staging-api',
        name: 'Staging Gateway',
        url: 'https://staging.viaalink.dev/api',
        state: 'online',
        maxInstances: 5,
        fallback: {
          name: 'Stop Staging Gateway',
          url: '/asde/terminal/?arg=bash&arg=-c&arg=id'
        }
      },
      {
        id: 'evil-js',
        name: 'Hostile Scheme Service',
        url: 'javascript:window.__pwn=1',
        state: 'online',
        maxInstances: 1
      },
      {
        id: 'ttyd',
        name: 'Remote ttyd',
        url: 'https://staging.viaalink.dev/asde/terminal/',
        state: 'online',
        maxInstances: 1
      }
    ]
    await page.route('https://staging.viaalink.dev/asde/hub-services.json', route =>
      route.fulfill({ json: stagingServices })
    )
    await page.route('https://unreachable.viaalink.dev/**', route =>
      route.abort('failed')
    )

    await page.click('[data-testid="hub-switcher"]')
    await expect(page.locator('[data-testid="hub-switcher-popover"]')).toBeVisible()

    await page.click('[data-testid="open-hub-manager"]')
    await expect(page.locator('#hub-manager-modal')).toBeVisible()

    await page.fill('[data-testid="hub-input-name"]', 'staging-eu-hub')
    await page.fill('[data-testid="hub-input-url"]', 'https://staging.viaalink.dev')
    await page.selectOption('[data-testid="hub-input-env"]', 'staging')
    await page.click('[data-testid="hub-add-submit"]')

    const hubList = page.locator('[data-testid="hub-manager-list"]')
    await expect(hubList).toContainText('staging-eu-hub')

    // Activate staging-eu-hub and verify its services render read-only in Network topology
    await hubList.locator('button:has-text("Activate")').click()
    await page.locator('#hub-manager-modal button:has-text("Close")').click()

    await page.click('[data-testid="nav-network"]')
    await expect(page.locator('[data-testid="network-node-staging-api"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-node-service-19876"]')).toHaveCount(0)

    // Verify local StorageManager services were NOT overwritten by the remote hub
    const storedLocalSvcs = await getServices(page)
    const storedLocalIds = Array.isArray(storedLocalSvcs) ? storedLocalSvcs.map((s: any) => s.id) : []
    expect(storedLocalIds).toContain('service-19876')
    expect(storedLocalIds).not.toContain('staging-api')

    // Verify hostile fallback.url on remote hub shows NO action button and NO iframe
    await page.click('[data-testid="network-node-staging-api"]')
    await expect(page.locator('[data-testid="remote-hub-readonly-notice"]')).toBeVisible()
    await expect(page.locator('[data-testid="drawer-service-action-btn"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="network-detail-drawer"] iframe')).toHaveCount(0)

    // Verify Shell tab on remote hub shows read-only notice and NO terminal iframe
    await page.click('[data-testid="drawer-tab-shell"]')
    await expect(page.locator('[data-testid="shell-remote-readonly"]')).toBeVisible()
    await expect(page.locator('[data-testid="drawer-shell-iframe"]')).toHaveCount(0)

    // Verify javascript: URL on remote service renders no link
    await page.click('[data-testid="network-node-evil-js"]')
    await page.click('[data-testid="drawer-tab-info"]')
    await expect(page.locator('[data-testid="network-detail-drawer"] a[href^="javascript:"]')).toHaveCount(0)

    // Verify reload re-syncs the selected remote hub on startup
    await navigate(page, '/?surface=network')
    await expect(page.locator('[data-testid="hub-switcher"]')).toContainText('staging-eu-hub')
    await expect(page.locator('[data-testid="network-node-staging-api"]')).toBeVisible()

    // Verify unreachable/CORS-blocked remote hub preserves local services and shows "Hub unreachable"
    await page.click('[data-testid="hub-switcher"]')
    await page.click('[data-testid="open-hub-manager"]')
    await page.fill('[data-testid="hub-input-name"]', 'dead-cors-hub')
    await page.fill('[data-testid="hub-input-url"]', 'https://unreachable.viaalink.dev')
    await page.click('[data-testid="hub-add-submit"]')
    await page.locator('[data-testid="hub-manager-list"] div', { hasText: 'dead-cors-hub' }).locator('button:has-text("Activate")').click()
    await page.locator('#hub-manager-modal button:has-text("Close")').click()

    await expect(page.locator('[data-testid="hub-unreachable-banner"]')).toBeVisible()
    const preservedLocalSvcs = await getServices(page)
    const preservedLocalIds = Array.isArray(preservedLocalSvcs) ? preservedLocalSvcs.map((s: any) => s.id) : []
    expect(preservedLocalIds).toContain('service-19876')
  })

  test('escapes HTML payloads in config_base64 and services_base64 without executing XSS', async ({ page }) => {
    const xssConfig = {
      ...ciConfig,
      projectName: '<img src=x onerror="window.__xssConfig=1">'
    }
    const xssServices = [
      {
        id: 'xss-svc',
        name: '<img src=x onerror="window.__xssService=1">',
        url: 'http://localhost:9999',
        state: 'online',
        maxInstances: 5
      }
    ]
    const cfgB64 = Buffer.from(JSON.stringify(xssConfig), 'utf8').toString('base64')
    const svcB64 = Buffer.from(JSON.stringify(xssServices), 'utf8').toString('base64')

    await clearStorage(page)
    await navigate(page, `/?surface=network&config_base64=${encodeURIComponent(cfgB64)}&services_base64=${encodeURIComponent(svcB64)}`)

    await expect(page.locator('[data-testid="network-detail-drawer"]')).toContainText('<img src=x onerror="window.__xssConfig=1">')
    await page.click('[data-testid="network-node-xss-svc"]')
    await expect(page.locator('[data-testid="drawer-node-title"]')).toHaveText('<img src=x onerror="window.__xssService=1">')

    const xssTriggered = await page.evaluate(() => Boolean((window as any).__xssConfig || (window as any).__xssService))
    expect(xssTriggered).toBe(false)
    await expect(page.locator('[data-testid="network-detail-drawer"] img')).toHaveCount(0)
  })

  test('opens Command Palette (⌘K) and navigates to Network node', async ({ page }) => {
    await page.click('[data-testid="command-palette-trigger"]')
    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible()

    await page.fill('[data-testid="command-palette-input"]', 'Studio')
    await page.click('[data-testid="palette-item-svc-net-supabase:studio"]')

    await expect(page.locator('[data-testid="network-surface"]')).toBeVisible()
    await expect(page.locator('[data-testid="drawer-node-title"]')).toHaveText('Studio')
  })
})
