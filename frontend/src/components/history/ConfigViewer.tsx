import { useState } from 'react'
import { Button } from '../common/Button'
import { CodeBlock } from '../common/CodeBlock'
import { formatConfigValue } from './format'
import type { TrainingConfig } from '../../api/types'

interface ConfigGroup {
  title: string
  rows: [string, unknown][]
}

function buildGroups(config: TrainingConfig): ConfigGroup[] {
  return [
    {
      title: 'General',
      rows: [
        ['name', config.name],
        ['model_id', config.model_id],
        ['dataset_id', config.dataset_id],
        ['train_mode', config.train_mode],
        ['train_type', config.train_type],
      ],
    },
    {
      title: 'Training',
      rows: [
        ['batch_size', config.batch_size],
        ['iters', config.iters],
        ['learning_rate', config.learning_rate],
        ['max_seq_length', config.max_seq_length],
        ['num_layers', config.num_layers],
        ['optimizer', config.optimizer],
        ['lr_schedule', config.lr_schedule],
        ['load_in_bits', config.load_in_bits],
        ['grad_checkpoint', config.grad_checkpoint],
        ['seed', config.seed],
      ],
    },
    {
      title: 'LoRA',
      rows: [
        ['lora.rank', config.lora.rank],
        ['lora.scale', config.lora.scale],
        ['lora.dropout', config.lora.dropout],
      ],
    },
    {
      title: 'Checkpointing & eval',
      rows: [
        ['save_every', config.save_every],
        ['steps_per_report', config.steps_per_report],
        ['steps_per_eval', config.steps_per_eval],
        ['val_batches', config.val_batches],
      ],
    },
    {
      title: 'Mode-specific',
      rows: [
        ['beta', config.beta],
        ['group_size', config.group_size],
        ['temperature', config.temperature],
        ['max_completion_length', config.max_completion_length],
        ['reward_functions', config.reward_functions],
        ['sft_loss_type', config.sft_loss_type],
        ['lambda_mse_target', config.lambda_mse_target],
        ['tau_mse_target', config.tau_mse_target],
        ['lambda_mse', config.lambda_mse],
        ['clip_epsilon_logits', config.clip_epsilon_logits],
      ],
    },
  ]
}

interface ConfigViewerProps {
  config: TrainingConfig
}

export function ConfigViewer({ config }: ConfigViewerProps) {
  const [showJson, setShowJson] = useState(false)
  const groups = buildGroups(config)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setShowJson((value) => !value)}>
          {showJson ? 'Show grouped view' : 'Show JSON'}
        </Button>
      </div>
      {showJson ? (
        <CodeBlock code={JSON.stringify(config, null, 2)} language="json" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.title} className="rounded-lg border border-border p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {group.title}
              </h4>
              <dl className="flex flex-col gap-1">
                {group.rows.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 text-sm">
                    <dt className="text-text-muted">{key}</dt>
                    <dd className="text-right font-medium text-text">{formatConfigValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
