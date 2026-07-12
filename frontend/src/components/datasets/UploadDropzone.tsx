import { useRef, useState, type DragEvent } from 'react'
import { Button } from '../common/Button'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { useToast } from '../common/Toast'
import { useUploadDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'

export function UploadDropzone() {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadDataset()
  const { toast } = useToast()

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (picked) {
      setFile(picked)
      setErrorMessage(null)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    handleFiles(event.dataTransfer.files)
  }

  function handleUpload() {
    if (!file) return
    setErrorMessage(null)
    upload.mutate(
      { file, name: name.trim() || undefined },
      {
        onSuccess: (dataset) => {
          toast(`Uploaded "${dataset.name}".`, { variant: 'success' })
          setFile(null)
          setName('')
          if (inputRef.current) inputRef.current.value = ''
        },
        onError: (error) => {
          const message = error instanceof ApiError ? error.message : 'Upload failed.'
          setErrorMessage(message)
          toast(message, { variant: 'error' })
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
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
        <p className="text-text">{file ? file.name : 'Drag & drop a .jsonl file here, or click to choose'}</p>
        <p className="text-xs text-text-muted">JSON Lines (.jsonl)</p>
        <input
          ref={inputRef}
          type="file"
          accept=".jsonl"
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
          aria-label="Dataset file"
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-xs text-danger">
          {errorMessage}
        </p>
      )}

      <Field label="Name (optional)" htmlFor="dataset-upload-name">
        <Input
          id="dataset-upload-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-dataset"
        />
      </Field>

      <Button onClick={handleUpload} disabled={!file} loading={upload.isPending} className="self-start">
        Upload dataset
      </Button>
    </div>
  )
}
