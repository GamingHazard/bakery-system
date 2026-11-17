import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BakeryProductionManagement from '@/components/bakery-production-management'
import type { BakeryProductFamily } from '@/lib/user-api'

const imageApi = vi.hoisted(() => ({
  listBakeryProductFamilies: vi.fn(),
  listBakeryProductionBatches: vi.fn(),
  listFinishedStockLots: vi.fn(),
  listFinishedStockLotMovements: vi.fn(),
  listProductionMaterials: vi.fn(),
  receiveBakeryFinishedStockLot: vi.fn(),
  uploadBakeryProductImage: vi.fn(),
  updateBakeryProductFamily: vi.fn(),
  updateBakeryProductVariant: vi.fn(),
  deleteUnattachedBakeryProductImage: vi.fn(),
  retryBakeryProductImageCleanup: vi.fn(),
}))

vi.mock('@/lib/user-api', () => ({
  addBakeryVariant: vi.fn(),
  adjustBakeryFinishedStockLot: vi.fn(),
  completeBakeryProductionBatch: vi.fn(),
  createBakeryProductFamily: vi.fn(),
  createBakeryProductionBatch: vi.fn(),
  deleteUnattachedBakeryProductImage: imageApi.deleteUnattachedBakeryProductImage,
  listBakeryProductFamilies: imageApi.listBakeryProductFamilies,
  listBakeryProductionBatches: imageApi.listBakeryProductionBatches,
  listFinishedStockLots: imageApi.listFinishedStockLots,
  listFinishedStockLotMovements: imageApi.listFinishedStockLotMovements,
  listProductionMaterials: imageApi.listProductionMaterials,
  retryBakeryProductImageCleanup: imageApi.retryBakeryProductImageCleanup,
  receiveBakeryFinishedStockLot: imageApi.receiveBakeryFinishedStockLot,
  saveBakeryRecipe: vi.fn(),
  updateBakeryProductFamily: imageApi.updateBakeryProductFamily,
  updateBakeryProductVariant: imageApi.updateBakeryProductVariant,
  uploadBakeryProductImage: imageApi.uploadBakeryProductImage,
  writeOffFinishedStockLot: vi.fn(),
}))

const family: BakeryProductFamily = {
  id: '507f1f77bcf86cd799439011',
  code: 'SOURDOUGH',
  name: 'Sourdough loaf',
  category: 'Bread',
  flavour: '',
  baseUnit: 'loaf',
  activeRecipeId: null,
  shelfLifeDays: 2,
  dateLabelType: 'best_before',
  storageInstructions: '',
  active: true,
  imageCleanupPending: 0,
  storefront: {
    published: false,
    description: '',
    images: [],
    ingredientsStatement: '',
    allergens: [],
  },
  variants: [],
  recipe: null,
}

const familyWithImage: BakeryProductFamily = {
  ...family,
  storefront: {
    ...family.storefront,
    images: [{
      url: 'https://res.cloudinary.com/demo/image/upload/old-product.webp',
      publicId: `family-${family.id}-old-image`,
      altText: 'Previous loaf photo',
      sortOrder: 0,
    }],
  },
}

function renderBakeryProduction(options: { canManage?: boolean; canManageInventory?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BakeryProductionManagement canManage={options.canManage ?? true} canManageInventory={options.canManageInventory ?? false} onBack={vi.fn()} />
    </QueryClientProvider>,
  )
}

async function openView(label: string) {
  fireEvent.click(await screen.findByRole('tab', { name: label }))
}

async function openProductEditor() {
  await openView('Products')
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  await screen.findByRole('dialog', { name: /Edit/ })
}

