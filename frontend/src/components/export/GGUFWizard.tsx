import { useState } from 'react'
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
            toast('Eğitim aktifken export yapılamaz. Eğitim bitince tekrar deneyin.', {
              variant: 'error',
            })
            return
          }
          toast(error instanceof Error ? error.message : 'GGUF dönüşümü başlatılamadı.', {
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <Card title="Convert fused model to GGUF">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceMode === 'fused' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('fused')}
          >
            From fused artifact
          </Button>
          <Button
            type="button"
            variant={sourceMode === 'manual' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('manual')}
          >
            Manual path
          </Button>
        </div>

        {sourceMode === 'fused' ? (
          <Field
            label="Fused model"
            hint={fusedArtifacts.length === 0 ? 'No fused artifacts found.' : undefined}
          >
            <Select
              value={selectedArtifactPath}
              onChange={(e) => setSelectedArtifactPath(e.target.value)}
              options={[
                { value: '', label: 'Select a fused model…' },
                ...fusedArtifacts.map((a) => ({ value: a.path, label: a.path })),
              ]}
            />
          </Field>
        ) : (
          <Field label="Fused model path">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/abs/path/to/fused"
            />
          </Field>
        )}

        {modelPath.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-text">Preflight checks</span>
            {preflight.isLoading && <span className="text-sm text-text-muted">Checking…</span>}
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

        <Field label="Outtype">
          <Select
            value={outtype}
            onChange={(e) => setOuttype(e.target.value as GGUFOuttype)}
            options={OUTTYPE_OPTIONS}
          />
        </Field>

        <Field label="Output name">
          <Input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="my-model"
          />
        </Field>

        <div>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} loading={gguf.isPending}>
            Convert
          </Button>
        </div>

        <JobProgressPanel
          exportId={exportId}
          onSettled={(job) => {
            if (job.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: queryKeys.export.artifacts })
              toast('GGUF dönüşümü tamamlandı.', { variant: 'success' })
            } else if (job.status === 'failed') {
              toast(job.error ?? 'GGUF dönüşümü başarısız oldu.', { variant: 'error' })
            }
          }}
        />
      </div>
    </Card>
  )
}
