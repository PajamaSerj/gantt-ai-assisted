import { describe, expect, it } from 'vitest'

import {
  GANTT_SAFETY_OPTIONS,
  ganttInteractionOptions,
} from './gantt-config'

describe('Gantt safety configuration', () => {
  it('keeps progress and automatic dependency movement disabled', () => {
    expect(GANTT_SAFETY_OPTIONS).toMatchObject({
      readonly_progress: true,
      move_dependencies: false,
      infinite_padding: false,
      language: 'ru',
      fixed_duration: false,
    })
  })

  it('disables drag and date resize while a mutation is locked', () => {
    expect(ganttInteractionOptions(false)).toEqual({
      readonly: false,
      readonly_dates: false,
    })
    expect(ganttInteractionOptions(true)).toEqual({
      readonly: true,
      readonly_dates: true,
    })
  })
})
