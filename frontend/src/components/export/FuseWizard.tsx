import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  const adapters = useAdapters()
  const fuse = useFuse()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [sourceMode, setSourceMode] = useState<SourceMode>('adapter')
  const [selectedAdapterPath, setSelectedAdapterPath] = useState('')
  const [modelId, setModelId] = useState('')
  const [adapterPath, setAdapterPath] = useState('')
  const [outputName, setOutputName] = useState('')
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
          toast('Eğitim aktifken export yapılamaz. Eğitim bitince tekrar deneyin.', {
            variant: 'error',
          })
          return
        }
        toast(error instanceof Error ? error.message : 'Fuse işlemi başlatılamadı.', {
          variant: 'error',
        })
      },
    })
  }

  return (
    <Card title="Fuse adapter into base model">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceMode === 'adapter' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSourceMode('adapter')}
          >
            From adapter
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

        {sourceMode === 'adapter' ? (
          <Field label="Adapter" hint={adapterList.length === 0 ? 'No adapters found.' : undefined}>
            <Select
              value={selectedAdapterPath}
              onChange={(e) => setSelectedAdapterPath(e.target.value)}
              options={[
                { value: '', label: 'Select an adapter…' },
                ...adapterList.map((a) => ({
                  value: a.adapter_path,
                  label: `${a.name} — ${a.base_model_id}`,
                })),
              ]}
            />
          </Field>
        ) : (
          <>
            <Field label="Base model id">
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="mlx-community/SmolLM-135M-Instruct-4bit"
              />
            </Field>
            <Field label="Adapter path">
              <Input
                value={adapterPath}
                onChange={(e) => setAdapterPath(e.target.value)}
                placeholder="/abs/path/to/adapters"
              />
            </Field>
          </>
        )}

        <Field label="Output name">
          <Input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="my-model"
          />
        </Field>

        <Switch
          checked={deQuantize}
          onChange={setDeQuantize}
          label="De-quantize"
        />
        <p className="-mt-2 text-xs text-text-muted">
          GGUF'a çevirecekseniz zorunlu — quantize base modeller aksi halde dönüştürülemez
        </p>

        <div>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={fuse.isPending}
          >
            Fuse
          </Button>
        </div>

        <JobProgressPanel
          exportId={exportId}
          onSettled={(job) => {
            if (job.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: queryKeys.export.artifacts })
              toast('Fuse tamamlandı.', { variant: 'success' })
            } else if (job.status === 'failed') {
              toast(job.error ?? 'Fuse başarısız oldu.', { variant: 'error' })
            }
          }}
        />
      </div>
    </Card>
  )
}
