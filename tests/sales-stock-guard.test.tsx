import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SalesManagement from '@/components/sales-management'
import { cloneSeed, type Order, type Sale } from '@/lib/erp'
import type { UserAccount } from '@/lib/user-api'

const salesApi = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listBakeryOrderCatalog: vi.fn(),
  listSalesOwners: vi.fn(),
}))

vi.mock('@/lib/user-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/user-api')>()
  return {
    ...actual,
    listOrders: salesApi.listOrders,
    listBakeryOrderCatalog: salesApi.listBakeryOrderCatalog,
    listSalesOwners: salesApi.listSalesOwners,
  }
})

const manager: UserAccount = {
  id: 'sales-manager-1',
  name: 'Sales Manager',
  email: 'sales@example.test',
  roles: ['Sales Manager'],
  status: 'Active',
  createdAt: '2026-10-01T00:00:00.000Z',
  mustChangePassword: false,
}

const product = {
  id: 'product-1',
  familyId: 'family-1',
  familyName: 'Sourdough',
  sku: 'SD-LOAF',
  name: 'Sourdough loaf',
  saleUnit: 'loaf',
  unitsPerSaleUnit: 1,
  price: 24000,
  availableQuantity: 0,
}

function renderSales(mode: 'sales' | 'credit' = 'sales', state = cloneSeed()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SalesManagement
        mode={mode}
        state={state}
        currentUser={manager}
        salesLoading={false}
        salesError=""
        onRetrySales={vi.fn()}
        onSaleUpdated={vi.fn()}
        companyName="ANLI"
        companyLogoUrl=""
        customersAvailable
        onRetryCustomers={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

function pendingOrder(id: string, createdAt: string, priority: Order['priority'] = 'Normal'): Order {
  return {
    id,
    reference: `ORD-${id}`,
    date: '2026-10-28',
    createdAt,
    customer: `Customer ${id}`,
    customerId: `CUSTOMER-${id}`,
    items: [],
    total: 24000,
    requestedDate: '2026-10-30',
    fulfilmentMethod: 'Pickup',
    destination: '',
    paymentTerms: 'Same-day',
    status: 'Pending',
    statusHistory: [],
    priority,
    priorityReason: priority === 'High' ? 'Urgent' : '',
    notes: '',
    paidAmount: 0,
    reserved: false,
  }
}

function creditSale(): Sale {
  return {
    id: 'credit-sale-1',
    date: '2026-10-28',
    customer: 'Saved customer',
    customerId: 'customer-1',
    product: 'Mango juice',
    quantity: 1,
    total: 24000,
    status: 'Pending',
    method: 'Cash',
    paymentTerms: 'Credit',
    reference: 'SAL-2026-000001',
    receiptNumber: 'SAL-2026-000001',
    dueDate: '',
    creditNeedsReview: true,
    lines: [],
  }
}

describe('sales stock guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    salesApi.listOrders.mockResolvedValue([])
    salesApi.listSalesOwners.mockResolvedValue([])
  })

  afterEach(() => cleanup())

  it('shows a no-stock warning and disables sale completion when no product is available', async () => {
    salesApi.listBakeryOrderCatalog.mockResolvedValue([product])
    renderSales()

    fireEvent.click(screen.getByRole('button', { name: /add sale/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Record sale' })

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => /no sellable stock available/i.test(alert.textContent ?? ''))).toBe(true)
    expect((screen.getByRole('button', { name: 'Complete sale' }) as HTMLButtonElement).disabled).toBe(true)
    expect(dialog).toBeTruthy()
  })

  it('blocks quantities above available stock and enables a valid quantity', async () => {
    salesApi.listBakeryOrderCatalog.mockResolvedValue([{ ...product, availableQuantity: 2 }])
    renderSales()
    fireEvent.click(screen.getByRole('button', { name: /add sale/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Record sale' })
    await screen.findByRole('option', { name: /Sourdough loaf/ })
    const productSelect = dialog.querySelector('select')
    expect(productSelect).not.toBeNull()
    fireEvent.change(productSelect!, { target: { value: 'product-1' } })
    expect((productSelect as HTMLSelectElement).value).toBe('product-1')
    expect(dialog.textContent).toContain('SKU SD-LOAF · Available: 2 loaf')
    expect(dialog.textContent).not.toContain('Sales bonus')
    expect(screen.getByLabelText('Quantity (loaf)')).toBeTruthy()
    const quantity = dialog.querySelector('input[type="number"]')
    expect(quantity).not.toBeNull()
    const submit = screen.getByRole('button', { name: 'Complete sale' })

    fireEvent.change(quantity!, { target: { value: '3' } })
    await waitFor(() => expect(
      screen.getAllByRole('alert').some((alert) => /exceeds available stock/i.test(alert.textContent ?? '')),
    ).toBe(true))
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(quantity!, { target: { value: '2' } })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  })

  it('shows only one pending order and prioritizes a high-priority order', async () => {
    salesApi.listBakeryOrderCatalog.mockResolvedValue([])
    salesApi.listOrders.mockResolvedValue([
      pendingOrder('oldest', '2026-10-20T08:00:00.000Z'),
      pendingOrder('normal', '2026-10-28T08:00:00.000Z'),
      pendingOrder('urgent', '2026-10-29T08:00:00.000Z', 'High'),
    ])
    renderSales()

    const orders = await screen.findByRole('list', { name: 'Pending order requiring attention' })
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy())
    expect(orders.querySelectorAll('li')).toHaveLength(1)
    expect(orders.textContent).toContain('ORD-urgent')
    expect(orders.textContent).toContain('High priority')
    expect(orders.textContent).not.toContain('ORD-oldest')
  })

  it('shows the oldest pending order when none has high priority', async () => {
    salesApi.listBakeryOrderCatalog.mockResolvedValue([])
    salesApi.listOrders.mockResolvedValue([
      pendingOrder('newer', '2026-10-28T08:00:00.000Z'),
      pendingOrder('oldest', '2026-10-20T08:00:00.000Z'),
    ])
    renderSales()

    const orders = await screen.findByRole('list', { name: 'Pending order requiring attention' })
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
    expect(orders.querySelectorAll('li')).toHaveLength(1)
    expect(orders.textContent).toContain('ORD-oldest')
    expect(orders.textContent).not.toContain('ORD-newer')
  })

  it('groups credit sale history actions in a three-dot menu that closes outside', async () => {
    const sale = creditSale()
    const state = { ...cloneSeed(), sales: [sale] }
    renderSales('credit', state)

    fireEvent.click(await screen.findByRole('button', { name: `Actions for credit sale ${sale.reference}` }))

    const menu = screen.getByRole('menu', { name: `Actions for credit sale ${sale.reference}` })
    expect(menu).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'View receipt' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Review credit details' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Record payment' })).toBeTruthy()

    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu', { name: `Actions for credit sale ${sale.reference}` })).toBeNull())
  })
})
