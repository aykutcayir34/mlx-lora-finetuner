import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen } from '../../test/render'
import { server } from '../../test/server'
import { exportHandlers } from '../../test/handlers/export'
import { OllamaWizard } from './OllamaWizard'
import { ToastProvider } from '../common/Toast'

function renderWizard() {
  return renderWithProviders(
    <ToastProvider>
      <OllamaWizard />
    </ToastProvider>,
  )
}

function sourceSelect() {
  return screen.getAllByRole('combobox')[0]
}

function familySelect() {
  return screen.getAllByRole('combobox')[1]
}

describe('OllamaWizard', () => {
  it('requires a custom template before submitting when family is custom', async () => {
    server.use(...exportHandlers)
    let called = false
    server.use(
      http.post('/api/v1/export/ollama-modelfile', () => {
        called = true
        return HttpResponse.json({ modelfile: 'FROM x', path: '/abs/Modelfile' })
      }),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: '/abs/exports/my-model.gguf' })
    await user.selectOptions(sourceSelect(), '/abs/exports/my-model.gguf')
    await user.selectOptions(familySelect(), 'custom')
    await user.type(screen.getByPlaceholderText('my-model'), 'my-ollama-model')

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('Custom family requires a template.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('renders the returned modelfile preview on success', async () => {
    server.use(...exportHandlers)

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: '/abs/exports/my-model.gguf' })
    await user.selectOptions(sourceSelect(), '/abs/exports/my-model.gguf')
    await user.type(screen.getByPlaceholderText('my-model'), 'my-ollama-model')

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText(/FROM \/abs\/exports\/my-model\.gguf/)).toBeInTheDocument()
    expect(screen.getByText('/abs/exports/Modelfile')).toBeInTheDocument()
    expect(screen.getByText(/ollama create/)).toHaveTextContent(
      'ollama create my-ollama-model -f /abs/exports/Modelfile',
    )
  })
})
