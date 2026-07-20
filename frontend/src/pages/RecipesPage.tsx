import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { PageShell } from '../components/layout/PageShell'
import { ToastProvider, useToast } from '../components/common/Toast'
import { RecipeUploadForm } from '../components/recipes/RecipeUploadForm'
import { RecipeJobProgress } from '../components/recipes/RecipeJobProgress'
import { queryKeys } from '../api/queries/keys'

function RecipesPageContent() {
  const { t } = useTranslation('recipes')
  const [job, setJob] = useState<{ id: string; name: string } | undefined>(undefined)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return (
    <PageShell title={t('page.title')} description={t('page.description')}>
      <RecipeUploadForm onJobStarted={(id, name) => setJob({ id, name })} />

      <RecipeJobProgress
        jobId={job?.id}
        datasetName={job?.name}
        onSettled={(settledJob) => {
          if (settledJob.status === 'completed') {
            queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
            toast(t('toasts.completed'), { variant: 'success' })
          } else if (settledJob.status === 'failed') {
            toast(settledJob.error ?? t('toasts.failed'), { variant: 'error' })
          }
        }}
      />
    </PageShell>
  )
}

export function RecipesPage() {
  return (
    <ToastProvider>
      <RecipesPageContent />
    </ToastProvider>
  )
}
