interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}: SwitchProps) {
  return (
    <label
      className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'} ${className}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-surface-raised'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  )
}
