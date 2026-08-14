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
})
