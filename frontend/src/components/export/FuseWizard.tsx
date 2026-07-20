import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { parseFuseCheckpointNavState } from '../../routes'
import { useAdapters } from '../../api/queries/adapters'
import { useFuse } from '../../api/queries/export'
import { queryKeys } from '../../api/queries/keys'
import { ApiError } from '../../api/client'
import type { FuseRequest } from '../../api/types'
import { Card } from '../common/Card'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Switch } from '../common/Switch'
import { Button } from '../common/Button'
import { useToast } from '../common/Toast'
import { JobProgressPanel } from './JobProgressPanel'

type SourceMode = 'adapter' | 'manual'

export function FuseWizard() {
  const { t } = useTranslation('export')
  const location = useLocation()
  const adapters = useAdapters()
  const fuse = useFuse()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Optional checkpoint payload from the RunMonitor "Fuse" action: prefills
  // the manual model_id+adapter_path source. Absent state changes nothing.
  const [checkpointNav] = useState(() => parseFuseCheckpointNavState(location.state))

  const [sourceMode, setSourceMode] = useState<SourceMode>(checkpointNav ? 'manual' : 'adapter')
  const [selectedAdapterPath, setSelectedAdapterPath] = useState('')
  const [modelId, setModelId] = useState(checkpointNav?.model_id ?? '')
  const [adapterPath, setAdapterPath] = useState(checkpointNav?.adapter_path ?? '')
  const [outputName, setOutputName] = useState(checkpointNav?.suggested_name ?? '')
  const [deQuantize, setDeQuantize] = useState(false)
  const [exportId, setExportId] = useState<string | undefined>(undefined)

  const adapterList = adapters.data?.adapters ?? []
  const selectedAdapter = adapterList.find((a) => a.adapter_path === selectedAdapterPath)

  const canSubmit =
    outputName.trim().length > 0 &&
    (sourceMode === 'adapter'
      ? !!selectedAdapter
      : modelId.trim().length > 0 && adapterPath.trim().length > 0)

  function buildBody(): FuseRequest | null {
    if (outputName.trim().length === 0) return null
    if (sourceMode === 'adapter') {
      if (!selectedAdapter) return null
      if (selectedAdapter.run_id) {
        return {
          run_id: selectedAdapter.run_id,
          de_quantize: deQuantize,
          output_name: outputName.trim(),
        }
      }
      return {
        model_id: selectedAdapter.base_model_id,
        adapter_path: selectedAdapter.adapter_path,
        de_quantize: deQuantize,
        output_name: outputName.trim(),
      }
    }
    if (modelId.trim().length === 0 || adapterPath.trim().length === 0) return null
    return {
      model_id: modelId.trim(),
      adapter_path: adapterPath.trim(),
      de_quantize: deQuantize,
      output_name: outputName.trim(),
    }
  }

  function handleSubmit() {
    const body = buildBody()
    if (!body) return
    fuse.mutate(body, {
      onSuccess: (data) => {
        setExportId(data.export_id)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'training_active') {
          toast(t('trainingActive'), { variant: 'error' })
          return
        }
        toast(error instanceof Error ? error.message : t('fuse.startFailed'), {
          variant: 'error',
        })
      },
    })
  }

  return (
    <Card title={t('fuse.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceMode === 'adapter' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('adapter')}
          >
            {t('fuse.fromAdapter')}
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

        {sourceMode === 'adapter' ? (
          <Field
            label={t('fuse.adapter')}
            hint={adapterList.length === 0 ? t('fuse.noAdapters') : undefined}
          >
            <Select
              value={selectedAdapterPath}
              onChange={(e) => setSelectedAdapterPath(e.target.value)}
              options={[
                { value: '', label: t('fuse.selectAdapter') },
                ...adapterList.map((a) => ({
                  value: a.adapter_path,
                  label: `${a.name} — ${a.base_model_id}`,
                })),
              ]}
            />
          </Field>
        ) : (
          <>
            <Field label={t('fuse.baseModelId')}>
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={t('fuse.baseModelPlaceholder')}
              />
            </Field>
            <Field label={t('fuse.adapterPath')}>
              <Input
                value={adapterPath}
                onChange={(e) => setAdapterPath(e.target.value)}
                placeholder={t('fuse.adapterPathPlaceholder')}
              />
            </Field>
          </>
        )}

        <Field label={t('fuse.outputName')}>
          <Input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder={t('fuse.outputNamePlaceholder')}
          />
        </Field>

        <Switch
          checked={deQuantize}
          onChange={setDeQuantize}
          label={t('fuse.deQuantize')}
        />
        <p className="-mt-2 text-xs text-text-muted">{t('fuse.deQuantizeHint')}</p>

        <div>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={fuse.isPending}
          >
            {t('fuse.submit')}
          </Button>
        </div>

        <JobProgressPanel
          exportId={exportId}
          onSettled={(job) => {
            if (job.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: queryKeys.export.artifacts })
              toast(t('fuse.completed'), { variant: 'success' })
            } else if (job.status === 'failed') {
              toast(job.error ?? t('fuse.failed'), { variant: 'error' })
            }
          }}
        />
      </div>
    </Card>
  )
}
