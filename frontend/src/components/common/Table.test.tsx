import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Table, type TableColumn } from './Table'

interface Row {
  id: string
  name: string
}

const columns: TableColumn<Row>[] = [{ key: 'name', header: 'Name', render: (row) => row.name }]

describe('Table', () => {
  it('renders typed rows', () => {
    const data: Row[] = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]

    render(<Table columns={columns} data={data} rowKey={(row) => row.id} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows the empty message when there is no data', () => {
    render(
      <Table columns={columns} data={[]} rowKey={(row) => row.id} emptyMessage="Nothing here" />,
    )

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})
