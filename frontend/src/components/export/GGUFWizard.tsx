import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useArtifacts, useGguf, useGgufPreflight } from '../../api/queries/export'
import { queryKeys } from '../../api/queries/keys'
import { ApiError } from '../../api/client'
import type { GGUFOuttype } from '../../api/types'
import { Card } from '../common/Card'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Button } from '../common/Button'
import { useToast } from '../common/Toast'
import { JobProgressPanel } from './JobProgressPanel'

type SourceMode = 'fused' | 'manual'

const OUTTYPE_OPTIONS: { value: GGUFOuttype; label: string }[] = [
  { value: 'f16', label: 'f16' },
  { value: 'q8_0', label: 'q8_0' },
]

export function GGUFWizard() {
  const { t } = useTranslation('export')
  const artifacts = useArtifacts()
  const gguf = useGguf()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [sourceMode, setSourceMode] = useState<SourceMode>('fused')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [outtype, setOuttype] = useState<GGUFOuttype>('f16')
  const [outputName, setOutputName] = useState('')
  const [exportId, setExportId] = useState<string | undefined>(undefined)

  const fusedArtifacts = (artifacts.data?.artifacts ?? []).filter((a) => a.kind === 'fused')
  const modelPath = sourceMode === 'fused' ? selectedArtifactPath : manualPath.trim()

  const preflight = useGgufPreflight(modelPath)

  const preflightOk = preflight.data?.ok === true
  const canSubmit = modelPath.length > 0 && outputName.trim().length > 0 && preflightOk

  function handleSubmit() {
    if (!canSubmit) return
    gguf.mutate(
      { model_path: modelPath, outtype, output_name: outputName.trim() },
      {
        onSuccess: (data) => {
          setExportId(data.export_id)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'training_active') {
            toast(t('trainingActive'), { variant: 'error' })
            return
          }
          toast(error instanceof Error ? error.message : t('gguf.startFailed'), {
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <Card title={t('gguf.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceMode === 'fused' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('fused')}
          >
            {t('gguf.fromArtifact')}
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

        {sourceMode === 'fused' ? (
          <Field
            label={t('gguf.fusedModel')}
            hint={fusedArtifacts.length === 0 ? t('gguf.noFused') : undefined}
          >
            <Select
              value={selectedArtifactPath}
              onChange={(e) => setSelectedArtifactPath(e.target.value)}
              options={[
                { value: '', label: t('gguf.selectFused') },
                ...fusedArtifacts.map((a) => ({ value: a.path, label: a.path })),
              ]}
            />
          </Field>
        ) : (
          <Field label={t('gguf.fusedPath')}>
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder={t('gguf.fusedPathPlaceholder')}
            />
          </Field>
        )}

        {modelPath.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-text">{t('gguf.preflight')}</span>
            {preflight.isLoading && <span className="text-sm text-text-muted">{t('gguf.checking')}</span>}
            {preflight.data?.checks.map((check) => (
              <div key={check.name} className="flex items-start gap-2 text-sm">
                <span className={check.ok ? 'text-success' : 'text-danger'} aria-hidden="true">
                  {check.ok ? '✓' : '✗'}
                </span>
                <span className={check.ok ? 'text-text' : 'text-danger'}>{check.message}</span>
              </div>
            ))}
          </div>
        )}

        <Field label={t('gguf.outtype')}>
          <Select
            value={outtype}
            onChange={(e) => setOuttype(e.target.value as GGUFOuttype)}
            options={OUTTYPE_OPTIONS}
          />
        </Field>

        <Field label={t('gguf.outputName')}>
          <Input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder={t('gguf.outputNamePlaceholder')}
          />
        </Field>

        <div>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} loading={gguf.isPending}>
            {t('gguf.submit')}
          </Button>
        </div>

        <JobProgressPanel
          exportId={exportId}
          onSettled={(job) => {
            if (job.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: queryKeys.export.artifacts })
              toast(t('gguf.completed'), { variant: 'success' })
            } else if (job.status === 'failed') {
              toast(job.error ?? t('gguf.failed'), { variant: 'error' })
            }
          }}
        />
      </div>
    </Card>
  )
}
