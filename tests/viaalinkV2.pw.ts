// @ts-check
import { test, expect } from './fixtures'
import { routeServicesConfig } from './shared/mocking'
import { clearStorage, navigate } from './shared/common'
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
      url: '/asde/terminal/?arg=asd&arg=net&arg=stop&arg=--id%3Dsupabase%3Astudio',
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
      url: '/asde/terminal/?arg=asd&arg=net&arg=start&arg=--id%3Dservice-19876',
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

  test('renders Viaalink brand and switches between Boards and Network views', async ({ page }) => {
    await expect(page.locator('[data-testid="brand-control"]')).toContainText('Viaalink')
    await expect(page.locator('[data-testid="nav-boards"]')).toHaveClass(/active/)
    await expect(page.locator('main > .board')).toBeVisible()
    await expect(page.locator('[data-testid="network-surface"]')).toBeHidden()

    // Switch to Network view via top-bar button
    await page.click('[data-testid="nav-network"]')
    await expect(page.locator('[data-testid="nav-network"]')).toHaveClass(/active/)
    await expect(page.locator('[data-testid="network-surface"]')).toBeVisible()
    await expect(page.locator('main > .board')).toBeHidden()

    // Switch back to Boards via keyboard shortcut Ctrl+b
    await page.keyboard.press('Control+b')
    await expect(page.locator('[data-testid="nav-boards"]')).toHaveClass(/active/)
    await expect(page.locator('main > .board')).toBeVisible()
  })

  test('renders workspace services in Network topology and opens node detail drawer', async ({ page }) => {
    await page.click('[data-testid="nav-network"]')

    await expect(page.locator('[data-testid="network-node-supabase:studio"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-node-service-19876"]')).toBeVisible()
    await expect(page.locator('[data-testid="network-ttyd-badge"]')).toHaveText('ttyd: online')

    // Click offline service node to open Detail Drawer
    await page.click('[data-testid="network-node-service-19876"]')
    const drawer = page.locator('[data-testid="network-detail-drawer"]')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('[data-testid="drawer-node-title"]')).toHaveText('service-19876')

    // Because ttyd is online, Start Service button is enabled and opens the ttyd modal
    const actionBtn = drawer.locator('[data-testid="drawer-service-action-btn"]')
    await expect(actionBtn).toBeEnabled()
    await expect(actionBtn).toHaveText('Start Service')

    await page.route('**/asde/terminal/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ttyd</body></html>' })
    )
    await actionBtn.click()
    await expect(page.locator('.service-action-modal')).toBeVisible()
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

  test('manages workspace hubs via Hub Switcher and Hub Manager modal', async ({ page }) => {
    await page.click('[data-testid="hub-switcher"]')
    await expect(page.locator('[data-testid="hub-switcher-popover"]')).toBeVisible()

    await page.click('[data-testid="open-hub-manager"]')
    await expect(page.locator('#hub-manager-modal')).toBeVisible()

    await page.fill('[data-testid="hub-input-name"]', 'staging-eu-hub')
    await page.fill('[data-testid="hub-input-url"]', 'https://staging.viaalink.dev')
    await page.selectOption('[data-testid="hub-input-env"]', 'staging')
    await page.click('[data-testid="hub-add-submit"]')

    await expect(page.locator('[data-testid="hub-manager-list"]')).toContainText('staging-eu-hub')
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
