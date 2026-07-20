import { useTranslation } from 'react-i18next'

export type SpinnerSize = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: SpinnerSize
  className?: string
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const { t } = useTranslation('common')
  return (
    <span
      role="status"
      aria-label={t('loading')}
      className={`inline-block animate-spin rounded-full border-current border-t-transparent text-accent ${SIZE_CLASSES[size]} ${className}`}
    />
  )
}
