import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { buildPendingPlanPreview } from '../pending-preview'
import { makeChangeSet, makePlan } from '../test/fixtures'
import { PendingPanel } from './PendingPanel'

describe('PendingPanel defensive rendering', () => {
  it('renders no decision card for an empty effective change list', () => {
    const plan = makePlan()
    const changeset = makeChangeSet(plan)
    const pending = {
      changeset,
      message: 'Подтвердите',
      availableOptions: ['apply_all', 'cancel'],
      source: 'chat' as const,
    }
    const { container } = render(
      <PendingPanel
        pending={pending}
        preview={buildPendingPlanPreview(plan, changeset)}
        busy={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the normal controls for a real effective change', () => {
    const plan = makePlan()
    const proposed = structuredClone(plan)
    proposed.tasks[0] = { ...proposed.tasks[0], name: 'Новое название' }
    const changeset = makeChangeSet(proposed)
    const pending = {
      changeset,
      message: 'Подтвердите',
      availableOptions: ['apply_all', 'cancel'],
      source: 'chat' as const,
    }
    const { getByRole, getByText } = render(
      <PendingPanel
        pending={pending}
        preview={buildPendingPlanPreview(plan, changeset)}
        busy={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(getByText('Изменения ещё не применены')).toBeInTheDocument()
    expect(getByRole('button', { name: 'Применить всё' })).toBeEnabled()
    expect(getByRole('button', { name: 'Отменить' })).toBeEnabled()
  })
})
