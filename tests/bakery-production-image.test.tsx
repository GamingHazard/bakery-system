import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BakeryProductionManagement from '@/components/bakery-production-management'
import type { BakeryProductFamily } from '@/lib/user-api'

const imageApi = vi.hoisted(() => ({
  listBakeryProductFamilies: vi.fn(),
  listBakeryProductionBatches: vi.fn(),
  listFinishedStockLots: vi.fn(),
  listProductionMaterials: vi.fn(),
  uploadBakeryProductImage: vi.fn(),
  updateBakeryProductFamily: vi.fn(),
  deleteUnattachedBakeryProductImage: vi.fn(),
  retryBakeryProductImageCleanup: vi.fn(),
}))

vi.mock('@/lib/user-api', () => ({
  addBakeryVariant: vi.fn(),
  completeBakeryProductionBatch: vi.fn(),
  createBakeryProductFamily: vi.fn(),
  createBakeryProductionBatch: vi.fn(),
  deleteUnattachedBakeryProductImage: imageApi.deleteUnattachedBakeryProductImage,
  listBakeryProductFamilies: imageApi.listBakeryProductFamilies,
  listBakeryProductionBatches: imageApi.listBakeryProductionBatches,
  listFinishedStockLots: imageApi.listFinishedStockLots,
  listProductionMaterials: imageApi.listProductionMaterials,
  retryBakeryProductImageCleanup: imageApi.retryBakeryProductImageCleanup,
  saveBakeryRecipe: vi.fn(),
  updateBakeryProductFamily: imageApi.updateBakeryProductFamily,
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

function renderBakeryProduction() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BakeryProductionManagement canManage onBack={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('bakery product profile image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [family] })
    imageApi.listBakeryProductionBatches.mockResolvedValue({ batches: [] })
    imageApi.listFinishedStockLots.mockResolvedValue({ lots: [] })
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

  afterEach(() => {
    cleanup()
  })

  it('uploads and attaches one primary image, then exposes pending old-image cleanup', async () => {
    imageApi.listBakeryProductFamilies.mockResolvedValue({ families: [familyWithImage] })
    renderBakeryProduction()
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
})
