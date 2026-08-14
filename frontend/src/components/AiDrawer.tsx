import { useEffect, useRef, type FormEvent, type UIEvent } from 'react'

import type { ConversationMessage, PendingChange } from '../types'
import { AssistantMessage } from './AssistantMessage'

type AiDrawerProps = {
  open: boolean
  busy: boolean
  pending: PendingChange | null
  messages: ConversationMessage[]
  message: string
  onMessageChange: (message: string) => void
  onSubmit: () => Promise<void>
  onClose: () => void
  onAttach: (file: File) => void
}

export function AiDrawer({
  open,
  busy,
  pending,
  messages,
  message,
  onMessageChange,
  onSubmit,
  onClose,
  onAttach,
}: AiDrawerProps) {
  const attachmentRef = useRef<HTMLInputElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return
    const conversation = conversationRef.current
    if (conversation) conversation.scrollTop = conversation.scrollHeight
  }, [busy, messages, open])

  function trackConversationScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit()
  }

  return (
    <aside className={`ai-drawer ${open ? 'open' : ''}`} aria-label="AI-помощник">
      <div className="drawer-header">
        <div className="ai-mark">✦</div>
        <div>
          <p className="eyebrow">AI-помощник</p>
          <h2>Работа с планом</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть AI-помощника">
          ×
        </button>
      </div>

      <div
        className="conversation"
        aria-live="polite"
        onScroll={trackConversationScroll}
        ref={conversationRef}
      >
        {messages.length === 0 ? (
          <div className="assistant-intro">
            <span>✦</span>
            <p>Что хотите сделать с задачами?</p>
            <small>Например: «Сдвинь все задачи Анны на два рабочих дня»</small>
          </div>
        ) : (
          messages.map((item, index) => (
            <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
              {item.role === 'assistant' ? (
                <AssistantMessage message={item.content} />
              ) : (
                item.content
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="message assistant typing" role="status">
            <span>Анализирую план</span>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
          </div>
        )}
      </div>

      {pending && (
        <p className="drawer-blocked" role="status">
          Сначала примените или отмените подготовленные изменения.
        </p>
      )}

      <form className="composer" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Сообщение AI-помощнику"
          placeholder="Что хотите сделать с задачами?"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          disabled={busy || Boolean(pending)}
          rows={3}
        />
        <div className="composer-actions">
          <input
            ref={attachmentRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onAttach(file)
              event.target.value = ''
            }}
            disabled={busy || Boolean(pending)}
            aria-label="Прикрепить Excel"
          />
          <button
            className="attachment-button"
            type="button"
            title="Импортировать Excel"
            onClick={() => attachmentRef.current?.click()}
            disabled={busy || Boolean(pending)}
          >
            📎 <span>Excel</span>
          </button>
          <button
            className="send-button"
            type="submit"
            disabled={busy || Boolean(pending) || !message.trim()}
          >
            Отправить <span>↑</span>
          </button>
        </div>
      </form>
    </aside>
  )
}
