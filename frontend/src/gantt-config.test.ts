import { describe, expect, it } from 'vitest'

import { GANTT_SAFETY_OPTIONS } from './gantt-config'

describe('Gantt safety configuration', () => {
  it('prevents local date edits and automatic dependent movement', () => {
    expect(GANTT_SAFETY_OPTIONS).toEqual({
      readonly: true,
      readonly_dates: true,
      readonly_progress: true,
      move_dependencies: false,
    })
  })
})
