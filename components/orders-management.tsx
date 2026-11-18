'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Check, ChevronLeft, ChevronRight, CircleX, ClipboardList, Download, Ellipsis, Eye, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'
import { createId, exportCsv, formatDate, money, type ErpState, type Order, type OrderStatus, type Sale, type SalePayment } from '@/lib/erp'
import { archiveOrder, changeOrderStatus, confirmOrder, createOrder, fulfillOrder, getOrderDetails, listBakeryOrderCatalog, listBakeryPreorderDemand, listOrders, recordOrderPayment, restoreOrder, updateOrder, type BakeryOrderCatalogItem, type OrderInput, type OrderPaymentRecord, type UserAccount } from '@/lib/user-api'
import { canCreateOrders } from '@/lib/authorization'

type Props = {
  state: ErpState
  currentUser: UserAccount
  customersLoaded: boolean
  customersApiLoaded: boolean
  customerLoadError: string
  onRetryCustomers: () => void
  onStateChange: (next: ErpState) => void
}

type OrderPaymentDraft = { amount: string; date: string; method: SalePayment['method']; txnID: string; note: string }
type DraftLine = { key: string; variantId: string; quantity: string; price: string; reason: string }
const methods: SalePayment['method'][] = ['Cash', 'Mobile Money', 'Bank Transfer', 'Check', 'Card']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const message = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'

