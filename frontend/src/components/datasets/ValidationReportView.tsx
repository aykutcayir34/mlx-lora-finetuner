import { Button } from '../common/Button'
import { Table, type TableColumn } from '../common/Table'
import { useValidateDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'
import type { LineIssue } from '../../api/types'

interface ValidationReportViewProps {
  datasetId: string
}

const ISSUE_COLUMNS: TableColumn<LineIssue>[] = [
  { key: 'line', header: 'Line', className: 'w-20', render: (issue) => issue.line },
  { key: 'message', header: 'Message', render: (issue) => issue.message },
]

export function ValidationReportView({ datasetId }: ValidationReportViewProps) {
  const validate = useValidateDataset()
  const report = validate.data

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" onClick={() => validate.mutate(datasetId)} loading={validate.isPending}>
        Run validation
      </Button>

      {validate.isError && (
        <p className="text-sm text-danger">
          {validate.error instanceof ApiError ? validate.error.message : 'Validation failed.'}
        </p>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            <span className="font-semibold">{report.valid_rows}</span> / {report.total_rows} rows valid
          </p>

          {report.errors.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Errors</h4>
              <Table
                columns={ISSUE_COLUMNS}
                data={report.errors}
                rowKey={(issue) => `error-${issue.line}-${issue.message}`}
              />
            </div>
          )}

          {report.warnings.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Warnings</h4>
              <Table
                columns={ISSUE_COLUMNS}
                data={report.warnings}
                rowKey={(issue) => `warning-${issue.line}-${issue.message}`}
              />
            </div>
          )}

          {report.errors.length === 0 && report.warnings.length === 0 && (
            <p className="text-sm text-success">No issues found.</p>
          )}
        </div>
      )}
    </div>
  )
}
