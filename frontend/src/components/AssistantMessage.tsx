import { Fragment, type ReactNode } from 'react'

function inlineFormatting(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

type ContentBlock =
  | { type: 'paragraph' | 'heading'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }

function parseAssistantMessage(message: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const paragraph: string[] = []
  let list: Extract<ContentBlock, { type: 'list' }> | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
      paragraph.length = 0
    }
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }

  for (const rawLine of message.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: heading[1] })
      continue
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    const item = unordered?.[1] ?? ordered?.[1]
    if (item) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { type: 'list', ordered: isOrdered, items: [] }
      }
      list.items.push(item)
      continue
    }

    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

export function AssistantMessage({ message }: { message: string }) {
  return (
    <div className="assistant-rich-text">
      {parseAssistantMessage(message).map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={index}>{inlineFormatting(block.text)}</h3>
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineFormatting(item)}</li>
              ))}
            </List>
          )
        }
        return (
          <p key={index}>
            {block.text.split('\n').map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inlineFormatting(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