function OrderEditor({ order, state, currentUser, customersLoaded, customersApiLoaded, customerLoadError, onRetryCustomers, onSave, onClose }: {
  order?: Order
  state: ErpState
  currentUser: UserAccount
  customersLoaded: boolean
  customersApiLoaded: boolean
  customerLoadError: string
  onRetryCustomers: () => void
  onSave: (input: OrderInput) => Promise<void>
  onClose: () => void
}) {
  const [bakeryProducts, setBakeryProducts] = useState<BakeryOrderCatalogItem[]>([])
  const [productsError, setProductsError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState(order?.customerId || '')
  const [requestedDate, setRequestedDate] = useState(order?.requestedDate || today())
  const [fulfillmentMode, setFulfillmentMode] = useState<NonNullable<OrderInput['fulfillmentMode']>>(order?.fulfillmentMode || 'bakery_stock')
  const [fulfilmentMethod, setFulfilmentMethod] = useState<'Delivery' | 'Pickup'>(order?.fulfilmentMethod || 'Delivery')
  const [destination, setDestination] = useState(order?.destination || '')
  const [paymentTerms, setPaymentTerms] = useState<OrderInput['paymentTerms']>(order?.paymentTerms || 'Same-day')
  const [dueDate, setDueDate] = useState(order?.dueDate || '')
  const [priority, setPriority] = useState<'Normal' | 'High'>(order?.priority || 'Normal')
  const [priorityReason, setPriorityReason] = useState(order?.priorityReason || '')
  const [notes, setNotes] = useState(order?.notes || '')
  const [lines, setLines] = useState<DraftLine[]>(order?.items.length
    ? order.items.map((item, index) => ({ key: item.id || String(index), variantId: item.variantId || '', quantity: String(item.quantity), price: String(item.unitPrice), reason: item.overrideReason || '' }))
    : [{ key: createId('LINE'), variantId: '', quantity: '1', price: '', reason: '' }])
  const idempotencyKey = useRef(createId('ORDER'))
  const canOverride = currentUser.roles.some((role) => ['Sales Manager', 'General Manager', 'Super Admin'].includes(role))
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * Number(line.price || 0), 0)

  useEffect(() => {
    let mounted = true
    listBakeryOrderCatalog().then((records) => {
      if (mounted) setBakeryProducts(records)
    }).catch((caught: unknown) => {
      if (mounted) setProductsError(message(caught))
    })
    return () => { mounted = false }
  }, [])

  const selectProduct = (key: string, variantId: string) => {
    const product = bakeryProducts.find((item) => item.id === variantId)
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, variantId, price: product ? String(product.price) : '', reason: '' }
      : line))
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!customersApiLoaded || !state.customers.some((customer) => customer.id === customerId && customer.status === 'Active' && !customer.archivedAt)) {
      setError('Choose an active customer profile loaded from the server.')
      return
    }
    try {
      const items = lines.map((line) => {
        const product = bakeryProducts.find((item) => item.id === line.variantId)
        if (!product) throw new Error('Select a valid active catalog product for every line.')
        const quantity = Number(line.quantity)
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Enter a positive whole-number quantity for every product.')
        const price = Number(line.price)
        if (!Number.isSafeInteger(price) || price < 1) throw new Error('Enter a positive whole-UGX price per sale unit.')
        if (price !== product.price && !line.reason.trim()) throw new Error(`Add a reason for overriding ${product.name}'s catalog price.`)
        return {
          variantId: product.id,
          packs: quantity,
          ...(price !== product.price ? { pricePerPack: price, overrideReason: line.reason.trim() } : {}),
        }
      })
      setBusy(true)
      await onSave({
        customerId,
        items,
        requestedDate,
        fulfillmentMode,
        fulfilmentMethod,
        destination,
        paymentTerms,
        dueDate: paymentTerms === 'Credit' ? dueDate : undefined,
        priority,
        priorityReason: priority === 'High' ? priorityReason : undefined,
        notes,
        idempotencyKey: order ? undefined : idempotencyKey.current,
      })
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }
  const field = 'mt-1 block min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:min-h-0'

  return <div className="fixed inset-0 z-[80] grid items-end bg-slate-950/40 sm:place-items-center sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="order-editor-title" className="max-h-[96vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[94vh] sm:rounded-xl">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 sm:px-5 sm:py-4">
        <div><h2 id="order-editor-title" className="font-bold">{order ? `Edit ${order.reference}` : 'Create order'}</h2><p className="mt-1 text-xs text-slate-500">{fulfillmentMode === 'preorder' ? 'Preorders remain pending until staff review capacity and confirm a promised date.' : 'Pending stock orders do not reserve stock until confirmed.'}</p></div>
        <button type="button" aria-label="Close order editor" onClick={onClose} disabled={busy}><X className="size-4" /></button>
      </header>
      <form onSubmit={(event) => { void submit(event) }} className="space-y-5 p-4 pb-24 sm:p-5 sm:pb-5">
        {!customersLoaded && <p role="status" className="text-sm text-slate-500">Loading saved customers…</p>}
        {!customersApiLoaded && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{customerLoadError || 'Saved customers are not available.'} <button type="button" onClick={onRetryCustomers} className="font-semibold underline">Retry loading</button></p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">Fulfillment type<select value={fulfillmentMode} onChange={(event) => {
            const nextMode = event.target.value as NonNullable<OrderInput['fulfillmentMode']>
            setFulfillmentMode(nextMode)
            setLines((current) => current.map((line) => ({ ...line, variantId: '', price: '', reason: '' })))
          }} className={field}><option value="bakery_stock">Bakery SKU from available stock</option><option value="preorder">Bakery preorder (future production)</option></select></label>
          <label className="text-xs font-semibold">Active saved customer<select required disabled={!customersApiLoaded || busy} value={customerId} onChange={(event) => setCustomerId(event.target.value)} className={field}><option value="">Choose customer</option>{state.customers.filter((customer) => customer.status === 'Active' && !customer.archivedAt).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label className="text-xs font-semibold">Requested fulfilment date<input type="date" required min={today()} value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} className={field} /></label>
        </div>
        {productsError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{productsError}</p>}
        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase text-slate-500">Products</h3><button type="button" onClick={() => setLines((current) => [...current, { key: createId('LINE'), variantId: '', quantity: '1', price: '', reason: '' }])} className="text-xs font-semibold text-primary"><Plus className="mr-1 inline size-3" />Add line</button></div>
          <div className="space-y-3">{lines.map((line, index) => {
            const product = bakeryProducts.find((item) => item.id === line.variantId)
            const unitLabel = product?.saleUnit || 'unit'
            return <div key={line.key} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_90px_140px_36px]">
              <label className="text-xs font-semibold">Product<select required value={line.variantId} onChange={(event) => selectProduct(line.key, event.target.value)} className={field}><option value="">Choose product</option>{bakeryProducts.map((item) => <option key={item.id} value={item.id}>{item.familyName} · {item.sku} · {money(item.price)}/{item.saleUnit} · {item.availableQuantity.toLocaleString()} available</option>)}</select></label>
              <label className="text-xs font-semibold">Quantity ({unitLabel})<input type="number" required min="1" step="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((draft) => draft.key === line.key ? { ...draft, quantity: event.target.value } : draft))} className={field} /></label>
              <label className="text-xs font-semibold">Price per {unitLabel}<input type="number" required min="1" step="1" value={line.price} onChange={(event) => setLines((current) => current.map((draft) => draft.key === line.key ? { ...draft, price: event.target.value } : draft))} className={field} /></label>
              <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((draft) => draft.key !== line.key))} className="self-end rounded p-2 text-slate-400 disabled:opacity-30"><X className="size-4" /></button>
              {product && Number(line.price) !== product.price && <label className="text-xs font-semibold sm:col-span-4">Price override reason<input required value={line.reason} onChange={(event) => setLines((current) => current.map((draft) => draft.key === line.key ? { ...draft, reason: event.target.value } : draft))} disabled={!canOverride} className={field} />{!canOverride && <span className="text-rose-700">You cannot override catalog pricing.</span>}</label>}
              {product && <p className="text-[11px] text-slate-500 sm:col-span-4">{product.availableQuantity.toLocaleString()} {product.saleUnit} currently available. {fulfillmentMode === 'preorder' ? 'Production capacity and the promised date are reviewed before confirmation.' : 'Lot availability and expiry are checked again when this order is confirmed.'}</p>}
            </div>
          })}</div>
          <div className="mt-3 text-right text-sm font-bold">Estimated total: {money(total)} <span className="text-xs font-normal text-slate-400">(server verifies)</span></div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">Fulfilment method<select value={fulfilmentMethod} onChange={(event) => setFulfilmentMethod(event.target.value as 'Delivery' | 'Pickup')} className={field}><option value="Delivery">Delivery</option><option value="Pickup">Pickup</option></select></label>
          <label className="text-xs font-semibold">Payment terms<select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value as OrderInput['paymentTerms'])} className={field}><option>Same-day</option><option>Paid now</option><option>Credit</option></select></label>
          {paymentTerms === 'Credit' && <label className="text-xs font-semibold">Credit due date<input type="date" required min={today()} value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={field} /></label>}
          <label className="text-xs font-semibold">{fulfilmentMethod === 'Delivery' ? 'Delivery address / instructions' : 'Pickup instructions'}<input value={destination} maxLength={500} onChange={(event) => setDestination(event.target.value)} className={field} /></label>
          <label className="text-xs font-semibold">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as 'Normal' | 'High')} className={field}><option>Normal</option><option>High</option></select></label>
          {priority === 'High' && <label className="text-xs font-semibold">Priority reason<input required value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} className={field} /></label>}
          <label className="text-xs font-semibold sm:col-span-2">Order notes<textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} className={field} /></label>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <footer className="sticky bottom-0 -mx-4 -mb-24 flex justify-end gap-2 border-t bg-white px-4 py-3 sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:px-0 sm:pt-4"><button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-lg border px-4 py-2 text-xs font-semibold sm:min-h-0">Cancel</button><button type="submit" disabled={busy || !bakeryProducts.length || !customersApiLoaded} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50 sm:min-h-0">{busy ? 'Saving…' : order ? 'Save changes' : 'Create pending order'}</button></footer>
      </form>
    </section>
  </div>
}

