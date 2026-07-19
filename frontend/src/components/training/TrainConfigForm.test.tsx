import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderWithProviders } from '../../test/render'
import { ToastProvider } from '../common/Toast'
import { TrainConfigForm } from './TrainConfigForm'
import { DEFAULT_TRAINING_CONFIG } from './defaults'
import {
  ftpoDataset,
  grpoDataset,
  importConfigHandler,
  importConfigInvalidHandler,
  makeRunSummary,
  splitDataset,
  trainingHandlers,
  trainModel,
} from '../../test/handlers/training'

function renderForm(onCreated = vi.fn()) {
  server.use(...trainingHandlers)
  const result = renderWithProviders(
    <ToastProvider>
      <TrainConfigForm onCreated={onCreated} />
    </ToastProvider>,
  )
  return { onCreated, ...result }
}

async function waitForPickersLoaded() {
  await waitFor(() => expect(screen.getByText(trainModel.model_id)).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText(/my-chat-data/)).toBeInTheDocument())
}

describe('TrainConfigForm', () => {
  it('only lists datasets that have splits', async () => {
    renderForm()
    await waitForPickersLoaded()
    expect(screen.queryByText(/no-splits-yet/)).not.toBeInTheDocument()
  })

  it('shows the LoRA section for train_type=lora and hides it for train_type=full', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    expect(screen.getByLabelText('Rank')).toBeInTheDocument()
    expect(screen.getByLabelText('Scale')).toBeInTheDocument()
    expect(screen.getByLabelText('Dropout')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Train type'), 'full')

    expect(screen.queryByLabelText('Rank')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Scale')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Dropout')).not.toBeInTheDocument()
  })

  it('enables all train modes (Faz 2 — T15)', async () => {
    renderForm()
    await waitForPickersLoaded()

    expect(screen.getByRole('radio', { name: 'SFT' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'DPO' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'ORPO' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'CPO' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'GRPO' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'FTPO' })).toBeEnabled()
  })

  it('shows no Preference/RL section for sft, a Beta field for dpo/orpo/cpo with the preset default', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    expect(screen.queryByLabelText('Beta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Group size')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'DPO' }))
    expect(screen.getByLabelText('Beta')).toHaveValue(0.1)
    expect(screen.queryByLabelText('Group size')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'ORPO' }))
    expect(screen.getByLabelText('Beta')).toHaveValue(0.1)

    await user.click(screen.getByRole('radio', { name: 'CPO' }))
    expect(screen.getByLabelText('Beta')).toHaveValue(0.1)

    await user.click(screen.getByRole('radio', { name: 'SFT' }))
    expect(screen.queryByLabelText('Beta')).not.toBeInTheDocument()
  })

  it('shows group_size/temperature/max_completion_length fields with preset defaults for grpo', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))

    expect(screen.getByLabelText('Group size')).toHaveValue(4)
    expect(screen.getByLabelText('Temperature')).toHaveValue(0.8)
    expect(screen.getByLabelText('Max completion length')).toHaveValue(512)
    expect(screen.queryByLabelText('Beta')).not.toBeInTheDocument()
  })

  it('shows the five grpo reward-function checkboxes, all unchecked by default', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    expect(screen.queryByText('Reward functions')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))

    expect(screen.getByText('Reward functions')).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(5)
    for (const name of [
      /r1_accuracy_reward_func/,
      /r1_int_reward_func/,
      /r1_strict_format_reward_func/,
      /r1_soft_format_reward_func/,
      /r1_count_xml/,
    ]) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
    }
    expect(screen.getByText('None selected → library default (all five).')).toBeInTheDocument()
  })

  it('submits reward_functions: null for grpo when no reward function is checked', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))
    await user.type(screen.getByLabelText('Run name'), 'my-grpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-grpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({
      train_mode: 'grpo',
      dataset_id: grpoDataset.dataset_id,
      reward_functions: null,
    })
  })

  it('submits exactly the checked reward functions in registry order, not click order', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))
    // Click in reverse registry order — the submitted array must still be
    // registry-ordered (accuracy before count_xml).
    await user.click(screen.getByRole('checkbox', { name: /r1_count_xml/ }))
    await user.click(screen.getByRole('checkbox', { name: /r1_accuracy_reward_func/ }))

    await user.type(screen.getByLabelText('Run name'), 'my-grpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-grpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({
      train_mode: 'grpo',
      reward_functions: ['r1_accuracy_reward_func', 'r1_count_xml'],
    })
  })

  it('unchecking the last reward function goes back to submitting null', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))
    await user.click(screen.getByRole('checkbox', { name: /r1_int_reward_func/ }))
    await user.click(screen.getByRole('checkbox', { name: /r1_int_reward_func/ }))

    await user.type(screen.getByLabelText('Run name'), 'my-grpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-grpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({ reward_functions: null })
  })

  it('clears the reward-function selection when switching grpo → sft (submits null)', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'GRPO' }))
    await user.click(screen.getByRole('checkbox', { name: /r1_accuracy_reward_func/ }))
    await user.click(screen.getByRole('checkbox', { name: /r1_soft_format_reward_func/ }))

    await user.click(screen.getByRole('radio', { name: 'SFT' }))
    expect(screen.queryByText('Reward functions')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Run name'), 'back-to-sft')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({ train_mode: 'sft', reward_functions: null })
  })

  it('blocks submit with a beta error when beta is cleared for dpo', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    await user.type(screen.getByLabelText('Run name'), 'my-dpo-run')
    await user.click(screen.getByRole('radio', { name: 'DPO' }))
    await user.clear(screen.getByLabelText('Beta'))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    expect(await screen.findByText('Beta is required for dpo/orpo/cpo.')).toBeInTheDocument()
  })

  it('blocks submit with a group_size error when group_size is cleared for grpo', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    await user.type(screen.getByLabelText('Run name'), 'my-grpo-run')
    await user.click(screen.getByRole('radio', { name: 'GRPO' }))
    await user.clear(screen.getByLabelText('Group size'))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    expect(await screen.findByText('Group size is required for grpo.')).toBeInTheDocument()
  })

  it('surfaces a dataset-format compatibility error when the selected dataset does not match the mode', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/datasets', () =>
        HttpResponse.json({
          datasets: [
            splitDataset, // format: chat — compatible with sft only
          ],
        }),
      ),
    )
    renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('radio', { name: 'DPO' }))

    expect(
      await screen.findByText(
        'Dataset format "chat" is not compatible with mode "dpo". Needs: dpo.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the SFT loss select only for sft and submits sft_loss_type "dft" when chosen', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    // Defaults to the empty option (null → library default nll).
    expect(screen.getByLabelText('SFT loss')).toHaveValue('')

    await user.click(screen.getByRole('radio', { name: 'DPO' }))
    expect(screen.queryByLabelText('SFT loss')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'SFT' }))
    await user.selectOptions(screen.getByLabelText('SFT loss'), 'dft')

    await user.type(screen.getByLabelText('Run name'), 'my-dft-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({ train_mode: 'sft', sft_loss_type: 'dft' })
  })

  it('never submits sft_loss_type for a non-sft mode, even after picking a loss in sft', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.selectOptions(screen.getByLabelText('SFT loss'), 'dft')
    await user.click(screen.getByRole('radio', { name: 'FTPO' }))

    await user.type(screen.getByLabelText('Run name'), 'my-ftpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-ftpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({ train_mode: 'ftpo', sft_loss_type: null })
  })

  it('shows the four ftpo hyperparameter fields for ftpo and submits typed values', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'FTPO' }))

    // All four start empty (null → library defaults) and no other
    // preference/RL fields leak in.
    expect(screen.getByLabelText('Lambda MSE target')).toHaveValue(null)
    expect(screen.getByLabelText('Tau MSE target')).toHaveValue(null)
    expect(screen.getByLabelText('Lambda MSE')).toHaveValue(null)
    expect(screen.getByLabelText('Clip epsilon (logits)')).toHaveValue(null)
    expect(screen.queryByLabelText('Beta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Group size')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Lambda MSE target'), '0.1')
    await user.type(screen.getByLabelText('Tau MSE target'), '2')
    await user.type(screen.getByLabelText('Lambda MSE'), '0.5')
    await user.type(screen.getByLabelText('Clip epsilon (logits)'), '3')

    await user.type(screen.getByLabelText('Run name'), 'my-ftpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-ftpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({
      train_mode: 'ftpo',
      lambda_mse_target: 0.1,
      tau_mse_target: 2,
      lambda_mse: 0.5,
      clip_epsilon_logits: 3,
    })
  })

  it('submits null ftpo hyperparameters when the fields are left empty', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'FTPO' }))
    await user.type(screen.getByLabelText('Run name'), 'my-ftpo-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-ftpo-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toEqual({
      ...DEFAULT_TRAINING_CONFIG,
      name: 'my-ftpo-run',
      model_id: trainModel.model_id,
      dataset_id: ftpoDataset.dataset_id,
      train_mode: 'ftpo',
    })
  })

  it('clears ftpo hyperparameters when switching from ftpo back to sft', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: 'FTPO' }))
    await user.type(screen.getByLabelText('Lambda MSE target'), '0.9')
    await user.type(screen.getByLabelText('Clip epsilon (logits)'), '5')

    await user.click(screen.getByRole('radio', { name: 'SFT' }))
    expect(screen.queryByLabelText('Lambda MSE target')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Clip epsilon (logits)')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Run name'), 'back-to-sft')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toMatchObject({
      train_mode: 'sft',
      lambda_mse_target: null,
      tau_mse_target: null,
      lambda_mse: null,
      clip_epsilon_logits: null,
    })
  })

  it('surfaces a dataset-format compatibility error when a chat dataset is selected for ftpo', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForPickersLoaded()

    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('radio', { name: 'FTPO' }))

    expect(
      await screen.findByText(
        'Dataset format "chat" is not compatible with mode "ftpo". Needs: ftpo.',
      ),
    ).toBeInTheDocument()

    // Picking the ftpo-format dataset resolves the error.
    await user.click(screen.getByRole('radio', { name: /my-ftpo-data/ }))
    expect(
      screen.queryByText('Dataset format "chat" is not compatible with mode "ftpo". Needs: ftpo.'),
    ).not.toBeInTheDocument()
  })

  it('blocks submit and surfaces field errors when required fields are missing', async () => {
    let posted = false
    server.use(
      http.post('/api/v1/train/jobs', () => {
        posted = true
        return HttpResponse.json(makeRunSummary(), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Start training' }))

    expect(await screen.findByText('Run name is required.')).toBeInTheDocument()
    expect(screen.getByText('Select a model.')).toBeInTheDocument()
    expect(screen.getByText('Select a dataset with splits.')).toBeInTheDocument()
    expect(posted).toBe(false)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('submits the exact TrainingConfig shape on a valid submit', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/train/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(makeRunSummary({ run_id: 'run_captured' }), { status: 201 })
      }),
    )
    const { onCreated } = renderForm()
    await waitForPickersLoaded()

    await user.type(screen.getByLabelText('Run name'), 'my-test-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('run_captured'))
    expect(capturedBody).toEqual({
      ...DEFAULT_TRAINING_CONFIG,
      name: 'my-test-run',
      model_id: trainModel.model_id,
      dataset_id: splitDataset.dataset_id,
    })
  })

  it('shows an error with a retry action when GET /models fails, and retry recovers', async () => {
    const user = userEvent.setup()
    let modelCalls = 0
    server.use(
      ...trainingHandlers,
      http.get('/api/v1/models', () => {
        modelCalls += 1
        if (modelCalls === 1) {
          return HttpResponse.json(
            { error: { code: 'internal', message: 'boom', detail: {} } },
            { status: 500 },
          )
        }
        return HttpResponse.json({ models: [trainModel] })
      }),
    )
    renderWithProviders(
      <ToastProvider>
        <TrainConfigForm onCreated={vi.fn()} />
      </ToastProvider>,
    )

    expect(await screen.findByText('Failed to load local models.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText(trainModel.model_id)).toBeInTheDocument())
    expect(screen.queryByText('Failed to load local models.')).not.toBeInTheDocument()
    expect(modelCalls).toBe(2)
  })

  it('shows an error with a retry action when GET /datasets fails, and retry recovers', async () => {
    const user = userEvent.setup()
    let datasetCalls = 0
    // NOTE: no trainingHandlers here — its GET /datasets handler would win
    // over this override (first-registered-in-call matches first in MSW).
    server.use(
      http.get('/api/v1/datasets', () => {
        datasetCalls += 1
        if (datasetCalls === 1) {
          return HttpResponse.json(
            { error: { code: 'internal', message: 'boom', detail: {} } },
            { status: 500 },
          )
        }
        return HttpResponse.json({ datasets: [splitDataset] })
      }),
    )
    renderWithProviders(
      <ToastProvider>
        <TrainConfigForm onCreated={vi.fn()} />
      </ToastProvider>,
    )

    expect(await screen.findByText('Failed to load datasets.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText(/my-chat-data/)).toBeInTheDocument())
    expect(screen.queryByText('Failed to load datasets.')).not.toBeInTheDocument()
    expect(datasetCalls).toBe(2)
  })

  it('shows a toast when the backend reports 409 training_active', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/v1/train/jobs', () =>
        HttpResponse.json(
          { error: { code: 'training_active', message: 'A job is already running', detail: {} } },
          { status: 409 },
        ),
      ),
    )
    renderForm()
    await waitForPickersLoaded()

    await user.type(screen.getByLabelText('Run name'), 'my-test-run')
    await user.click(screen.getByRole('radio', { name: new RegExp(trainModel.model_id) }))
    await user.click(screen.getByRole('radio', { name: /my-chat-data/ }))
    await user.click(screen.getByRole('button', { name: 'Start training' }))

    expect(await screen.findByText('A training job is already queued or running.')).toBeInTheDocument()
  })

  it('Load YAML: choosing a file prefills the form from the imported config', async () => {
    const user = userEvent.setup()
    const imported = {
      ...DEFAULT_TRAINING_CONFIG,
      name: 'imported-run',
      model_id: trainModel.model_id,
      dataset_id: grpoDataset.dataset_id,
      train_mode: 'grpo' as const,
      iters: 4321,
      group_size: 8,
      temperature: 0.7,
      max_completion_length: 256,
      reward_functions: ['r1_accuracy_reward_func', 'r1_count_xml'],
    }
    server.use(importConfigHandler(imported))
    renderForm()
    await waitForPickersLoaded()

    const file = new File(['config_schema: 1\nconfig: {}\n'], 'run.yaml', {
      type: 'application/x-yaml',
    })
    await user.upload(screen.getByLabelText('Training config YAML file'), file)

    await waitFor(() => expect(screen.getByDisplayValue('imported-run')).toBeInTheDocument())
    expect(screen.getByDisplayValue('4321')).toBeInTheDocument()
    // The imported grpo mode drives the conditional section + checkbox state.
    expect(screen.getByRole('radio', { name: 'GRPO' })).toBeChecked()
    expect(screen.getByLabelText('Group size')).toHaveValue(8)
    expect(screen.getByRole('checkbox', { name: /r1_accuracy_reward_func/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /r1_count_xml/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /r1_int_reward_func/ })).not.toBeChecked()
    expect(await screen.findByText('Config loaded from YAML.')).toBeInTheDocument()
  })

  it('Load YAML: surfaces the backend 422 message naming the offending keys', async () => {
    const user = userEvent.setup()
    server.use(importConfigInvalidHandler("unknown key(s) under config: 'learning_rte'"))
    renderForm()
    await waitForPickersLoaded()

    const file = new File(['config:\n  learning_rte: 1\n'], 'bad.yaml')
    await user.upload(screen.getByLabelText('Training config YAML file'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "unknown key(s) under config: 'learning_rte'",
    )
    // The form keeps its previous values.
    expect(screen.getByLabelText('Run name')).toHaveValue('')
  })
})
