# Changelog

## [Unreleased]
- Implemented Viaalink Dashboard v2 redesign: OKLCH light/dark token system (`tokens.css`), top navigation bar with Multi-Hub Switcher & Hub Manager modal (`hubRegistry.js`, `HubSwitcher.js`), Boards/Network surface switcher, interactive SVG Network Topology (`NetworkView.js`, `topologyBuilder.js`) with draggable nodes, custom connect handles, sticky notes, route edge `mitmproxy` injection, 4-tab right detail drawer (`Info`, `Logs`, `Shell`, `Network`), widget/shell popout modals, and `⌘K` Command Palette (`CommandPalette.js`).

## v5 StorageManager Stabilization
- Fix CustomEvent payload and standardize change reasons.
- Single IndexedDB version-change API with session fallback to localStorage.

## ✨ WidgetSelectorPanel
- Added subcategory search and service instance counts.
- Limits now disable add actions when reached.
- New modal flow for creating and editing services.
