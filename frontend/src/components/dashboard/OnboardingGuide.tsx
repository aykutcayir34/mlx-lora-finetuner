import { Link } from 'react-router-dom'
import { Card } from '../common/Card'

const STEPS = [
  {
    step: 1,
    title: 'Model indir',
    description: 'Hugging Face üzerinden bir MLX modeli indir.',
    to: '/models',
    cta: 'Modellere git',
  },
  {
    step: 2,
    title: 'Dataset yükle',
    description: 'Eğitim için bir .jsonl dataset yükle.',
    to: '/datasets',
    cta: 'Datasetlere git',
  },
  {
    step: 3,
    title: 'Eğitimi başlat',
    description: 'Model ve dataseti seçip LoRA fine-tuning başlat.',
    to: '/train',
    cta: 'Eğitime git',
  },
] as const

export function OnboardingGuide() {
  return (
    <Card title="Başlarken">
      <p className="mb-4 text-sm text-text-muted">
        Henüz indirilmiş bir model veya eğitim işi yok. Başlamak için aşağıdaki üç adımı takip et.
      </p>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((item) => (
          <li key={item.step} className="rounded-lg border border-border bg-surface-raised p-4">
            <span className="text-xs font-medium text-text-muted">Adım {item.step}</span>
            <h4 className="mt-1 text-sm font-semibold text-text">{item.title}</h4>
            <p className="mt-1 text-xs text-text-muted">{item.description}</p>
            <Link to={item.to} className="mt-3 inline-block text-sm text-accent hover:underline">
              {item.cta}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}
