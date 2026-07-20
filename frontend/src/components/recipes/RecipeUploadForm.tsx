import { useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvertRecipe } from '../../api/queries/recipes'
import { ApiError } from '../../api/client'
import type { RecipeOutputFormat } from '../../api/types'
import { Button } from '../common/Button'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { useToast } from '../common/Toast'

export type RecipeFileKind = 'doc' | 'csv'

const DOC_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']
const CSV_EXTENSION = '.csv'
const ACCEPTED_EXTENSIONS = [...DOC_EXTENSIONS, CSV_EXTENSION]

export function detectFileKind(filename: string): RecipeFileKind | null {
  const dot = filename.toLowerCase().lastIndexOf('.')
  if (dot === -1) return null
  const ext = filename.toLowerCase().slice(dot)
  if (DOC_EXTENSIONS.includes(ext)) return 'doc'
  if (ext === CSV_EXTENSION) return 'csv'
  return null
}

interface RecipeUploadFormProps {
  onJobStarted: (jobId: string, datasetName: string) => void
}

/** Upload dropzone + conversion form for the Data Recipes page. The visible
 * fields depend on the detected file kind: doc types (pdf/docx/txt/md) show
 * chunk_size/chunk_overlap; csv shows column mapping + optional system prompt. */
export function RecipeUploadForm({ onJobStarted }: RecipeUploadFormProps) {
  const { t } = useTranslation('recipes')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [name, setName] = useState('')
  const [outputFormat, setOutputFormat] = useState<RecipeOutputFormat>('text')
  const [chunkSize, setChunkSize] = useState('2000')
  const [chunkOverlap, setChunkOverlap] = useState('200')
  const [promptColumn, setPromptColumn] = useState('')
  const [completionColumn, setCompletionColumn] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const convert = useConvertRecipe()
  const { toast } = useToast()

  const fileKind = file ? detectFileKind(file.name) : null
  const formatOptions =
    fileKind === 'csv'
      ? [
          { value: 'completions', label: t('form.formatOptions.completions') },
          { value: 'chat', label: t('form.formatOptions.chat') },
        ]
      : [{ value: 'text', label: t('form.formatOptions.text') }]

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (!picked) return
    setFile(picked)
    setErrorMessage(null)
    const kind = detectFileKind(picked.name)
    setOutputFormat(kind === 'csv' ? 'completions' : 'text')
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    handleFiles(event.dataTransfer.files)
  }

  const canSubmit =
    !!file &&
    !!fileKind &&
    name.trim().length > 0 &&
    (fileKind === 'doc' || (promptColumn.trim().length > 0 && completionColumn.trim().length > 0))

  function handleSubmit() {
    if (!file || !fileKind) return
    setErrorMessage(null)

    convert.mutate(
      {
        file,
        name: name.trim(),
        output_format: outputFormat,
        ...(fileKind === 'doc'
          ? { chunk_size: Number(chunkSize), chunk_overlap: Number(chunkOverlap) }
          : {
              prompt_column: promptColumn.trim(),
              completion_column: completionColumn.trim(),
              system_prompt: systemPrompt.trim() || undefined,
            }),
      },
      {
        onSuccess: (data) => {
          toast(t('toasts.started', { name: data.name }), { variant: 'success' })
          onJobStarted(data.recipe_job_id, data.name)
        },
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : t('toasts.startFailed')
          setErrorMessage(message)
          toast(message, { variant: 'error' })
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors ${
          dragActive ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        <p className="text-text">{file ? file.name : t('form.dropzone')}</p>
        <p className="text-xs text-text-muted">{t('form.formats')}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
          aria-label={t('form.fileAria')}
        />
      </div>

      {file && !fileKind && (
        <p role="alert" className="text-xs text-danger">
          {t('form.unsupported')}
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-danger">
          {errorMessage}
        </p>
      )}

      <Field label={t('form.datasetName')} htmlFor="recipe-name">
        <Input
          id="recipe-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('form.namePlaceholder')}
        />
      </Field>

      <Field label={t('form.outputFormat')} htmlFor="recipe-output-format">
        <Select
          id="recipe-output-format"
          value={outputFormat}
          onChange={(event) => setOutputFormat(event.target.value as RecipeOutputFormat)}
          options={formatOptions}
        />
      </Field>

      {fileKind === 'doc' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('form.chunkSize')} htmlFor="recipe-chunk-size">
            <Input
              id="recipe-chunk-size"
              type="number"
              value={chunkSize}
              onChange={(event) => setChunkSize(event.target.value)}
            />
          </Field>
          <Field label={t('form.chunkOverlap')} htmlFor="recipe-chunk-overlap">
            <Input
              id="recipe-chunk-overlap"
              type="number"
              value={chunkOverlap}
              onChange={(event) => setChunkOverlap(event.target.value)}
            />
          </Field>
        </div>
      )}

      {fileKind === 'csv' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('form.promptColumn')} htmlFor="recipe-prompt-column">
              <Input
                id="recipe-prompt-column"
                value={promptColumn}
                onChange={(event) => setPromptColumn(event.target.value)}
                placeholder={t('form.promptPlaceholder')}
              />
            </Field>
            <Field label={t('form.completionColumn')} htmlFor="recipe-completion-column">
              <Input
                id="recipe-completion-column"
                value={completionColumn}
                onChange={(event) => setCompletionColumn(event.target.value)}
                placeholder={t('form.completionPlaceholder')}
              />
            </Field>
          </div>
          {outputFormat === 'chat' && (
            <Field label={t('form.systemPrompt')} htmlFor="recipe-system-prompt">
              <Input
                id="recipe-system-prompt"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder={t('form.systemPromptPlaceholder')}
              />
            </Field>
          )}
        </>
      )}

      <div>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit} loading={convert.isPending}>
          {t('form.submit')}
        </Button>
      </div>
    </div>
  )
}