export default function OrdersManagement({ state, currentUser, customersLoaded, customersApiLoaded, customerLoadError, onRetryCustomers, onStateChange }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [view, setView] = useState<'open' | 'preorders' | 'completed' | 'cancelled' | 'archived'>('open')
  const [preorderDemands, setPreorderDemands] = useState<Order[]>([])
  const [preorderDemandError, setPreorderDemandError] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<Order | null | undefined>(undefined)
  const [detail, setDetail] = useState<Order | null>(null)
  const [detailPayments, setDetailPayments] = useState<OrderPaymentRecord[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const detailRequest = useRef(0)
  const [confirmingPreorder, setConfirmingPreorder] = useState<Order | null>(null)
  const [promisedDateDraft, setPromisedDateDraft] = useState('')
  const [capacityReviewNote, setCapacityReviewNote] = useState('')
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null)
  const [paymentDraft, setPaymentDraft] = useState<OrderPaymentDraft>({ amount: '', date: today(), method: 'Cash', txnID: '', note: '' })
  const [paymentError, setPaymentError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [openActionMenuFor, setOpenActionMenuFor] = useState<string | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const canCreate = canCreateOrders(currentUser.roles)
  const canManage = currentUser.roles.some((role) => ['Sales Manager', 'General Manager', 'Super Admin'].includes(role))
  const pageSize = 10

  useEffect(() => {
    if (!openActionMenuFor) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionMenuRef.current?.contains(event.target)) {
        setOpenActionMenuFor(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionMenuFor(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openActionMenuFor])

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await listOrders()
      setOrders(result)
      onStateChange({ ...state, orders: result })
      try {
        setPreorderDemands(await listBakeryPreorderDemand())
        setPreorderDemandError('')
      } catch (caught) {
        setPreorderDemandError(message(caught))
      }
    } catch (caught) {
      setLoadError(message(caught))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [attempt, currentUser.id])

  const syncOrders = (nextOrders: Order[], sale?: Sale, salePayments?: SalePayment[]) => {
    setOrders(nextOrders)
    onStateChange({
      ...state,
      orders: nextOrders,
      ...(sale ? {
        sales: [sale, ...state.sales.filter((item) => item.id !== sale.id)],
        payments: [
          ...state.payments.filter((payment) => payment.saleId !== sale.id),
          ...(salePayments || []),
        ],
      } : {}),
    })
  }
  const saveOrder = async (input: OrderInput) => {
    if (editor) {
      if (!canManage) return
      const saved = await updateOrder(editor.id, input)
      syncOrders(orders.map((item) => item.id === saved.id ? saved : item))
    } else {
      if (!canCreate) return
      const saved = await createOrder(input)
      syncOrders([saved, ...orders])
    }
    setEditor(undefined)
  }
  const perform = async (order: Order, operation: () => Promise<Order>) => {
    setBusyId(order.id)
    setError('')
    try {
      const saved = await operation()
      syncOrders(orders.map((item) => item.id === saved.id ? saved : item))
      setDetail(saved)
      if (saved.fulfillmentMode === 'preorder') await refreshPreorderDemand()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusyId('')
    }
  }
  const submitPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!paymentOrder) return
    setBusyId(paymentOrder.id)
    setPaymentError('')
    try {
      await recordOrderPayment(paymentOrder.id, {
        amount: Number(paymentDraft.amount),
        date: paymentDraft.date,
        method: paymentDraft.method,
        txnID: paymentDraft.txnID || undefined,
        note: paymentDraft.note || undefined,
        idempotencyKey: paymentKey.current,
      })
      const refreshed = await listOrders()
      syncOrders(refreshed)
      setPaymentOrder(null)
      paymentKey.current = createId('ORDER-PAY')
      setPaymentDraft({ amount: '', date: today(), method: 'Cash', txnID: '', note: '' })
    } catch (caught) {
      setPaymentError(message(caught))
    } finally {
      setBusyId('')
    }
  }
  const paymentKey = useRef(createId('ORDER-PAY'))
  const refreshPreorderDemand = async () => {
    try {
      setPreorderDemands(await listBakeryPreorderDemand())
      setPreorderDemandError('')
    } catch (caught) {
      setPreorderDemandError(message(caught))
    }
  }
  const openDetails = async (order: Order) => {
    const requestId = ++detailRequest.current
    setDetail(order)
    setDetailPayments([])
    setDetailError('')
    setDetailLoading(true)
    try {
      const result = await getOrderDetails(order.id)
      if (requestId !== detailRequest.current) return
      setDetail(result.order)
      setDetailPayments(result.payments)
    } catch (caught) {
      if (requestId === detailRequest.current) setDetailError(message(caught))
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false)
    }
  }

  const filtered = useMemo(() => orders.filter((order) => {
    const query = `${order.reference} ${order.customer} ${order.items.map((item) => item.product).join(' ')}`.toLowerCase()
    const matchesView = view === 'archived' ? Boolean(order.archivedAt)
      : Boolean(!order.archivedAt && (view === 'preorders' ? order.fulfillmentMode === 'preorder' : view === 'completed' ? order.status === 'Completed' : view === 'cancelled' ? order.status === 'Cancelled' : !['Completed', 'Cancelled'].includes(order.status)))
    return matchesView && (!statusFilter || order.status === statusFilter) &&
      (!dateFrom || order.date >= dateFrom) && (!dateTo || order.date <= dateTo) &&
      query.includes(search.toLowerCase())
  }).sort((left, right) => {
    const highPriorityFirst = view === 'open' && (left.priority === 'High') !== (right.priority === 'High')
    if (highPriorityFirst) return left.priority === 'High' ? -1 : 1
    return right.createdAt.localeCompare(left.createdAt)
  }), [orders, view, statusFilter, search, dateFrom, dateTo])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageOrders = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const activeOrders = orders.filter((order) => !order.archivedAt && !['Completed', 'Cancelled'].includes(order.status))
  const orderSummary = {
    total: orders.length,
    pending: activeOrders.filter((order) => order.status === 'Pending').length,
    inProgress: activeOrders.filter((order) => ['Confirmed', 'In progress'].includes(order.status)).length,
    ready: activeOrders.filter((order) => order.status === 'Ready').length,
    completedValue: orders.filter((order) => order.status === 'Completed')
      .reduce((sum, order) => sum + order.total, 0),
    openBalance: activeOrders.reduce((sum, order) => sum + Math.max(0, order.total - (order.paidAmount ?? 0)), 0),
  }

  if (loading) return <section role="status" className="rounded-xl border bg-white p-8 text-sm text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Loading orders from the server…</section>
  if (loadError) return <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800"><h2 className="font-semibold">Orders could not be loaded</h2><p className="mt-2">{loadError}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 rounded border px-3 py-2 text-xs font-semibold">Retry</button></section>

  const updateStatus = (order: Order, status: OrderStatus, reason = '') => perform(order, () => changeOrderStatus(order.id, status, reason))
  const beginConfirmation = (order: Order) => {
    if (order.fulfillmentMode === 'preorder') {
      setConfirmingPreorder(order)
      setPromisedDateDraft(order.requestedDate >= today() ? order.requestedDate : today())
      setCapacityReviewNote('')
      return
    }
    void perform(order, () => confirmOrder(order.id))
  }
  const confirmPreorder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!confirmingPreorder) return
    setBusyId(confirmingPreorder.id)
    setError('')
    try {
      const saved = await confirmOrder(confirmingPreorder.id, promisedDateDraft, capacityReviewNote.trim())
      syncOrders(orders.map((item) => item.id === saved.id ? saved : item))
      await refreshPreorderDemand()
      setConfirmingPreorder(null)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusyId('')
    }
  }
  const beginPayment = (order: Order) => {
    setPaymentOrder(order)
    setPaymentError('')
    setPaymentDraft({ amount: String(Math.max(0, order.total - (order.paidAmount ?? 0))), date: today(), method: 'Cash', txnID: '', note: '' })
  }
  const fulfill = async (order: Order) => {
    setBusyId(order.id)
    setError('')
    try {
      const result = await fulfillOrder(order.id)
      syncOrders(orders.map((item) => item.id === result.order.id ? result.order : item), result.sale, result.payments)
      if (result.order.fulfillmentMode === 'preorder') await refreshPreorderDemand()
      await openDetails(result.order)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusyId('')
    }
  }

  return <section className="animate-in fade-in duration-300">
    <header className="mb-5 space-y-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-3 sm:space-y-0"><div><div className="text-xs text-slate-400">Workspace / Sales Department</div><h2 className="mt-1 text-2xl font-bold">Orders</h2><p className="mt-1 text-sm text-slate-500">Confirm orders to reserve stock; fulfillment creates one sale and dispatches stock.</p></div><div className="grid grid-cols-2 gap-2 sm:flex"><button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold sm:min-h-0"><RefreshCw className="size-4" /> Refresh</button>{canCreate && <button type="button" onClick={() => setEditor(null)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground sm:min-h-0"><Plus className="size-4" /> Create order</button>}</div></header>
    {error && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <section aria-label="Order summary from backend" className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-800">Order summary</h3><span className="text-[11px] text-slate-400">Based on {orders.length} orders loaded from the server</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Total orders" value={orderSummary.total.toLocaleString()} detail="All server orders, including archived history" />
        <SummaryCard label="Pending confirmation" value={orderSummary.pending.toLocaleString()} detail="Awaiting stock reservation" />
        <SummaryCard label="In progress" value={orderSummary.inProgress.toLocaleString()} detail="Confirmed or being prepared" />
        <SummaryCard label="Ready for fulfilment" value={orderSummary.ready.toLocaleString()} detail="Reserved orders awaiting dispatch" />
        <SummaryCard label="Completed order value" value={money(orderSummary.completedValue)} detail="Fulfilled server orders; excludes legacy imports" />
        <SummaryCard label="Open order balance" value={money(orderSummary.openBalance)} detail="Unpaid balance on active orders" />
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="border-b px-4 py-3"><h3 className="text-sm font-bold text-slate-800">Order history</h3><p className="mt-1 text-xs text-slate-500">Server-saved orders with status, payment, and fulfilment history.</p></header>
      <div className="grid gap-2 border-b p-3 sm:flex sm:flex-wrap sm:items-center sm:p-4">
        <label className="flex min-h-11 items-center gap-2 rounded border px-3 py-2 sm:min-h-0 sm:min-w-48 sm:flex-1"><Search className="size-4 shrink-0 text-slate-400" /><input aria-label="Search orders" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search order, customer, product" className="min-w-0 w-full text-xs outline-none" /></label>
        <select aria-label="Filter orders by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="min-h-11 rounded border px-3 py-2 text-xs sm:min-h-0"><option value="">All statuses</option>{['Pending', 'Confirmed', 'In progress', 'Ready', 'Completed', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</select>
        <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center text-[10px] font-semibold text-slate-500 sm:flex">From<input aria-label="Orders date from" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} className="min-h-11 rounded border px-2 py-2 text-xs font-normal text-slate-700 sm:min-h-0 sm:ml-1" /></label>
        <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center text-[10px] font-semibold text-slate-500 sm:flex">To<input aria-label="Orders date to" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} className="min-h-11 rounded border px-2 py-2 text-xs font-normal text-slate-700 sm:min-h-0 sm:ml-1" /></label>
        <button type="button" disabled={!filtered.length} onClick={() => exportCsv('orders.csv', filtered.map((order) => ({
          reference: order.reference, date: order.date, requestedDate: order.requestedDate, customer: order.customer,
          products: order.items.map((item) => `${item.product} x ${item.quantity}`).join('; '), status: order.status,
          total: order.total, paid: order.paidAmount ?? 0, balance: Math.max(0, order.total - (order.paidAmount ?? 0)),
          paymentTerms: order.paymentTerms, dueDate: order.dueDate ?? '', priority: order.priority, reserved: order.reserved,
        })))} className="inline-flex min-h-11 items-center justify-center gap-1 rounded border px-3 py-2 text-xs font-semibold disabled:opacity-40 sm:min-h-0"><Download className="size-3.5" /> Export CSV</button>
      </div>
      <div className="-mx-px flex gap-1 overflow-x-auto border-b px-2 sm:px-4">{(['open', 'preorders', 'completed', 'cancelled', 'archived'] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => { setView(item); setPage(1); setStatusFilter('') }} className={`min-h-11 shrink-0 border-b-2 px-3 py-3 text-xs font-semibold capitalize sm:min-h-0 ${view === item ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>{item === 'open' ? 'Open queue' : item === 'preorders' ? `Preorders${preorderDemands.length ? ` (${preorderDemands.length})` : ''}` : item}</button>)}</div>
      {view === 'preorders' && <section aria-label="Preorder production demand" className="border-b bg-amber-50/50 p-4">
        <h3 className="text-sm font-bold text-slate-800">Production demand awaiting finished output</h3>
        <p className="mt-1 text-xs text-slate-500">Confirmed preorder quantities not yet allocated to eligible finished lots, ordered by promised date.</p>
        {preorderDemandError && <p role="alert" className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{preorderDemandError}</p>}
        <div className="mt-3 space-y-2">{preorderDemands.map((order) => <article key={order.id} className="rounded-lg border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{order.reference} · {order.customer}</strong><span className="text-xs text-slate-600">Promised {formatDate(order.promisedDate || order.requestedDate)}</span></div>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">{order.items.map((item) => <li key={item.id}>{item.product} — {item.outstandingQuantity ?? item.quantity} {item.saleUnit || 'units'} outstanding; {item.reservedQuantity ?? 0} allocated</li>)}</ul>
        </article>)}
          {!preorderDemands.length && <p className="rounded-lg border border-dashed bg-white p-4 text-xs text-slate-500">No confirmed preorder production demand is waiting for output.</p>}
        </div>
      </section>}
      <div className="space-y-3 p-3 md:hidden">{pageOrders.map((order) => <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{order.reference}</p><p className="mt-0.5 truncate text-xs text-slate-500">{order.customer}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${order.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : order.status === 'Cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{order.status}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="block text-[10px] text-slate-400">Requested</span><strong>{formatDate(order.requestedDate)}</strong></div><div><span className="block text-[10px] text-slate-400">Total / paid</span><strong>{money(order.total)}</strong><span className="block text-[10px] text-slate-400">Paid {money(order.paidAmount ?? 0)}</span></div></div>
        <p className="mt-3 line-clamp-2 text-xs text-slate-600">{order.items.map((item) => `${item.product} × ${item.quantity}`).join(', ')}</p>
        <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3"><span className={`text-xs font-semibold ${order.priority === 'High' ? 'text-amber-700' : 'text-slate-500'}`}>{order.priority} priority{order.reserved ? ' · Reserved' : ''}</span><div className="relative flex gap-2"><button type="button" aria-label={`Details for ${order.reference} on mobile`} onClick={() => { void openDetails(order) }} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold">Details</button>{canManage && <button type="button" aria-label={`Process ${order.reference} on mobile`} aria-expanded={openActionMenuFor === order.id} onClick={() => setOpenActionMenuFor((current) => current === order.id ? null : order.id)} className="grid size-11 place-items-center rounded-lg border"><Ellipsis className="size-4" /></button>}{canManage && openActionMenuFor === order.id && <div role="menu" aria-label={`Process ${order.reference}`} className="fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border-t bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-2xl md:hidden">
          {order.status === 'Pending' && <><button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); setEditor(order) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Edit order</button><button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); beginConfirmation(order) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium text-emerald-800">{order.fulfillmentMode === 'preorder' ? 'Review and confirm date' : 'Confirm'}</button></>}
          {order.status === 'Confirmed' && <button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'In progress') }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Start order</button>}
          {order.status === 'In progress' && <button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'Ready') }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Mark ready</button>}
          {['Pending', 'Confirmed', 'In progress', 'Ready'].includes(order.status) && <button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'Cancelled', order.status === 'Ready' ? window.prompt('Reason for cancelling a ready order?') || '' : '') }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium text-rose-700">Cancel order</button>}
          {order.status !== 'Cancelled' && order.status !== 'Completed' && <button type="button" onClick={() => { setOpenActionMenuFor(null); beginPayment(order) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Record payment</button>}
          {order.status === 'Ready' && order.reserved && <button type="button" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void fulfill(order) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium text-primary">Fulfill order</button>}
          {['Completed', 'Cancelled'].includes(order.status) && !order.archivedAt && <button type="button" onClick={() => { setOpenActionMenuFor(null); void perform(order, async () => archiveOrder(order.id)) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Archive order</button>}
          {order.archivedAt && <button type="button" onClick={() => { setOpenActionMenuFor(null); void perform(order, () => restoreOrder(order.id)) }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium">Restore order</button>}
          <button type="button" onClick={() => setOpenActionMenuFor(null)} className="mt-1 min-h-11 w-full rounded-lg border text-sm font-semibold">Close</button>
        </div>}</div></div>
      </article>)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-400"><tr>{['Reference / queue', 'Customer', 'Products', 'Requested', 'Total / paid', 'Priority / status', 'Actions'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>
        {pageOrders.map((order, index) => <tr key={order.id || order.orderNumber || order.reference || `order-${index}`} className="border-t border-slate-100 text-slate-600">
          <td className="px-4 py-3 font-semibold text-slate-800">#{(page - 1) * pageSize + index + 1} · {order.reference}</td><td className="px-4 py-3">{order.customer}</td><td className="max-w-56 px-4 py-3">{order.items.map((item) => `${item.product} × ${item.quantity}`).join(', ')}</td><td className="px-4 py-3">{formatDate(order.requestedDate)}</td><td className="px-4 py-3">{money(order.total)}<span className="mt-1 block text-[10px] text-slate-400">Paid {money(order.paidAmount ?? 0)}</span></td><td className="px-4 py-3"><span className={order.priority === 'High' ? 'font-bold text-amber-700' : ''}>{order.priority}</span><span className="mt-1 block">{order.status}{order.reserved ? ' · Stock reserved' : ''}</span></td><td className="px-4 py-3">
            <div ref={openActionMenuFor === order.id ? actionMenuRef : null} className="relative flex justify-end">
              <button
                type="button"
                aria-label={`Actions for ${order.reference}`}
                aria-haspopup="menu"
                aria-expanded={openActionMenuFor === order.id}
                onClick={() => setOpenActionMenuFor((current) => current === order.id ? null : order.id)}
                className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              ><Ellipsis className="size-4" /></button>
              {openActionMenuFor === order.id && <div role="menu" aria-label={`Actions for ${order.reference}`} className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                <button type="button" role="menuitem" onClick={() => { setOpenActionMenuFor(null); void openDetails(order) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50">View details</button>
                {canManage && order.status === 'Pending' && <>
                  <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); setEditor(order) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50 disabled:opacity-50">Edit order</button>
                  <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); beginConfirmation(order) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">{order.fulfillmentMode === 'preorder' ? 'Review and confirm date' : 'Confirm'}</button>
                </>}
                {canManage && order.status === 'Confirmed' && <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'In progress') }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50 disabled:opacity-50">Start order</button>}
                {canManage && order.status === 'In progress' && <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'Ready') }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50 disabled:opacity-50">Mark ready</button>}
                {canManage && ['Pending', 'Confirmed', 'In progress', 'Ready'].includes(order.status) && <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void updateStatus(order, 'Cancelled', order.status === 'Ready' ? window.prompt('Reason for cancelling a ready order?') || '' : '') }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Cancel order</button>}
                {canManage && order.status !== 'Cancelled' && order.status !== 'Completed' && <button type="button" role="menuitem" onClick={() => { setOpenActionMenuFor(null); beginPayment(order) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50">Record payment</button>}
                {canManage && order.status === 'Ready' && order.reserved && <button type="button" role="menuitem" disabled={busyId === order.id} onClick={() => { setOpenActionMenuFor(null); void fulfill(order) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-primary hover:bg-slate-50 disabled:opacity-50">Fulfill order</button>}
                {canManage && ['Completed', 'Cancelled'].includes(order.status) && !order.archivedAt && <button type="button" role="menuitem" onClick={() => { setOpenActionMenuFor(null); void perform(order, async () => archiveOrder(order.id)) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50">Archive order</button>}
                {canManage && order.archivedAt && <button type="button" role="menuitem" onClick={() => { setOpenActionMenuFor(null); void perform(order, () => restoreOrder(order.id)) }} className="w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-slate-50">Restore order</button>}
              </div>}
            </div>
          </td>
        </tr>)}
      </tbody></table>{!pageOrders.length && <div className="p-12 text-center text-sm text-slate-500"><ClipboardList className="mx-auto mb-2 size-5" />No orders match these filters.</div>}</div>
      {!pageOrders.length && <div className="p-10 text-center text-sm text-slate-500 md:hidden"><ClipboardList className="mx-auto mb-2 size-5" />No orders match these filters.</div>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 text-xs text-slate-500 sm:px-4"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="flex items-center gap-2"><button type="button" aria-label="Previous orders page" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid size-11 place-items-center rounded border disabled:opacity-40 sm:size-auto sm:p-1.5"><ChevronLeft className="size-4" /></button><span>Page {page} of {pageCount}</span><button type="button" aria-label="Next orders page" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="grid size-11 place-items-center rounded border disabled:opacity-40 sm:size-auto sm:p-1.5"><ChevronRight className="size-4" /></button></div></footer>
    </section>
    {editor !== undefined && <OrderEditor order={editor || undefined} state={state} currentUser={currentUser} customersLoaded={customersLoaded} customersApiLoaded={customersApiLoaded} customerLoadError={customerLoadError} onRetryCustomers={onRetryCustomers} onSave={saveOrder} onClose={() => setEditor(undefined)} />}
    {confirmingPreorder && <div className="fixed inset-0 z-[90] grid items-end bg-slate-950/40 sm:place-items-center sm:p-4"><form onSubmit={(event) => { void confirmPreorder(event) }} className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-xl sm:p-5"><h2 className="font-bold">Review preorder date</h2><p className="mt-2 text-sm text-slate-600">{confirmingPreorder.reference} · {confirmingPreorder.customer}. Confirm only after reviewing production capacity.</p><label className="mt-4 block text-xs font-semibold">Promised fulfilment date<input required type="date" min={today()} value={promisedDateDraft} onChange={(event) => setPromisedDateDraft(event.target.value)} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0" /></label><label className="mt-3 block text-xs font-semibold">Capacity review note<textarea required maxLength={500} value={capacityReviewNote} onChange={(event) => setCapacityReviewNote(event.target.value)} placeholder="Summarize how the production plan supports this date." className="mt-1 min-h-20 w-full rounded border px-3 py-2" /></label>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}<footer className="mt-4 flex justify-end gap-2"><button type="button" disabled={busyId === confirmingPreorder.id} onClick={() => setConfirmingPreorder(null)} className="min-h-11 rounded border px-3 text-xs">Back</button><button type="submit" disabled={busyId === confirmingPreorder.id || !promisedDateDraft || !capacityReviewNote.trim()} className="min-h-11 rounded bg-primary px-3 text-xs text-primary-foreground">Accept preorder</button></footer></form></div>}
    {paymentOrder && <div className="fixed inset-0 z-[85] grid items-end bg-slate-950/40 sm:place-items-center sm:p-4"><form onSubmit={(event) => { void submitPayment(event) }} className="max-h-[96vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-24 shadow-2xl sm:rounded-xl sm:p-5 sm:pb-5"><header className="flex justify-between"><div><h2 className="font-bold">Record order payment</h2><p className="mt-1 text-xs text-slate-500">{paymentOrder.reference} · Balance {money(Math.max(0, paymentOrder.total - (paymentOrder.paidAmount ?? 0)))}</p></div><button type="button" aria-label="Close payment form" onClick={() => setPaymentOrder(null)}><X className="size-4" /></button></header><div className="mt-4 space-y-4"><label className="block text-xs font-semibold">Amount<input required type="number" min="1" step="1" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0" /></label><label className="block text-xs font-semibold">Date<input required type="date" max={today()} value={paymentDraft.date} onChange={(event) => setPaymentDraft({ ...paymentDraft, date: event.target.value })} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0" /></label><label className="block text-xs font-semibold">Method<select value={paymentDraft.method} onChange={(event) => setPaymentDraft({ ...paymentDraft, method: event.target.value as SalePayment['method'] })} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0">{methods.map((method) => <option key={method}>{method}</option>)}</select></label><label className="block text-xs font-semibold">Transaction ID (optional)<input value={paymentDraft.txnID} onChange={(event) => setPaymentDraft({ ...paymentDraft, txnID: event.target.value })} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0" /></label><label className="block text-xs font-semibold">Note (optional)<textarea value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} className="mt-1 min-h-11 w-full rounded border px-3 py-2 sm:min-h-0" /></label>{paymentError && <p role="alert" className="text-sm text-rose-700">{paymentError}</p>}<footer className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0 sm:py-0"><button type="button" onClick={() => setPaymentOrder(null)} className="min-h-11 rounded border px-3 py-2 text-xs sm:min-h-0">Cancel</button><button type="submit" disabled={busyId === paymentOrder.id} className="min-h-11 rounded bg-primary px-3 py-2 text-xs text-primary-foreground sm:min-h-0">Save payment</button></footer></div></form></div>}
    {detail && <div className="fixed inset-0 z-[80] grid items-end bg-slate-950/40 sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) { detailRequest.current += 1; setDetail(null) } }}><section role="dialog" aria-modal="true" aria-labelledby="order-details-title" className="max-h-[96vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl"><header className="sticky top-0 flex items-start justify-between border-b bg-white p-4 sm:p-5"><div><h2 id="order-details-title" className="font-bold">{detail.reference}</h2><p className="mt-1 text-xs text-slate-500">{detail.customer} · {detail.status}</p></div><button type="button" aria-label="Close order details" className="grid size-11 place-items-center sm:size-auto" onClick={() => { detailRequest.current += 1; setDetail(null) }}><X className="size-4" /></button></header><div className="space-y-5 p-4 sm:p-5">
      {detailLoading && <p role="status" className="text-xs text-slate-500">Loading order history from the server…</p>}
      {detailError && <p role="alert" className="rounded bg-rose-50 p-3 text-xs text-rose-800">{detailError}</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-2"><div><span className="text-xs text-slate-400">Order date</span><p>{formatDate(detail.date)}</p></div><div><span className="text-xs text-slate-400">Requested</span><p>{formatDate(detail.requestedDate)}</p></div>{detail.fulfillmentMode === 'preorder' && <div><span className="text-xs text-slate-400">Promised</span><p>{detail.promisedDate ? formatDate(detail.promisedDate) : 'Awaiting staff review'}</p></div>}<div><span className="text-xs text-slate-400">Fulfillment type</span><p>{detail.fulfillmentMode === 'preorder' ? 'Bakery preorder' : 'Bakery stock'}</p></div><div><span className="text-xs text-slate-400">Fulfilment</span><p>{detail.fulfilmentMethod} {detail.destination}</p></div><div><span className="text-xs text-slate-400">Payment terms</span><p>{detail.paymentTerms}{detail.dueDate ? ` · Due ${formatDate(detail.dueDate)}` : ''}</p></div><div><span className="text-xs text-slate-400">Payment summary</span><p>Paid {money(detail.paidAmount ?? 0)} / {money(detail.total)} · Balance {money(Math.max(0, detail.total - (detail.paidAmount ?? 0)))}</p></div><div><span className="text-xs text-slate-400">Inventory reservation</span><p>{detail.reserved ? 'Reserved' : 'Not reserved'}</p></div></div>
      <div><h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Order items</h3><div className="divide-y border-y">{detail.items.map((item) => <div key={item.id} className="flex justify-between gap-3 py-2 text-sm"><span>{item.product} × {item.quantity} @ {money(item.unitPrice)}</span><strong>{money(item.lineTotal)}</strong></div>)}<div className="py-3 text-right font-bold">Total {money(detail.total)}</div></div></div>
      {detail.notes && <p className="whitespace-pre-wrap text-sm">{detail.notes}</p>}
      <div><h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Payment history</h3>{detailPayments.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Date', 'Method', 'Transaction', 'Amount'].map((label) => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{detailPayments.map((payment) => <tr key={payment.id} className="border-t"><td className="px-2 py-2">{formatDate(payment.date)}</td><td className="px-2 py-2">{payment.method}</td><td className="px-2 py-2">{payment.txnID || payment.note || '—'}</td><td className="px-2 py-2 font-semibold">{money(payment.amount)}</td></tr>)}</tbody></table></div> : <p className="text-xs text-slate-500">{detailLoading ? 'Loading payments…' : 'No payments recorded.'}</p>}</div>
      <div><h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Order status history</h3><div className="space-y-2">{detail.statusHistory.length ? detail.statusHistory.map((item, index) => <div key={`${item.at}-${index}`} className="flex justify-between gap-4 text-xs"><span>{item.type || item.status}{item.reason ? ` · ${item.reason}` : ''}</span><time>{new Date(item.at).toLocaleString()}</time></div>) : <p className="text-xs text-slate-500">No status history.</p>}</div></div>
      {detail.saleId && <p className="rounded bg-emerald-50 p-3 text-xs text-emerald-800"><Check className="mr-1 inline size-3.5" />Converted to Sale {detail.saleId}</p>}
    </div></section></div>}
  </section>
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><strong className="mt-2 block text-xl font-bold tracking-tight text-slate-900">{value}</strong><p className="mt-1 text-[11px] text-slate-400">{detail}</p></article>
}