describe('bakery product profile image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [family] })
    imageApi.listBakeryProductionBatches.mockResolvedValue({ batches: [] })
    imageApi.listFinishedStockLots.mockResolvedValue({ lots: [] })
    imageApi.listFinishedStockLotMovements.mockResolvedValue({ movements: [] })
    imageApi.receiveBakeryFinishedStockLot.mockResolvedValue({
      lot: { reference: 'RECEIPT-001' },
      replayed: false,
    })
    imageApi.listProductionMaterials.mockResolvedValue({ materials: [] })
    imageApi.uploadBakeryProductImage.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/sourdough.webp',
      publicId: `family-${family.id}-image-123`,
    })
    imageApi.deleteUnattachedBakeryProductImage.mockResolvedValue({
      removed: true,
      imageCleanupPending: 0,
    })
    imageApi.updateBakeryProductFamily.mockResolvedValue({
      family,
      imageCleanupPending: 1,
    })
  })

  describe('bakery product publication', () => {
    it('renders family forms without duplicate React keys', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        renderBakeryProduction()

        await openView('Products')
        await screen.findByRole('button', { name: `Publish ${family.name}` })
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Encountered two children with the same key')
      } finally {
        consoleError.mockRestore()
      }
    })

    it('publishes a family through the existing authenticated update API', async () => {
      const publishedFamily: BakeryProductFamily = {
        ...family,
        storefront: {
          ...family.storefront,
          published: true,
          firstPublishedAt: '2026-11-15T10:00:00.000Z',
        },
      }
      imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [family] })
      const updatedFamily: Partial<BakeryProductFamily> = { ...publishedFamily }
      delete updatedFamily.variants
      delete updatedFamily.recipe
      imageApi.updateBakeryProductFamily.mockResolvedValue({ family: updatedFamily })

      renderBakeryProduction()
      await openView('Products')
      fireEvent.click(await screen.findByRole('button', { name: 'Publish Sourdough loaf' }))

      await waitFor(() => expect(imageApi.updateBakeryProductFamily).toHaveBeenCalledWith(
        family.id,
        { storefront: { published: true } },
      ))
      expect(await screen.findByRole('button', { name: 'Unpublish Sourdough loaf' })).toBeTruthy()
      expect(await screen.findByText(/is now published on the website/i)).toBeTruthy()
      expect(imageApi.listBakeryProductFamilies).toHaveBeenCalledTimes(1)
    })

    it('shows activation progress only on the family being activated and disables other toggles', async () => {
      const inactiveFamily: BakeryProductFamily = {
        ...family,
        id: '507f1f77bcf86cd799439012',
        code: 'BAGEL',
        name: 'Bagel',
        active: false,
      }
      const activatedFamily = { ...inactiveFamily, active: true }
      let currentFamilies = [family, inactiveFamily]
      imageApi.listBakeryProductFamilies.mockImplementation(async () => ({ families: currentFamilies }))

      let resolveUpdate!: (result: { family: BakeryProductFamily }) => void
      imageApi.updateBakeryProductFamily.mockReturnValue(new Promise((resolve) => {
        resolveUpdate = resolve
      }))

      renderBakeryProduction()
      await openView('Products')
      const activateButton = await screen.findByRole('button', { name: 'Activate Bagel' })
      const deactivateButton = screen.getByRole('button', { name: 'Deactivate Sourdough loaf' })
      const publishButton = screen.getByRole('button', { name: 'Publish Sourdough loaf' })
      fireEvent.click(activateButton)

      await waitFor(() => expect(activateButton.textContent).toBe('Saving…'))
      expect(screen.getAllByText('Saving…')).toHaveLength(1)
      expect(deactivateButton.textContent).toBe('Deactivate')
      expect(deactivateButton.hasAttribute('disabled')).toBe(true)
      expect(publishButton.hasAttribute('disabled')).toBe(true)

      currentFamilies = [family, activatedFamily]
      resolveUpdate({ family: activatedFamily })
      expect(await screen.findByRole('button', { name: 'Deactivate Bagel' })).toBeTruthy()
    })

    it('shows publication progress only on the family being published and disables other toggles', async () => {
      const otherFamily: BakeryProductFamily = {
        ...family,
        id: '507f1f77bcf86cd799439012',
        code: 'BAGEL',
        name: 'Bagel',
      }
      const publishedFamily: BakeryProductFamily = {
        ...family,
        storefront: {
          ...family.storefront,
          published: true,
        },
      }
      let currentFamilies = [family, otherFamily]
      imageApi.listBakeryProductFamilies.mockImplementation(async () => ({ families: currentFamilies }))

      let resolveUpdate!: (result: { family: BakeryProductFamily }) => void
      imageApi.updateBakeryProductFamily.mockReturnValue(new Promise((resolve) => {
        resolveUpdate = resolve
      }))

      renderBakeryProduction()
      await openView('Products')
      const publishButton = await screen.findByRole('button', { name: 'Publish Sourdough loaf' })
      const otherPublishButton = screen.getByRole('button', { name: 'Publish Bagel' })
      const deactivateButton = screen.getByRole('button', { name: 'Deactivate Sourdough loaf' })
      fireEvent.click(publishButton)

      await waitFor(() => expect(publishButton.textContent).toBe('Saving…'))
      expect(screen.getAllByText('Saving…')).toHaveLength(1)
      expect(otherPublishButton.textContent).toBe('Publish')
      expect(otherPublishButton.hasAttribute('disabled')).toBe(true)
      expect(deactivateButton.hasAttribute('disabled')).toBe(true)

      currentFamilies = [publishedFamily, otherFamily]
      resolveUpdate({ family: publishedFamily })
      expect(await screen.findByRole('button', { name: 'Unpublish Sourdough loaf' })).toBeTruthy()
    })

    it('saves customer-facing slug and description for a selected family', async () => {
      renderBakeryProduction()
      await openProductEditor()
      await screen.findByRole('heading', { name: 'Website product details' })
      fireEvent.change(screen.getByLabelText('Website slug'), {
        target: { value: 'sourdough-loaf' },
      })
      fireEvent.change(screen.getByLabelText('Website description'), {
        target: { value: 'A naturally leavened loaf.' },
      })
      const detailsForm = screen.getByRole('heading', { name: 'Website product details' }).closest('form')
      expect(Array.from(detailsForm?.querySelectorAll(':invalid') ?? []).map((field) => field.outerHTML)).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(imageApi.updateBakeryProductFamily).toHaveBeenCalledWith(
        family.id,
        expect.objectContaining({ storefront: { slug: 'sourdough-loaf', description: 'A naturally leavened loaf.' } }),
      ))
    })
  })

  afterEach(() => {
    cleanup()
    window.history.replaceState({}, '', '/inventory/production')
  })

  it('uploads and attaches one primary image, then exposes pending old-image cleanup', async () => {
    imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [familyWithImage] })
    renderBakeryProduction()
    await openProductEditor()
    await screen.findByRole('heading', { name: 'Product profile image' })
    await screen.findByRole('button', { name: 'Choose image' })

    const file = new File(['image'], 'sourdough.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('Choose product image'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('Image alt text'), { target: { value: family.name } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload image' }))

    await waitFor(() => expect(imageApi.uploadBakeryProductImage).toHaveBeenCalledWith(family.id, file))
    await waitFor(() => expect(imageApi.updateBakeryProductFamily).toHaveBeenCalledWith(family.id, {
      storefront: {
        published: false,
        slug: undefined,
        description: '',
        images: [{
          url: 'https://res.cloudinary.com/demo/image/upload/sourdough.webp',
          publicId: `family-${family.id}-image-123`,
          altText: family.name,
          sortOrder: 0,
        }],
        ingredientsStatement: '',
        allergens: [],
      },
    }))
    expect(await screen.findByText(/previous image.*queued for Cloudinary cleanup/i)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Retry cleanup' })).toBeTruthy()
  })

  it('rejects unsupported image files before starting an upload', async () => {
    renderBakeryProduction()
    await openProductEditor()
    await screen.findByRole('heading', { name: 'Product profile image' })
    await screen.findByRole('button', { name: 'Choose image' })
    const file = new File(['svg'], 'sourdough.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByLabelText('Choose product image'), { target: { files: [file] } })

    expect((await screen.findByRole('alert')).textContent).toContain('Choose a JPEG, PNG, or WebP image.')
    expect(imageApi.uploadBakeryProductImage).not.toHaveBeenCalled()
  })

  it('removes an unattached Cloudinary upload when saving the image metadata fails', async () => {
    imageApi.updateBakeryProductFamily.mockRejectedValue(new Error('Profile update failed.'))
    renderBakeryProduction()
    await openProductEditor()
    await screen.findByRole('button', { name: 'Choose image' })

    const file = new File(['image'], 'sourdough.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('Choose product image'), { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload image' }))

    await waitFor(() => expect(imageApi.deleteUnattachedBakeryProductImage).toHaveBeenCalledWith(
      family.id,
      `family-${family.id}-image-123`,
    ))
    expect((await screen.findByRole('alert')).textContent).toContain('Profile update failed.')
  })

  it('reports both the save failure and cleanup failure for an unattached upload', async () => {
    imageApi.updateBakeryProductFamily.mockRejectedValue(new Error('Profile update failed.'))
    imageApi.deleteUnattachedBakeryProductImage.mockRejectedValue(new Error('Cleanup validation failed.'))
    renderBakeryProduction()
    await openProductEditor()
    await screen.findByRole('button', { name: 'Choose image' })

    const file = new File(['image'], 'sourdough.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('Choose product image'), { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Upload image' }))

    const alert = await screen.findByRole('alert')
    await waitFor(() => {
      expect(alert.textContent).toContain('Profile update failed.')
      expect(alert.textContent).toContain('Cleanup validation failed.')
    })
  })

  it('posts a manual finished-stock receipt through the audited lot API', async () => {
    const familyWithVariant: BakeryProductFamily = {
      ...family,
      variants: [{
        id: '507f1f77bcf86cd799439013',
        familyId: family.id,
        sku: 'SOUR-LOAF',
        name: 'Sourdough loaf',
        saleUnit: 'loaf',
        unitsPerSaleUnit: 1,
        price: 5000,
        active: true,
      }],
    }
    imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [familyWithVariant] })

    renderBakeryProduction({ canManageInventory: true })
    await openView('Finished stock')
    const receiptForm = (await screen.findByRole('heading', { name: 'Receive bakery finished stock' })).closest('form')
    if (!receiptForm) throw new Error('Manual receipt form was not rendered.')
    fireEvent.change(within(receiptForm).getByLabelText('Product family'), { target: { value: family.id } })
    fireEvent.change(within(receiptForm).getByLabelText('Sellable SKU'), { target: { value: familyWithVariant.variants[0].id } })
    fireEvent.change(within(receiptForm).getByLabelText('Quantity'), { target: { value: '12' } })
    fireEvent.change(within(receiptForm).getByLabelText('Production date'), { target: { value: '2026-01-10' } })
    fireEvent.change(within(receiptForm).getByLabelText('Receipt date'), { target: { value: '2026-02-01' } })
    fireEvent.change(within(receiptForm).getByLabelText('Expiry / best-before date'), { target: { value: '2099-01-12' } })
    fireEvent.change(within(receiptForm).getByLabelText('Receipt reference'), { target: { value: 'RECEIPT-001' } })
    fireEvent.change(within(receiptForm).getByLabelText('Reason'), { target: { value: 'Supplier return accepted' } })
    fireEvent.click(within(receiptForm).getByRole('button', { name: 'Post manual receipt' }))

    await waitFor(() => expect(imageApi.receiveBakeryFinishedStockLot.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      familyId: family.id,
      variantId: familyWithVariant.variants[0].id,
      quantity: 12,
      productionDate: '2026-01-10',
      receiptDate: '2026-02-01',
      expiryDate: '2099-01-12',
      reference: 'RECEIPT-001',
      reason: 'Supplier return accepted',
      idempotencyKey: expect.stringMatching(/^BAKERY-RECEIPT/),
    })))
  })

  it('shows the tabbed overview by default with one active panel', async () => {
    window.history.replaceState({}, '', '/inventory/production')
    renderBakeryProduction()

    expect(await screen.findByRole('heading', { name: 'Production overview' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Products',
      'Recipes',
      'Production batches',
      'Finished stock',
    ])
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('uses the view query parameter for direct links and selection', async () => {
    window.history.replaceState({}, '', '/inventory/production?view=recipes')
    renderBakeryProduction()

    expect(await screen.findByRole('heading', { name: 'Recipes and versions' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Recipes' }).getAttribute('aria-selected')).toBe('true')

    await openView('Products')
    expect(new URL(window.location.href).searchParams.get('view')).toBe('products')
    expect(await screen.findByRole('heading', { name: 'Bakery product families and sellable SKUs' })).toBeTruthy()

    window.history.replaceState({}, '', '/inventory/production?view=batches')
    fireEvent.popState(window)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Production batches' }).getAttribute('aria-selected')).toBe('true'))
    expect(await screen.findByRole('heading', { name: 'Batch history' })).toBeTruthy()
  })

  it('keeps production and stock actions hidden for a read-only user', async () => {
    renderBakeryProduction({ canManage: false })
    expect(await screen.findByText('View only')).toBeTruthy()

    await openView('Products')
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
    expect(screen.getByText('You can review product details, but editing is restricted by your role.')).toBeTruthy()

    await openView('Finished stock')
    expect(screen.queryByRole('heading', { name: 'Receive bakery finished stock' })).toBeNull()
    expect(screen.getByText('Receiving and adjustments require inventory-management access.')).toBeTruthy()
  })
})
