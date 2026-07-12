import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageShell } from '../components/layout/PageShell'
import { ToastProvider, useToast } from '../components/common/Toast'
import { RecipeUploadForm } from '../components/recipes/RecipeUploadForm'
import { RecipeJobProgress } from '../components/recipes/RecipeJobProgress'
import { queryKeys } from '../api/queries/keys'

function RecipesPageContent() {
  const [job, setJob] = useState<{ id: string; name: string } | undefined>(undefined)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return (
    <PageShell title="Recipes" description="Convert documents into training datasets.">
      <RecipeUploadForm onJobStarted={(id, name) => setJob({ id, name })} />

      <RecipeJobProgress
        jobId={job?.id}
        datasetName={job?.name}
        onSettled={(settledJob) => {
          if (settledJob.status === 'completed') {
            queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
            toast('Conversion completed — dataset is ready on the Datasets page.', {
              variant: 'success',
            })
          } else if (settledJob.status === 'failed') {
            toast(settledJob.error ?? 'Conversion failed.', { variant: 'error' })
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
