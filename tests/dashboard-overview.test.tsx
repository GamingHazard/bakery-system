import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DashboardOverview from '@/components/dashboard-overview'
import type { UserRole } from '@/lib/user-api'

const dashboardApi = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  listBakeryProductFamilies: vi.fn(),
  listFinishedStockLots: vi.fn(),
}))

vi.mock('@/lib/user-api', () => ({
  getDashboardSummary: dashboardApi.getDashboardSummary,
  listBakeryProductFamilies: dashboardApi.listBakeryProductFamilies,
  listFinishedStockLots: dashboardApi.listFinishedStockLots,
}))

const summary = {
  version: 1,
  range: { from: '2026-10-18', to: '2026-10-24', timeZone: 'Africa/Kampala' },
  generatedAt: '2026-10-24T08:00:00.000Z',
  sections: {
    sales: {
      status: 'available',
      revenue: 1_200_000,
      collected: 900_000,
      outstanding: 300_000,
      overdueReceivables: 2,
      trend: [{ date: '2026-10-24', revenue: 1_200_000, collected: 900_000 }],
      products: [{ name: 'Maize flour', revenue: 700_000 }],
    },
    orders: {
      status: 'available',
      open: 4,
      late: 1,
      highPriority: 2,
      byStatus: [{ status: 'Pending', count: 4 }],
    },
    production: {
      status: 'available',
      produced: 120,
      damaged: 3,
      trend: [{ date: '2026-10-24', produced: 120, damaged: 3 }],
    },
    inventory: { status: 'available', activeLowStock: 1 },
    expenses: {
      status: 'available',
      total: 500_000,
      pendingApproval: 2,
      trend: [{ date: '2026-10-24', amount: 500_000 }],
    },
  },
}

