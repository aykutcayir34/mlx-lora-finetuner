import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { Table, type TableColumn } from '../common/Table'
import { useValidateDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'
import type { LineIssue } from '../../api/types'

interface ValidationReportViewProps {
  datasetId: string
}

export function ValidationReportView({ datasetId }: ValidationReportViewProps) {
  const { t } = useTranslation('datasets')
  const validate = useValidateDataset()
  const report = validate.data

  const issueColumns: TableColumn<LineIssue>[] = [
    {
      key: 'line',
      header: t('validation.columns.line'),
      className: 'w-20',
      render: (issue) => issue.line,
    },
    { key: 'message', header: t('validation.columns.message'), render: (issue) => issue.message },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" onClick={() => validate.mutate(datasetId)} loading={validate.isPending}>
        {t('validation.run')}
      </Button>

      {validate.isError && (
        <p className="text-sm text-danger">
          {validate.error instanceof ApiError ? validate.error.message : t('validation.failed')}
        </p>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            <Trans
              t={t}
              i18nKey="validation.rowsValid"
              values={{ valid: report.valid_rows, total: report.total_rows }}
              components={[<span key="valid" className="font-semibold" />]}
            />
          </p>

          {report.errors.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('validation.errors')}
              </h4>
              <Table
                columns={issueColumns}
                data={report.errors}
                rowKey={(issue) => `error-${issue.line}-${issue.message}`}
              />
            </div>
          )}

          {report.warnings.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('validation.warnings')}
              </h4>
              <Table
                columns={issueColumns}
                data={report.warnings}
                rowKey={(issue) => `warning-${issue.line}-${issue.message}`}
              />
            </div>
          )}

          {report.errors.length === 0 && report.warnings.length === 0 && (
            <p className="text-sm text-success">{t('validation.noIssues')}</p>
          )}
        </div>
      )}
    </div>
  )
}
