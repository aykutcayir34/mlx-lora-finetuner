import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useArtifacts, useOllamaModelfile } from '../../api/queries/export'
import { queryKeys } from '../../api/queries/keys'
import type { OllamaModelFamily } from '../../api/types'
import { Card } from '../common/Card'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Button } from '../common/Button'
import { useToast } from '../common/Toast'
import { ModelfilePreview } from './ModelfilePreview'

type SourceMode = 'gguf' | 'manual'

export function OllamaWizard() {
  const { t } = useTranslation('export')
  const artifacts = useArtifacts()

  // Family names are proper nouns; only "Custom" is translated.
  const familyOptions: { value: OllamaModelFamily; label: string }[] = [
    { value: 'qwen', label: 'Qwen' },
    { value: 'llama', label: 'Llama' },
    { value: 'smollm', label: 'SmolLM' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'custom', label: t('ollama.familyCustom') },
  ]
  const ollamaModelfile = useOllamaModelfile()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [sourceMode, setSourceMode] = useState<SourceMode>('gguf')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [modelFamily, setModelFamily] = useState<OllamaModelFamily>('qwen')
  const [customTemplate, setCustomTemplate] = useState('')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)

  const ggufArtifacts = (artifacts.data?.artifacts ?? []).filter((a) => a.kind === 'gguf')
  const ggufPath = sourceMode === 'gguf' ? selectedArtifactPath : manualPath.trim()

  const needsTemplate = modelFamily === 'custom'
  const templateMissing = needsTemplate && customTemplate.trim().length === 0
  const canSubmit = ggufPath.length > 0 && name.trim().length > 0 && !templateMissing

  function handleSubmit() {
    setTouched(true)
    if (!canSubmit) return
    ollamaModelfile.mutate(
      {
        gguf_path: ggufPath,
        model_family: modelFamily,
        name: name.trim(),
        custom_template: needsTemplate ? customTemplate.trim() : null,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.export.artifacts })
          toast(t('ollama.created'), { variant: 'success' })
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : t('ollama.createFailed'), {
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <Card title={t('ollama.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceMode === 'gguf' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('gguf')}
          >
            {t('ollama.fromGguf')}
          </Button>
          <Button
            type="button"
            variant={sourceMode === 'manual' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('manual')}
          >
            {t('manualPath')}
          </Button>
        </div>

        {sourceMode === 'gguf' ? (
          <Field
            label={t('ollama.ggufFile')}
            hint={ggufArtifacts.length === 0 ? t('ollama.noGguf') : undefined}
          >
            <Select
              value={selectedArtifactPath}
              onChange={(e) => setSelectedArtifactPath(e.target.value)}
              options={[
                { value: '', label: t('ollama.selectGguf') },
                ...ggufArtifacts.map((a) => ({ value: a.path, label: a.path })),
              ]}
            />
          </Field>
        ) : (
          <Field label={t('ollama.ggufPath')}>
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder={t('ollama.ggufPathPlaceholder')}
            />
          </Field>
        )}

        <Field label={t('ollama.modelFamily')}>
          <Select
            value={modelFamily}
            onChange={(e) => setModelFamily(e.target.value as OllamaModelFamily)}
            options={familyOptions}
          />
        </Field>

        {needsTemplate && (
          <Field
            label={t('ollama.customTemplate')}
            error={touched && templateMissing ? t('ollama.templateRequired') : undefined}
          >
            <textarea
              value={customTemplate}
              onChange={(e) => setCustomTemplate(e.target.value)}
              rows={6}
              className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="{{ .System }}..."
            />
          </Field>
        )}

        <Field label={t('ollama.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ollama.namePlaceholder')} />
        </Field>

        <div>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={touched && !canSubmit}
            loading={ollamaModelfile.isPending}
          >
            {t('ollama.submit')}
          </Button>
        </div>

        {ollamaModelfile.data && (
          <ModelfilePreview
            modelfile={ollamaModelfile.data.modelfile}
            path={ollamaModelfile.data.path}
            name={name.trim()}
          />
        )}
      </div>
    </Card>
  )
}