function renderDashboard(
  roles: readonly UserRole[] = ['General Manager'],
  failFinishedStockLots = false,
) {
  dashboardApi.listBakeryProductFamilies.mockResolvedValue({
    families: [
      {
        id: 'family-1',
        active: true,
        storefront: { published: true },
        variants: [
          { id: 'sku-1', active: true, price: 1000, lowStockThreshold: 10 },
          { id: 'sku-2', active: false, price: 1500, lowStockThreshold: 10 },
        ],
      },
      {
        id: 'family-2',
        active: false,
        storefront: { published: false },
        variants: [{ id: 'sku-3', active: true, price: 1500, lowStockThreshold: 10 }],
      },
    ],
  })
  if (failFinishedStockLots) {
    dashboardApi.listFinishedStockLots.mockRejectedValue(new Error('offline'))
  } else {
    dashboardApi.listFinishedStockLots.mockResolvedValue({
      lots: [{ variantId: 'sku-1', status: 'active', remainingQuantity: 8 }],
    })
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const onNavigate = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <DashboardOverview
        companyName="ANLI"
        companyLogoUrl=""
        userName="Ada User"
        roles={roles}
        onNavigate={onNavigate}
        onExportSales={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { ...view, onNavigate }
}

describe('live dashboard overview', () => {
  afterEach(() => {
    cleanup()
    dashboardApi.getDashboardSummary.mockReset()
    dashboardApi.listBakeryProductFamilies.mockReset()
    dashboardApi.listFinishedStockLots.mockReset()
  })

  it('renders live role-authorized KPIs and actionable exceptions', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    renderDashboard()

    expect(await screen.findByText('Sales revenue')).toBeTruthy()
    expect(screen.getByText('Open orders')).toBeTruthy()
    expect(screen.getAllByText('Production output').length).toBeGreaterThan(0)
    expect(await screen.findByText('Finished-product inventory')).toBeTruthy()
    expect(screen.getByText('Low stock')).toBeTruthy()
    expect(screen.getByText('Out of stock')).toBeTruthy()
    expect(screen.getByText('Available families')).toBeTruthy()
    expect(screen.getByText('Product catalog')).toBeTruthy()
    expect(screen.getByText('Product status').parentElement?.textContent).toContain('1 active · 1 inactive')
    expect(screen.getByText('Storefront').parentElement?.textContent).toContain('1 published · 1 unpublished')
    expect(screen.getByText('Approved expenses')).toBeTruthy()
    expect(screen.getByText('1 late orders')).toBeTruthy()
    expect(screen.getByText('1 low-stock materials')).toBeTruthy()
    expect(dashboardApi.getDashboardSummary).toHaveBeenCalled()
  })

  it('navigates directly to finished stock from the inventory summary', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    const { onNavigate } = renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: /View finished stock/ }))
    expect(onNavigate).toHaveBeenCalledWith('Finished stock')
  })

  it('shows an explicit inventory error instead of zero-valued fallback metrics', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    renderDashboard(['General Manager'], true)

    expect(await screen.findByText('Finished-product inventory could not be loaded.')).toBeTruthy()
  })

  it('changes the selected date range and fetches fresh dashboard data', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    renderDashboard()
    await screen.findByText('Sales revenue')
    const initialFrom = dashboardApi.getDashboardSummary.mock.calls.at(-1)?.[0]

    fireEvent.change(screen.getByLabelText('Dashboard date range'), { target: { value: '30d' } })
    await waitFor(() => {
      expect(dashboardApi.getDashboardSummary.mock.calls.some(([from]) => from !== initialFrom)).toBe(true)
    })
  })

  it('filters only the sales KPI by its own period', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    renderDashboard()
    await screen.findByText('Sales revenue')

    fireEvent.click(screen.getByRole('button', { name: 'Sales period: Today' }))
    expect(screen.getByRole('menuitem', { name: 'This week' })).toBeTruthy()

    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const today = `${todayParts.find(({ type }) => type === 'year')?.value}-${todayParts.find(({ type }) => type === 'month')?.value}-${todayParts.find(({ type }) => type === 'day')?.value}`
    const monday = new Date(`${today}T00:00:00.000Z`)
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)

    fireEvent.click(screen.getByRole('menuitem', { name: 'This week' }))
    await waitFor(() => {
      expect(dashboardApi.getDashboardSummary.mock.calls.some(
        ([from, to]) => from === weekStart && to === today,
      )).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sales period: This week' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'This month' }))
    await waitFor(() => {
      expect(dashboardApi.getDashboardSummary.mock.calls.some(
        ([from, to]) => from === `${today.slice(0, 7)}-01` && to === today,
      )).toBe(true)
    })
    expect(screen.getByRole('button', { name: 'Sales period: This month' })).toBeTruthy()
    expect((screen.getByLabelText('Dashboard date range') as HTMLSelectElement).value).toBe('7d')
  })

  it('renders only the HR aggregates returned for an HR account', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue({
      ...summary,
      sections: {
        people: {
          status: 'available',
          recordedAttendance: 8,
          pendingLeave: 1,
          attendanceByStatus: [{ status: 'Present', count: 8 }],
        },
      },
    })
    renderDashboard(['Human Resource'])

    expect(await screen.findByText('Attendance records')).toBeTruthy()
    expect(screen.getByText('People operations')).toBeTruthy()
    expect(screen.queryByText('Sales revenue')).toBeNull()
    expect(screen.queryByText('Approved expenses')).toBeNull()
  })

  it('shows a retryable error instead of displaying failed data as zero', async () => {
    dashboardApi.getDashboardSummary.mockRejectedValue(new Error('offline'))
    renderDashboard()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Dashboard data could not be loaded.')).toBeTruthy()
  })

  it('keeps the last successful snapshot visible if a refresh fails', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(summary)
    renderDashboard()
    expect(await screen.findByText('Sales revenue')).toBeTruthy()
    await screen.findByText(/Collected/)

    dashboardApi.getDashboardSummary.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard data' }))
    expect(await screen.findByText(/showing the last successful dashboard snapshot/i)).toBeTruthy()
    expect(screen.getByText('Sales revenue')).toBeTruthy()
  })
})
