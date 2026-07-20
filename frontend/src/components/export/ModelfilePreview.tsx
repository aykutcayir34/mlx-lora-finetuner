import { useTranslation } from 'react-i18next'
import { Card } from '../common/Card'
import { CodeBlock } from '../common/CodeBlock'

interface ModelfilePreviewProps {
  modelfile: string
  path: string
  name: string
}

export function ModelfilePreview({ modelfile, path, name }: ModelfilePreviewProps) {
  const { t } = useTranslation('export')
  return (
    <Card title={t('modelfile.title')} className="mt-4">
      <div className="flex flex-col gap-3">
        <CodeBlock language="modelfile" code={modelfile} />
        <p className="text-sm text-text">
          {t('modelfile.savedTo')} <span className="font-mono text-text-muted">{path}</span>
        </p>
        <p className="text-sm text-text-muted">
          {t('modelfile.usage')} <code className="font-mono text-text">ollama create {name} -f {path}</code>
        </p>
      </div>
    </Card>
  )
}
