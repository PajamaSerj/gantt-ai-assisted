import { useEffect, useState } from 'react'
import './App.css'

type Task = {
  internal_id: string
  public_id: string
  name: string
  description: string | null
  assignee: string | null
  duration_workdays: number
  predecessor_ids: string[]
  start_date: string
  end_date: string
  created_source: 'seed' | 'excel' | 'ai'
}

type PlanState = {
  tasks: Task[]
}

function App() {
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadSeed() {
      try {
        const response = await fetch('/api/seed', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Seed request failed (${response.status})`)
        }
        setPlan((await response.json()) as PlanState)
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      }
    }

    void loadSeed()
    return () => controller.abort()
  }, [])

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <p className="eyebrow">Iteration 1 foundation</p>
          <h1>AI Gantt Planner</h1>
        </div>
        <span className="status-pill">Domain preview</span>
      </header>

      <section className="content" aria-labelledby="plan-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fixed seed snapshot</p>
            <h2 id="plan-heading">Plan tasks</h2>
          </div>
          {plan && <p className="task-count">{plan.tasks.length} tasks</p>}
        </div>

        {error && (
          <p className="notice notice-error" role="alert">
            Backend unavailable: {error}
          </p>
        )}
        {!plan && !error && <p className="notice">Loading seed plan…</p>}

        {plan && (
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assignee</th>
                  <th>Duration</th>
                  <th>Start</th>
                  <th>Finish</th>
                </tr>
              </thead>
              <tbody>
                {plan.tasks.map((task) => (
                  <tr key={task.internal_id}>
                    <td>
                      <span className="task-id">{task.public_id}</span>
                      <strong>{task.name}</strong>
                    </td>
                    <td>{task.assignee ?? 'Unassigned'}</td>
                    <td>{task.duration_workdays} workdays</td>
                    <td>{task.start_date}</td>
                    <td>{task.end_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>
        React/Vite shell · Stateless FastAPI seed · Gantt UI intentionally deferred
      </footer>
    </main>
  )
}

export default App
