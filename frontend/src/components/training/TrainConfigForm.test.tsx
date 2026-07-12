import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderWithProviders } from '../../test/render'
import { ToastProvider } from '../common/Toast'
import { TrainConfigForm } from './TrainConfigForm'
import { DEFAULT_TRAINING_CONFIG } from './defaults'
import { makeRunSummary, splitDataset, trainingHandlers, trainModel } from '../../test/handlers/training'

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
})
