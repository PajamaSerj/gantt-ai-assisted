import { describe, expect, it } from 'vitest'

import {
  buildPendingPlanPreview,
  formatPreviewDateRange,
  pendingPreviewSummary,
} from './pending-preview'
import {
  makeChangeSet,
  makePlan,
  makeSergeyPendingScenario,
} from './test/fixtures'

describe('pending ChangeSet preview', () => {
  it('derives all direct and dependency-driven changes without mutating current plan', () => {
    const { current, proposed, changeset } = makeSergeyPendingScenario()
    const originalSnapshot = structuredClone(current)

    const preview = buildPendingPlanPreview(current, changeset)

    expect(preview).not.toBeNull()
    expect(current).toEqual(originalSnapshot)
    expect(preview?.proposedPlan).toEqual(proposed)
    expect(preview?.changes.map((change) => [
      change.publicId,
      change.proposedTask?.start_date,
      change.source,
    ])).toEqual([
      ['TASK-003', '2026-02-12', 'direct'],
      ['TASK-005', '2026-02-25', 'direct'],
      ['TASK-006', '2026-03-02', 'dependency'],
      ['TASK-007', '2026-03-06', 'dependency'],
    ])
    expect(preview?.directCount).toBe(2)
    expect(preview?.dependencyCount).toBe(2)
  })

  it('builds concise deterministic Russian summary and date ranges', () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)

    expect(preview && pendingPreviewSummary(preview)).toBe(
      'Вы переносите 2 задачи на 5 рабочих дней вперёд. ' +
      'Из-за зависимостей сдвинутся ещё 2 задачи.',
    )
    expect(formatPreviewDateRange('2026-02-05', '2026-02-11')).toBe(
      '5–11 февр.',
    )
    expect(formatPreviewDateRange('2026-02-27', '2026-03-02')).toBe(
      '27 февр. – 2 марта',
    )
  })

  it('describes a direct duration resize without treating it as a move', () => {
    const current = makePlan()
    const proposed = structuredClone(current)
    proposed.tasks[1] = {
      ...proposed.tasks[1],
      duration_workdays: 6,
      end_date: '2026-02-12',
    }
    const changeset = makeChangeSet(proposed)
    changeset.requested_changes = [{
      type: 'set_duration',
      task_id: current.tasks[1].internal_id,
      duration_workdays: 6,
    }]

    const preview = buildPendingPlanPreview(current, changeset)

    expect(preview && pendingPreviewSummary(preview)).toBe(
      'Вы изменяете длительность 1 задачи.',
    )
  })
})
