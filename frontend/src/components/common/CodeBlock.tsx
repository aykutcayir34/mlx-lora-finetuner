import { useState } from 'react'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

export function CodeBlock({ code, language, className = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch {
      // Clipboard unavailable or permission denied — nothing further to do.
    }
  }

  return (
    <div className={`relative rounded-lg border border-border bg-surface-raised ${className}`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-text-muted">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface hover:text-text"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3">
        <code data-language={language} className="font-mono text-sm text-text">
          {code}
        </code>
      </pre>
    </div>
  )
}
