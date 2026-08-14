import type { ChangeSet, PlanState, Task } from '../types'

function seedTask(
  number: number,
  name: string,
  assignee: string,
  duration_workdays: number,
  predecessorNumbers: number[],
  start_date: string,
  end_date: string,
): Task {
  return {
    internal_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    public_id: `TASK-${String(number).padStart(3, '0')}`,
    name,
    description: `${name} description`,
    assignee,
    duration_workdays,
    predecessor_ids: predecessorNumbers.map(
      (predecessor) => `00000000-0000-4000-8000-${String(predecessor).padStart(12, '0')}`,
    ),
    start_date,
    end_date,
    created_source: 'seed',
  }
}

export function makePlan(name = 'Исследование продукта'): PlanState {
  return {
    tasks: [
      {
        internal_id: '00000000-0000-4000-8000-000000000001',
        public_id: 'TASK-001',
        name,
        description: 'Проверить гипотезы',
        assignee: 'Анна',
        duration_workdays: 3,
        predecessor_ids: [],
        start_date: '2026-02-02',
        end_date: '2026-02-04',
        created_source: 'seed',
      },
      {
        internal_id: '00000000-0000-4000-8000-000000000002',
        public_id: 'TASK-002',
        name: 'UX-дизайн',
        description: null,
        assignee: 'Мария',
        duration_workdays: 4,
        predecessor_ids: ['00000000-0000-4000-8000-000000000001'],
        start_date: '2026-02-05',
        end_date: '2026-02-10',
        created_source: 'seed',
      },
    ],
  }
}

export function makeChangeSet(plan = makePlan()): ChangeSet {
  return {
    changeset_id: '00000000-0000-4000-8000-000000000099',
    source_plan_digest: 'digest',
    requested_changes: [],
    affected_tasks: [
      {
        internal_id: plan.tasks[0].internal_id,
        public_id: plan.tasks[0].public_id,
        name: plan.tasks[0].name,
      },
    ],
    conflicts: [],
    proposed_impacts: [],
    date_normalizations: [],
    confirmation_reasons: [],
    status: 'CONFIRMATION_REQUIRED',
    proposed_plan: plan,
  }
}

export function makeSergeyPendingScenario(): {
  current: PlanState
  proposed: PlanState
  changeset: ChangeSet
} {
  const current: PlanState = {
    tasks: [
      seedTask(1, 'Product discovery', 'Anna', 3, [], '2026-02-02', '2026-02-04'),
      seedTask(2, 'UX design', 'Maria', 4, [1], '2026-02-05', '2026-02-10'),
      seedTask(3, 'Backend foundation', 'Sergey', 5, [1], '2026-02-05', '2026-02-11'),
      seedTask(4, 'Frontend foundation', 'Elena', 5, [2], '2026-02-11', '2026-02-17'),
      seedTask(5, 'Application integration', 'Sergey', 3, [3, 4], '2026-02-18', '2026-02-20'),
      seedTask(6, 'End-to-end QA', 'Oleg', 4, [5], '2026-02-23', '2026-02-26'),
      seedTask(7, 'Demo readiness', 'Anna', 2, [6], '2026-02-27', '2026-03-02'),
    ],
  }
  const proposed: PlanState = {
    tasks: current.tasks.map((task) => {
      const dates: Record<string, [string, string]> = {
        'TASK-003': ['2026-02-12', '2026-02-18'],
        'TASK-005': ['2026-02-25', '2026-02-27'],
        'TASK-006': ['2026-03-02', '2026-03-05'],
        'TASK-007': ['2026-03-06', '2026-03-09'],
      }
      const changedDates = dates[task.public_id]
      return changedDates
        ? { ...task, start_date: changedDates[0], end_date: changedDates[1] }
        : { ...task }
    }),
  }
  const task3 = current.tasks[2]
  const task5 = current.tasks[4]
  const task6 = current.tasks[5]
  const task7 = current.tasks[6]
  const proposed6 = proposed.tasks[5]
  const proposed7 = proposed.tasks[6]
  const changeset: ChangeSet = {
    changeset_id: '00000000-0000-4000-8000-000000000099',
    source_plan_digest: 'seed-digest',
    requested_changes: [
      { type: 'move_task', task_id: task3.internal_id, start_date: '2026-02-12' },
      { type: 'move_task', task_id: task5.internal_id, start_date: '2026-02-25' },
    ],
    affected_tasks: [task3, task5, task6, task7].map((task) => ({
      internal_id: task.internal_id,
      public_id: task.public_id,
      name: task.name,
    })),
    conflicts: [],
    proposed_impacts: [
      {
        internal_id: task6.internal_id,
        public_id: task6.public_id,
        task_name: task6.name,
        current_start_date: task6.start_date,
        current_end_date: task6.end_date,
        proposed_start_date: proposed6.start_date,
        proposed_end_date: proposed6.end_date,
        reason: 'TASK-006 must start after TASK-005 finishes',
        dependency_internal_id: task5.internal_id,
        dependency_public_id: task5.public_id,
        dependency_name: task5.name,
      },
      {
        internal_id: task7.internal_id,
        public_id: task7.public_id,
        task_name: task7.name,
        current_start_date: task7.start_date,
        current_end_date: task7.end_date,
        proposed_start_date: proposed7.start_date,
        proposed_end_date: proposed7.end_date,
        reason: 'TASK-007 must start after TASK-006 finishes',
        dependency_internal_id: task6.internal_id,
        dependency_public_id: task6.public_id,
        dependency_name: task6.name,
      },
    ],
    date_normalizations: [],
    confirmation_reasons: [],
    status: 'CONFIRMATION_REQUIRED',
    proposed_plan: proposed,
  }
  return { current, proposed, changeset }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
}
