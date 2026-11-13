import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteUnattachedBakeryProductImage,
  retryBakeryProductImageCleanup,
  updateBakeryProductFamily,
  uploadBakeryProductImage,
} from '@/lib/user-api'

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bakery product image API', () => {
  it('uses the family-scoped signed upload and returns Cloudinary URL and public ID', async () => {
    const familyId = '507f1f77bcf86cd799439011'
    const file = new File(['image'], 'sourdough.webp', { type: 'image/webp' })
    const publicId = `family-${familyId}-image-123`
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
        apiKey: 'demo-key',
        timestamp: 1234567890,
        signature: 'signed',
        publicId: `family-${familyId}-image-123`,
        folder: 'anli/bakery/products',
        cloudName: 'demo',
        resourceType: 'image',
        type: 'upload',
        maxBytes: 5 * 1024 * 1024,
        allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
      }))
      .mockResolvedValueOnce(jsonResponse({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/product.webp',
        public_id: publicId,
        resource_type: 'image',
        format: 'webp',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadBakeryProductImage(familyId, file)).resolves.toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/product.webp',
      publicId,
      format: 'webp',
      bytes: file.size,
    })

    const [signUrl, signRequest] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(signUrl).pathname).toBe('/api/uploads/bakery-product-image/signed')
    expect(JSON.parse(String(signRequest.body))).toEqual({ familyId })
    const uploadForm = fetchMock.mock.calls[1][1]?.body as FormData
    expect(uploadForm.get('file')).toBe(file)
    expect(uploadForm.get('public_id')).toBe(`family-${familyId}-image-123`)
    expect(uploadForm.get('folder')).toBe('anli/bakery/products')
  })

  it('persists image metadata and exposes retryable Cloudinary cleanup operations', async () => {
    const familyId = 'family-id'
    const image = {
      url: 'https://res.cloudinary.com/demo/image/upload/product.webp',
      publicId: 'family-family-id-image-123',
      altText: 'Sourdough loaf',
      sortOrder: 0,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ family: { id: familyId }, imageCleanupPending: 1 }))
      .mockResolvedValueOnce(jsonResponse({ removed: true, imageCleanupPending: 0 }))
      .mockResolvedValueOnce(jsonResponse({ imageCleanupPending: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateBakeryProductFamily(familyId, {
      storefront: {
        published: false,
        description: '',
        images: [image],
        ingredientsStatement: '',
        allergens: [],
      },
    })).resolves.toMatchObject({ imageCleanupPending: 1 })

    await expect(deleteUnattachedBakeryProductImage(familyId, image.publicId)).resolves.toEqual({
      removed: true,
      imageCleanupPending: 0,
    })
    await expect(retryBakeryProductImageCleanup(familyId)).resolves.toEqual({ imageCleanupPending: 0 })

    const updateRequest = fetchMock.mock.calls[0][1] as RequestInit
    expect(updateRequest.method).toBe('PATCH')
    expect(JSON.parse(String(updateRequest.body))).toMatchObject({ storefront: { images: [image] } })
    const removeRequest = fetchMock.mock.calls[1][1] as RequestInit
    expect(removeRequest.method).toBe('DELETE')
    expect(JSON.parse(String(removeRequest.body))).toEqual({ publicId: image.publicId })
    const retryRequest = fetchMock.mock.calls[2][1] as RequestInit
    expect(retryRequest.method).toBe('POST')
  })
})
