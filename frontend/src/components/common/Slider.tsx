import type { InputHTMLAttributes } from 'react'

interface SliderProps extends InputHTMLAttributes<HTMLInputElement> {
  showValue?: boolean
}

export function Slider({ showValue = false, className = '', value, ...rest }: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        value={value}
        className={`h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-raised accent-accent ${className}`}
        {...rest}
      />
      {showValue && <span className="w-10 text-right text-xs text-text-muted">{value}</span>}
    </div>
  )
}
