import { Card } from '../common/Card'
import { CodeBlock } from '../common/CodeBlock'

interface ModelfilePreviewProps {
  modelfile: string
  path: string
  name: string
}

export function ModelfilePreview({ modelfile, path, name }: ModelfilePreviewProps) {
  return (
    <Card title="Modelfile" className="mt-4">
      <div className="flex flex-col gap-3">
        <CodeBlock language="modelfile" code={modelfile} />
        <p className="text-sm text-text">
          Saved to: <span className="font-mono text-text-muted">{path}</span>
        </p>
        <p className="text-sm text-text-muted">
          Usage: <code className="font-mono text-text">ollama create {name} -f {path}</code>
        </p>
      </div>
    </Card>
  )
}
