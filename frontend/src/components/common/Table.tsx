import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface TableColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  data: T[]
  rowKey: (row: T) => string
  emptyMessage?: string
}

export function Table<T>({ columns, data, rowKey, emptyMessage }: TableProps<T>) {
  const { t } = useTranslation('common')
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border text-text-muted">
          {columns.map((column) => (
            <th key={column.key} className={`px-3 py-2 font-medium ${column.className ?? ''}`}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-3 py-8 text-center text-text-muted">
              {emptyMessage ?? t('table.noData')}
            </td>
          </tr>
        ) : (
          data.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border/60 text-text hover:bg-surface-raised"
            >
              {columns.map((column) => (
                <td key={column.key} className={`px-3 py-2 ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
