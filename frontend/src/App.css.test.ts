import { describe, expect, it } from 'vitest'

import appStyles from './App.css?raw'

describe('planner layout CSS contract', () => {
  it('does not force populated Gantt height from the viewport', () => {
    expect(appStyles).not.toContain('calc(100vh - 230px)')
    expect(appStyles).not.toMatch(/\.gantt-host\s*\{[^}]*min-height/s)
    expect(appStyles).not.toMatch(/\.gantt-host \.gantt-container\s*\{[^}]*min-height/s)
    expect(appStyles).not.toMatch(
      /\.gantt-host \.gantt-container\s*\{[^}]*height:\s*auto\s*!important/s,
    )
  })

  it('keeps only a modest loading and empty-state minimum', () => {
    expect(appStyles).toMatch(
      /\.loading-state,\s*\.empty-state\s*\{[^}]*min-height:\s*280px/s,
    )
  })

  it('renders success feedback as a floating toast', () => {
    expect(appStyles).toMatch(/\.toast-stack\s*\{[^}]*position:\s*fixed/s)
  })

  it('uses minimal solid and dashed preview outline styles without row labels', () => {
    expect(appStyles).toMatch(
      /\.gantt-preview-proposed-direct[^}]*stroke-dasharray:\s*none/s,
    )
    expect(appStyles).toMatch(
      /\.gantt-preview-proposed-dependency\s*\{[^}]*stroke-dasharray:\s*5 3/s,
    )
    expect(appStyles).toMatch(
      /\.legend-dot\.dependency\s*\{[^}]*border-style:\s*dashed/s,
    )
    expect(appStyles).toMatch(
      /\.gantt-preview-frappe-label-hidden\s*\{[^}]*visibility:\s*hidden/s,
    )
    expect(appStyles).toMatch(
      /\.gantt-preview-safe-label\s*\{[^}]*fill:\s*#fff/s,
    )
    expect(appStyles).not.toContain('.gantt-preview-current-label')
    expect(appStyles).not.toContain('.gantt-preview-label-background')
    expect(appStyles).not.toContain('.gantt-preview-delta')
    expect(appStyles).not.toContain('.gantt-preview-reason')
  })
})
