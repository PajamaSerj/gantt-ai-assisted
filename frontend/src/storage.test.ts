import { describe, expect, it } from 'vitest'

import { loadPlannerState, persistPlannerState, STORAGE_KEY } from './storage'
import { makeChangeSet, makePlan } from './test/fixtures'

describe('planner storage', () => {
  it('round-trips plan, conversation, and pending confirmation', () => {
    const state = {
      plan: makePlan(),
      conversationContext: [
        { role: 'user' as const, content: 'Перенеси задачу' },
        { role: 'assistant' as const, content: 'Уточните дату' },
      ],
      pendingChange: {
        changeset: makeChangeSet(),
        message: 'Подтвердите',
        availableOptions: ['apply_all', 'cancel'],
        source: 'chat' as const,
      },
    }

    persistPlannerState(localStorage, state)

    expect(loadPlannerState(localStorage)).toEqual(state)
  })

  it('removes corrupt persisted state', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')

    expect(loadPlannerState(localStorage)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
