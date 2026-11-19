'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ImagePlus, PackageCheck, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { createId } from '@/lib/erp'
import {
  adjustBakeryFinishedStockLot,
  addBakeryVariant,
  completeBakeryProductionBatch,
  createBakeryProductFamily,
  createBakeryProductionBatch,
  deleteUnattachedBakeryProductImage,
  listBakeryProductFamilies,
  listBakeryProductionBatches,
  listFinishedStockLots,
  listFinishedStockLotMovements,
  listProductionMaterials,
  retryBakeryProductImageCleanup,
  saveBakeryRecipe,
  updateBakeryProductFamily,
  updateBakeryProductVariant,
  uploadBakeryProductImage,
  receiveBakeryFinishedStockLot,
  writeOffFinishedStockLot,
  type BakeryProductFamily,
  type ProductionMaterial,
} from '@/lib/user-api'

type Props = {
  canManage: boolean
  canManageInventory?: boolean
  onBack?: () => void
}

type IngredientDraft = { materialId: string; quantity: string }
type PackagingDraft = { materialId: string; quantity: string }
const key = ['bakery-production']
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:bg-slate-50'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The bakery request could not be completed.'
const productionViews = ['overview', 'products', 'recipes', 'batches', 'stock'] as const
type ProductionView = typeof productionViews[number]
const productionViewLabels: Record<ProductionView, string> = {
  overview: 'Overview',
  products: 'Products',
  recipes: 'Recipes',
  batches: 'Production batches',
  stock: 'Finished stock',
}

function isProductionView(view: string | null): view is ProductionView {
  return productionViews.some((item) => item === view)
}

function readProductionView(): ProductionView {
  if (typeof window === 'undefined') return 'overview'
  const view = new URL(window.location.href).searchParams.get('view')
  return isProductionView(view) ? view : 'overview'
}

function subscribeToProductionView(callback: () => void) {
  window.addEventListener('popstate', callback)
  window.addEventListener('productionviewchange', callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener('productionviewchange', callback)
  }
}

function setProductionViewInUrl(view: ProductionView) {
  const url = new URL(window.location.href)
  if (view === 'overview') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  window.history.pushState(window.history.state, '', url)
  window.dispatchEvent(new Event('productionviewchange'))
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}{children}</label>
}

function packagingMaterialsFromForm(form: FormData, prefix: string) {
  const ids = form.getAll(`${prefix}MaterialId`).map((value) => String(value))
  const quantities = form.getAll(`${prefix}Quantity`).map((value) => Number(value))
  return ids.flatMap((materialId, index) =>
    materialId && Number.isFinite(quantities[index]) && quantities[index] > 0
      ? [{ materialId, quantityPerSaleUnit: quantities[index] }]
      : [],
  )
}

function PackagingMaterialsFields({ materials, prefix }: { materials: ProductionMaterial[]; prefix: string }) {
  const [lines, setLines] = useState<PackagingDraft[]>([])
  return <section className="space-y-2 rounded-lg border border-slate-200 p-3 sm:col-span-2">
    <div className="flex items-center justify-between gap-2">
      <div><h4 className="text-xs font-bold text-slate-700">Packaging per sale unit</h4><p className="mt-1 text-[10px] text-slate-500">Optional. Packaging stock is deducted from completed output quantities.</p></div>
      <button type="button" onClick={() => setLines((current) => [...current, { materialId: '', quantity: '' }])} className="min-h-8 rounded-md border border-slate-200 px-2 text-[10px] font-semibold">Add packaging</button>
    </div>
    {lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
      <Field label={`Packaging material ${index + 1}`}><select name={`${prefix}MaterialId`} value={line.materialId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, materialId: event.target.value } : item))} className={inputClass}><option value="">Select packaging material</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</select></Field>
      <Field label="Quantity per sale unit"><input name={`${prefix}Quantity`} value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} type="number" min="0.000001" step="any" className={inputClass} /></Field>
      <button type="button" aria-label="Remove packaging material" onClick={() => setLines((current) => current.filter((_, row) => row !== index))} className="mt-5 min-h-10 rounded-lg border border-slate-200 px-3 text-xs">Remove</button>
    </div>)}
  </section>
}

function ingredientsFromFamily(family?: BakeryProductFamily): IngredientDraft[] {
  return family?.recipe?.ingredients.map((line) => ({
    materialId: line.materialId,
    quantity: String(line.quantityPerBatch),
  })) ?? [{ materialId: '', quantity: '' }]
}

export default function BakeryProductionManagement({ canManage, canManageInventory = false, onBack }: Props) {
  const client = useQueryClient()
  const activeView = useSyncExternalStore(subscribeToProductionView, readProductionView, () => 'overview')
  const [productSearch, setProductSearch] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
  const [productDrawerOpen, setProductDrawerOpen] = useState(false)
  const [productDrawerMode, setProductDrawerMode] = useState<'create' | 'edit'>('create')
  const drawerCloseButton = useRef<HTMLButtonElement>(null)
  const [familyId, setFamilyId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [receiptFamilyId, setReceiptFamilyId] = useState('')
  const [familyImageFile, setFamilyImageFile] = useState<File | null>(null)
  const [familyImagePreview, setFamilyImagePreview] = useState('')
  const [familyImageAltText, setFamilyImageAltText] = useState('')
  const [familyImageError, setFamilyImageError] = useState('')
  const [imageCleanupPending, setImageCleanupPending] = useState(0)
  const [storefrontSlugDraft, setStorefrontSlugDraft] = useState('')
  const [storefrontDescriptionDraft, setStorefrontDescriptionDraft] = useState('')
  const [storefrontError, setStorefrontError] = useState('')
  const familyImageInput = useRef<HTMLInputElement>(null)
  const [ingredientDrafts, setIngredientDrafts] = useState<IngredientDraft[]>([{ materialId: '', quantity: '' }])
  const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const workspace = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [familyResult, batchResult, lotResult, lotMovementResult, materialResult] = await Promise.all([
        listBakeryProductFamilies(),
        listBakeryProductionBatches(),
        listFinishedStockLots(),
        listFinishedStockLotMovements(),
        listProductionMaterials(),
      ])
      return {
        families: familyResult.families,
        batches: batchResult.batches,
        lots: lotResult.lots,
        lotMovements: lotMovementResult.movements,
        materials: materialResult.materials,
      }
    },
  })
  const families = workspace.data?.families ?? []
  const batches = workspace.data?.batches ?? []
  const lots = workspace.data?.lots ?? []
  const lotMovements = workspace.data?.lotMovements ?? []
  const stockBySku = Array.from(lots.reduce((balances, lot) => {
    const balance = balances.get(lot.variantId) ?? {
      sku: lot.sku,
      productName: lot.productName,
      saleUnit: lot.saleUnit,
      remainingQuantity: 0,
      reservedQuantity: 0,
    }
    balance.remainingQuantity += lot.remainingQuantity
    balance.reservedQuantity += lot.reservedQuantity
    balances.set(lot.variantId, balance)
    return balances
  }, new Map<string, { sku: string; productName: string; saleUnit: string; remainingQuantity: number; reservedQuantity: number }>()).values())
  const materials = (workspace.data?.materials ?? []).filter((material) => material.active)
  const ingredientMaterials = materials.filter((material) => material.category === 'Ingredients')
  const packagingMaterials = materials.filter((material) => material.category === 'Packaging')
  const filteredFamilies = families.filter((item) => {
    const search = productSearch.trim().toLocaleLowerCase()
    if (!search) return true
    return [item.name, item.code, item.category, ...item.variants.map((variant) => variant.sku)]
      .some((value) => value.toLocaleLowerCase().includes(search))
  })
  const family = families.find((item) => item.id === familyId)
  const receiptFamily = families.find((item) => item.id === receiptFamilyId)
  const activeBatches = batches.filter((batch) => batch.status === 'in_progress')
  const batch = activeBatches.find((item) => item.id === batchId)
  const availableStock = lots.reduce((total, lot) => total + Math.max(0, lot.remainingQuantity - lot.reservedQuantity), 0)
  const filteredMovements = lotMovements.filter((movement) => {
    const search = movementSearch.trim().toLocaleLowerCase()
    return !search || [movement.date, movement.lotReference, movement.sku, movement.productName, movement.type, movement.reason ?? '']
      .some((value) => value.toLocaleLowerCase().includes(search))
  })
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: key }),
    client.invalidateQueries({ queryKey: ['dashboard-finished-inventory'] }),
  ])
  const openCreateProduct = () => {
    setMessage('')
    setProductDrawerMode('create')
    setProductDrawerOpen(true)
  }
  const navigateView = (view: ProductionView) => {
    setProductDrawerOpen(false)
    setProductionViewInUrl(view)
  }
  const openEditProduct = (item: BakeryProductFamily) => {
    setFamilyId(item.id)
    setStorefrontSlugDraft(item.storefront.slug || '')
    setStorefrontDescriptionDraft(item.storefront.description || '')
    setProductDrawerMode('edit')
    setMessage('')
    setProductDrawerOpen(true)
  }

  useEffect(() => {
    if (!productDrawerOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerCloseButton.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProductDrawerOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [productDrawerOpen])

  useEffect(() => {
    if (!familyId && families.length) {
      const selectedFamily = families.find((item) => item.active) ?? families[0]
      setFamilyId(selectedFamily.id)
      setStorefrontSlugDraft(selectedFamily.storefront.slug || '')
      setStorefrontDescriptionDraft(selectedFamily.storefront.description || '')
    }
  }, [families, familyId])

  useEffect(() => {
    const selectedFamily = families.find((item) => item.id === familyId)
    if (selectedFamily) setIngredientDrafts(ingredientsFromFamily(selectedFamily))
  }, [familyId])

  useEffect(() => {
    if (!receiptFamilyId && families.length) {
      setReceiptFamilyId(families.find((item) => item.active)?.id ?? families[0].id)
    }
  }, [families, receiptFamilyId])

  useEffect(() => {
    if (!batchId && activeBatches.length) setBatchId(activeBatches[0].id)
  }, [activeBatches, batchId])

  useEffect(() => {
    setFamilyImageAltText(family?.storefront.images[0]?.altText || family?.name || '')
    setFamilyImageFile(null)
    setFamilyImageError('')
    setImageCleanupPending(family?.imageCleanupPending ?? 0)
    setStorefrontError('')
  }, [family?.id])

  useEffect(() => {
    setImageCleanupPending(family?.imageCleanupPending ?? 0)
  }, [family?.imageCleanupPending])

  useEffect(() => {
    if (!familyImageFile) {
      setFamilyImagePreview('')
      return
    }
    const previewUrl = URL.createObjectURL(familyImageFile)
    setFamilyImagePreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [familyImageFile])

  useEffect(() => {
    if (batch && batch.familyId !== familyId) {
      const selectedFamily = families.find((item) => item.id === batch.familyId)
      setFamilyId(batch.familyId)
      setStorefrontSlugDraft(selectedFamily?.storefront.slug || '')
      setStorefrontDescriptionDraft(selectedFamily?.storefront.description || '')
    }
  }, [batch?.id, batch?.familyId, familyId, families])

  useEffect(() => {
    setActualDrafts(Object.fromEntries((batch?.ingredients ?? []).map((line) => [line.materialId, String(line.expectedQuantity)])))
  }, [batch?.id])

  const createFamily = useMutation({
    mutationFn: createBakeryProductFamily,
    onSuccess: async ({ family: created }) => {
      setFamilyId(created.id)
      setStorefrontSlugDraft(created.storefront.slug || '')
      setStorefrontDescriptionDraft(created.storefront.description || '')
      setProductDrawerOpen(false)
      setMessage(`${created.name} and its first sellable variant were created.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const saveFamilyImage = useMutation({
    mutationFn: async ({ id, file, altText }: { id: string; file: File; altText: string }) => {
      const upload = await uploadBakeryProductImage(id, file)
      try {
        const result = await updateBakeryProductFamily(id, {
          storefront: {
            published: family?.storefront.published ?? false,
            slug: family?.storefront.slug,
            description: family?.storefront.description ?? '',
            images: [{ url: upload.url, publicId: upload.publicId, altText, sortOrder: 0 }],
            ingredientsStatement: family?.storefront.ingredientsStatement ?? '',
            allergens: family?.storefront.allergens ?? [],
          },
        })
        return result
      } catch (saveError) {
        try {
          const cleanup = await deleteUnattachedBakeryProductImage(id, upload.publicId)
          if (!cleanup.removed) {
            throw new Error("The uploaded image is queued for Cloudinary cleanup.")
          }
        } catch (cleanupError) {
          throw new Error(`The image could not be saved: ${errorMessage(saveError)}. Cloudinary cleanup did not complete: ${errorMessage(cleanupError)}`)
        }
        throw saveError
      }
    },
    onSuccess: async ({ imageCleanupPending: pending = 0 }) => {
      setFamilyImageFile(null)
      setFamilyImageError('')
      setImageCleanupPending(pending)
      setMessage(pending
        ? 'Product image updated. The previous image is queued for Cloudinary cleanup.'
        : 'Product image updated.')
      await refresh()
    },
    onError: async (error) => {
      setFamilyImageError(errorMessage(error))
      await refresh()
    },
  })
  const removeFamilyImage = useMutation({
    mutationFn: async (id: string) => updateBakeryProductFamily(id, {
      storefront: {
        published: family?.storefront.published ?? false,
        slug: family?.storefront.slug,
        description: family?.storefront.description ?? '',
        images: [],
        ingredientsStatement: family?.storefront.ingredientsStatement ?? '',
        allergens: family?.storefront.allergens ?? [],
      },
    }),
    onSuccess: async ({ imageCleanupPending: pending = 0 }) => {
      setImageCleanupPending(pending)
      setFamilyImageError('')
      setMessage(pending
        ? 'Product image removed. Cloudinary cleanup is pending.'
        : 'Product image removed.')
      await refresh()
    },
    onError: (error) => setFamilyImageError(errorMessage(error)),
  })
  const togglePublication = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      updateBakeryProductFamily(id, { storefront: { published } }),
    onSuccess: async ({ family: updated }) => {
      client.setQueryData<typeof workspace.data>(key, (current) => current && ({
        ...current,
        families: current.families.map((item) => item.id === updated.id ? { ...item, ...updated } : item),
      }))
      setMessage(`${updated.name} is now ${updated.storefront.published ? 'published' : 'unpublished'} on the website.`)
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const toggleFamilyStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateBakeryProductFamily(id, { active }),
    onSuccess: async ({ family: updated }) => {
      setMessage(`${updated.name} is now ${updated.active ? 'active' : 'inactive'}.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const saveStorefrontDetails = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateBakeryProductFamily>[1] }) =>
      updateBakeryProductFamily(id, input),
    onSuccess: async ({ family: updated }) => {
      setStorefrontSlugDraft(updated.storefront.slug || '')
      setStorefrontDescriptionDraft(updated.storefront.description || '')
      setStorefrontError('')
      setMessage(`${updated.name} website details saved.`)
      await refresh()
    },
    onError: (error) => setStorefrontError(errorMessage(error)),
  })
  const retryImageCleanup = useMutation({
    mutationFn: retryBakeryProductImageCleanup,
    onSuccess: async ({ imageCleanupPending: pending }) => {
      setImageCleanupPending(pending)
      setFamilyImageError('')
      setMessage(pending
        ? 'Some old product images could not be removed yet. Retry cleanup again later.'
        : 'Previous product image cleanup completed.')
      await refresh()
    },
    onError: (error) => setFamilyImageError(errorMessage(error)),
  })
  const addVariant = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof addBakeryVariant>[1] }) => addBakeryVariant(id, input),
    onSuccess: async ({ variant }) => {
      setMessage(`Sellable variant ${variant.sku} was added.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const updateVariant = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateBakeryProductVariant>[1] }) => updateBakeryProductVariant(id, input),
    onSuccess: async ({ variant }) => {
      setMessage(`${variant.sku} updated.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const saveRecipe = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof saveBakeryRecipe>[1] }) => saveBakeryRecipe(id, input),
    onSuccess: async ({ recipe }) => {
      setMessage(`Recipe version ${recipe.version} saved.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const startBatch = useMutation({
    mutationFn: createBakeryProductionBatch,
    onSuccess: async ({ batch: created }) => {
      setBatchId(created.id)
      setFamilyId(created.familyId)
      setMessage(`${created.reference} started with recipe version ${created.recipeVersion}.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const completeBatch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof completeBakeryProductionBatch>[1] }) => completeBakeryProductionBatch(id, input),
    onSuccess: async ({ batch: completed }) => {
      setMessage(`${completed.reference} completed and its finished-stock lot was recorded.`)
      setBatchId('')
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const writeOffLot = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof writeOffFinishedStockLot>[1] }) => writeOffFinishedStockLot(id, input),
    onSuccess: async ({ lot }) => {
      setMessage(`${lot.reference} updated after write-off.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const receiveLot = useMutation({
    mutationFn: receiveBakeryFinishedStockLot,
    onSuccess: async ({ lot }) => {
      setMessage(`${lot.reference} received into bakery finished stock.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })
  const adjustLot = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adjustBakeryFinishedStockLot>[1] }) => adjustBakeryFinishedStockLot(id, input),
    onSuccess: async ({ lot }) => {
      setMessage(`${lot.reference} adjusted. Current balance: ${lot.remainingQuantity} ${lot.saleUnit}.`)
      await refresh()
    },
    onError: (error) => setMessage(errorMessage(error)),
  })

  const submitFamily = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setMessage('')
    createFamily.mutate({
      code: String(form.get('code')).trim(),
      name: String(form.get('name')).trim(),
      category: String(form.get('category')).trim(),
      flavour: String(form.get('flavour')).trim(),
      baseUnit: String(form.get('baseUnit')).trim(),
      shelfLifeDays: Number(form.get('shelfLifeDays')),
      dateLabelType: String(form.get('dateLabelType')) as 'best_before' | 'use_by',
      storageInstructions: String(form.get('storageInstructions')).trim(),
      storefront: {
        ...(String(form.get('storefrontSlug')).trim()
          ? { slug: String(form.get('storefrontSlug')).trim() }
          : {}),
        description: String(form.get('storefrontDescription')).trim(),
      },
      variants: [{
        sku: String(form.get('sku')).trim(),
        name: String(form.get('variantName')).trim(),
        saleUnit: String(form.get('saleUnit')).trim(),
        unitsPerSaleUnit: Number(form.get('unitsPerSaleUnit')),
        price: Number(form.get('price')),
        packagingMaterials: packagingMaterialsFromForm(form, 'familyPackaging'),
      }],
    })
  }

  const submitStorefrontDetails = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!family) return
    const form = new FormData(event.currentTarget)
    setStorefrontError('')
    saveStorefrontDetails.mutate({
      id: family.id,
      input: {
        name: String(form.get('familyName')).trim(),
        category: String(form.get('familyCategory')).trim(),
        flavour: String(form.get('familyFlavour')).trim(),
        shelfLifeDays: Number(form.get('shelfLifeDays')),
        dateLabelType: String(form.get('dateLabelType')) as 'best_before' | 'use_by',
        storageInstructions: String(form.get('storageInstructions')).trim(),
        storefront: {
          ...(storefrontSlugDraft.trim() ? { slug: storefrontSlugDraft.trim() } : {}),
          description: storefrontDescriptionDraft.trim(),
        },
      },
    })
  }

  const selectFamilyImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    setFamilyImageError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFamilyImageFile(null)
      setFamilyImageError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFamilyImageFile(null)
      setFamilyImageError('Product images must be 5 MB or smaller.')
      return
    }
    setFamilyImageFile(file)
  }

  const submitFamilyImage = () => {
    if (!family || !familyImageFile) return
    setFamilyImageError('')
    saveFamilyImage.mutate({
      id: family.id,
      file: familyImageFile,
      altText: familyImageAltText.trim() || family.name,
    })
  }

  const submitVariant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!family) return
    const form = new FormData(event.currentTarget)
    setMessage('')
    addVariant.mutate({
      id: family.id,
      input: {
        sku: String(form.get('sku')).trim(),
        name: String(form.get('name')).trim(),
        saleUnit: String(form.get('saleUnit')).trim(),
        unitsPerSaleUnit: Number(form.get('unitsPerSaleUnit')),
        price: Number(form.get('price')),
        packagingMaterials: packagingMaterialsFromForm(form, 'variantPackaging'),
      },
    })
    event.currentTarget.reset()
  }

  const submitVariantUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setMessage('')
    updateVariant.mutate({
      id: String(form.get('variantId')),
      input: {
        name: String(form.get('name')).trim(),
        price: Number(form.get('price')),
        lowStockThreshold: Number(form.get('lowStockThreshold')),
      },
    })
  }

  const submitRecipe = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!family) return
    const form = new FormData(event.currentTarget)
    const ingredients = ingredientDrafts
      .filter((line) => line.materialId && Number(line.quantity) > 0)
      .map((line) => ({ materialId: line.materialId, quantityPerBatch: Number(line.quantity) }))
    setMessage('')
    saveRecipe.mutate({
      id: family.id,
      input: {
        batchYield: Number(form.get('batchYield')),
        yieldUnit: String(form.get('yieldUnit')).trim(),
        ingredients,
      },
    })
  }

  const submitBatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setMessage('')
    startBatch.mutate({
      familyId: String(form.get('familyId')),
      productionDate: String(form.get('productionDate')),
      location: String(form.get('location')).trim(),
      batchMultiplier: Number(form.get('batchMultiplier')),
      notes: String(form.get('notes') || '').trim(),
      idempotencyKey: createId('BAKERY-BATCH'),
    })
  }

  const submitCompletion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!batch || !family) return
    const form = new FormData(event.currentTarget)
    const variantId = String(form.get('variantId'))
    const actualIngredients = batch.ingredients.map((line) => ({
      materialId: line.materialId,
      actualQuantity: Number(actualDrafts[line.materialId]),
    }))
    setMessage('')
    completeBatch.mutate({
      id: batch.id,
      input: {
        actualIngredients,
        outputs: [{ variantId, quantity: Number(form.get('quantity')) }],
        wasteQuantity: Number(form.get('wasteQuantity') || 0),
        wasteReason: String(form.get('wasteReason') || '').trim(),
        expiryDate: String(form.get('expiryDate') || '') || undefined,
        dateOverrideReason: String(form.get('dateOverrideReason') || '').trim() || undefined,
        bestBeforeReviewReason: String(form.get('bestBeforeReviewReason') || '').trim() || undefined,
        idempotencyKey: createId('BAKERY-COMPLETE'),
      },
    })
  }

  const submitWriteOff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const id = String(form.get('lotId'))
    setMessage('')
    writeOffLot.mutate({
      id,
      input: {
        quantity: Number(form.get('quantity')),
        date: String(form.get('date')),
        reason: String(form.get('reason')).trim(),
        idempotencyKey: createId('BAKERY-WRITEOFF'),
      },
    })
    event.currentTarget.reset()
  }

  const submitManualReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setMessage('')
    receiveLot.mutate({
      familyId: String(form.get('familyId')),
      variantId: String(form.get('variantId')),
      quantity: Number(form.get('quantity')),
      productionDate: String(form.get('productionDate')),
      receiptDate: String(form.get('receiptDate')),
      expiryDate: String(form.get('expiryDate')),
      location: String(form.get('location')).trim(),
      reference: String(form.get('reference')).trim(),
      reason: String(form.get('reason')).trim(),
      idempotencyKey: createId('BAKERY-RECEIPT'),
    })
    event.currentTarget.reset()
  }

  const submitLotAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const id = String(form.get('lotId'))
    setMessage('')
    adjustLot.mutate({
      id,
      input: {
        direction: String(form.get('direction')) as 'in' | 'out',
        quantity: Number(form.get('quantity')),
        date: String(form.get('date')),
        reason: String(form.get('reason')).trim(),
        idempotencyKey: createId('BAKERY-ADJUSTMENT'),
      },
    })
    event.currentTarget.reset()
  }

  if (workspace.isLoading) return <p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading bakery production…</p>
  if (workspace.isError) return <section className="rounded-xl border border-rose-200 bg-rose-50 p-6"><h2 className="font-semibold text-rose-800">Bakery production data could not be loaded</h2><p className="mt-2 text-sm text-rose-700">{errorMessage(workspace.error)}</p><button type="button" onClick={() => workspace.refetch()} className="mt-3 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800">Retry</button></section>

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        {onBack && <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" /> Legacy production</button>}
        <p className="text-xs font-medium text-slate-400">Workspace / Inventory Department</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight">Production management</h2>
          {!canManage && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">View only</span>}
        </div>
        <p className="mt-1 text-sm text-slate-500">Manage bakery products, recipes, production batches, and finished stock.</p>
        <p role="note" className="mt-2 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Sales and Orders still use their existing product relationships. Bakery lots are managed here and are not dispatched through legacy beverage stock flows.</p>
      </div>
      <button type="button" onClick={() => workspace.refetch()} className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 sm:self-auto"><RefreshCw className="size-4" /> Refresh</button>
    </header>

    {message && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{message}</p>}

    <nav role="tablist" aria-label="Production management views" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 pt-2">
      {productionViews.map((view, index) => (
        <button
          key={view}
          id={`production-tab-${view}`}
          type="button"
          role="tab"
          aria-selected={activeView === view}
          aria-controls="production-panel"
          tabIndex={activeView === view ? 0 : -1}
          onClick={() => navigateView(view)}
          onKeyDown={(event) => {
            let nextIndex = index
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % productionViews.length
            else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + productionViews.length) % productionViews.length
            else if (event.key === 'Home') nextIndex = 0
            else if (event.key === 'End') nextIndex = productionViews.length - 1
            else return
            event.preventDefault()
            const nextView = productionViews[nextIndex]
            navigateView(nextView)
            document.getElementById(`production-tab-${nextView}`)?.focus()
          }}
          className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${activeView === view ? 'border-primary text-primary' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
        >
          {view === 'products'
            ? `${productionViewLabels[view]} (${families.length.toLocaleString()})`
            : productionViewLabels[view]}
        </button>
      ))}
    </nav>

    {activeView === 'overview' && <section id="production-panel" role="tabpanel" aria-labelledby="production-tab-overview" tabIndex={0} className="space-y-4 outline-none">
      <div>
        <h3 className="text-base font-bold text-slate-900">Production overview</h3>
        <p className="mt-1 text-xs text-slate-500">A quick view of your bakery catalog, active work, and sellable stock.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active product families', value: families.filter((item) => item.active).length.toLocaleString(), detail: `${families.length} total families` },
          { label: 'Active sellable SKUs', value: families.filter((item) => item.active).reduce((total, item) => total + item.variants.filter((variant) => variant.active).length, 0).toLocaleString(), detail: 'Within active product families' },
          { label: 'Batches in progress', value: activeBatches.length.toLocaleString(), detail: 'Awaiting measured completion' },
          { label: 'Available finished units', value: availableStock.toLocaleString(), detail: 'On hand less reserved quantity' },
        ].map((metric) => <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{metric.label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{metric.value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{metric.detail}</p>
        </article>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold">Batches in progress</h3><p className="mt-1 text-xs text-slate-500">Continue work and record actual ingredient use.</p></div>
            <button type="button" onClick={() => navigateView('batches')} className="text-xs font-semibold text-primary hover:underline">View batches</button>
          </div>
          {activeBatches.length ? <ul className="mt-3 divide-y divide-slate-100">{activeBatches.slice(0, 4).map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="min-w-0"><strong className="block truncate text-slate-800">{item.reference}</strong><span className="text-slate-500">{item.familyName} · {item.productionDate}</span></span><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">In progress</span></li>)}</ul> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No batches are currently in progress.</p>}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold">Quick actions</h3><p className="mt-1 text-xs text-slate-500">Jump to a common production task.</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {canManage && <button type="button" onClick={() => navigateView('batches')} className="min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Plus className="mr-1 inline size-3.5" /> Start a batch</button>}
            {canManage && <button type="button" onClick={() => { navigateView('products'); openCreateProduct() }} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><Plus className="mr-1 inline size-3.5" /> Add a product</button>}
            <button type="button" onClick={() => navigateView('stock')} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Review finished stock</button>
          </div>
          {!canManage && <p className="mt-3 text-xs text-slate-500">You have view-only access to production setup and batches.</p>}
        </section>
      </div>
    </section>}

    {activeView === 'products' && <section id="production-panel" role="tabpanel" aria-labelledby="production-tab-products" tabIndex={0} className="space-y-3 outline-none">
      <div>
        <h3 className="text-sm font-bold">Bakery product families and sellable SKUs</h3>
        <p className="mt-1 text-xs text-slate-500">Manage bakery product details and sellable variants. Legacy beverage products are not included.</p>
      </div>
      {!canManage && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">You can review product details, but editing is restricted by your role.</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} aria-label="Search products" placeholder="Search families, categories, or SKUs" className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" /></label>
        {canManage && <button type="button" onClick={openCreateProduct} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"><Plus className="size-4" /> Add product</button>}
      </div>
      {filteredFamilies.length
        ? <div className="space-y-3">
          {filteredFamilies.map((item) => {
            const busy = togglePublication.isPending || updateVariant.isPending || toggleFamilyStatus.isPending
            const familyStatusSaving = toggleFamilyStatus.isPending && toggleFamilyStatus.variables?.id === item.id
            const publicationSaving = togglePublication.isPending && togglePublication.variables?.id === item.id
            const publishedDate = item.storefront.firstPublishedAt
              ? new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'Africa/Kampala' }).format(new Date(item.storefront.firstPublishedAt))
              : ''
            return <article key={item.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-400">{item.storefront.images[0]?.url ? <img src={item.storefront.images[0].url} alt="" className="size-full object-cover" /> : <PackageCheck className="size-5" />}</div>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item.name}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.code} · {item.category}{item.flavour ? ` · ${item.flavour}` : ''}</p></div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>{item.active ? 'Active' : 'Inactive'}</span>
                    <span>{item.recipe ? `Recipe v${item.recipe.version}` : 'No recipe'}</span>
                    <span className={item.storefront.published ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-500'}>
                      {item.storefront.published ? 'Published' : 'Unpublished'}
                    </span>
                    {publishedDate && <span>First published {publishedDate}</span>}
                  </div>
                </div>
                {canManage && <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => openEditProduct(item)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Edit profile</button>
                  <button
                    type="button"
                    onClick={() => toggleFamilyStatus.mutate({ id: item.id, active: !item.active })}
                    disabled={busy || (item.active && item.storefront.published)}
                    aria-label={`${item.active ? 'Deactivate' : 'Activate'} ${item.name}`}
                    className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {familyStatusSaving ? 'Saving…' : item.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessage('')
                      togglePublication.mutate({ id: item.id, published: !item.storefront.published })
                    }}
                    disabled={busy || (!item.active && !item.storefront.published)}
                    aria-label={`${item.storefront.published ? 'Unpublish' : 'Publish'} ${item.name}`}
                    className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${item.storefront.published ? 'border border-rose-200 text-rose-700' : 'bg-primary text-primary-foreground'}`}
                  >
                    {publicationSaving
                      ? 'Saving…'
                      : item.storefront.published
                        ? 'Unpublish'
                        : item.active
                          ? 'Publish'
                          : 'Activate to publish'}
                  </button>
                </div>}
              </div>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {item.variants.map((variant) => <div key={variant.id} className="flex flex-col gap-2 rounded-md bg-slate-50 p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-semibold text-slate-700">{variant.sku} · {variant.name}<span className="ml-1 font-normal text-slate-500">({variant.unitsPerSaleUnit} base {item.baseUnit} per {variant.saleUnit}) · {variant.active ? 'Active' : 'Inactive'}</span></div>
                  {canManage && <div className="flex flex-wrap items-center gap-2">
                    <form onSubmit={submitVariantUpdate} className="flex items-center gap-1">
                      <input type="hidden" name="variantId" value={variant.id} />
                      <input aria-label={`Variant name ${variant.sku}`} name="name" defaultValue={variant.name} maxLength={160} className="w-32 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                      <input aria-label={`Variant price ${variant.sku}`} name="price" type="number" min="1" step="1" defaultValue={variant.price} className="w-24 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                      <label className="flex items-center gap-1 text-[10px] font-medium text-slate-500">Low stock at
                        <input aria-label={`Low-stock threshold for ${variant.sku}`} name="lowStockThreshold" type="text" inputMode="numeric" pattern="[0-9]+" required defaultValue={variant.lowStockThreshold ?? 10} className="w-16 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800" />
                        {variant.saleUnit}
                      </label>
                      <button type="submit" disabled={busy} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold disabled:opacity-40">Save</button>
                    </form>
                    <button type="button" disabled={busy} onClick={() => updateVariant.mutate({ id: variant.id, input: { active: !variant.active } })} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold disabled:opacity-40">{variant.active ? 'Deactivate' : 'Activate'}</button>
                  </div>}
                </div>)}
              </div>
            </article>
          })}
        </div>
        : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><h4 className="text-sm font-semibold text-slate-800">{families.length ? 'No matching products' : 'No bakery products yet'}</h4><p className="mt-1 text-xs text-slate-500">{families.length ? 'Try another family, category, or SKU.' : 'Create a product family and first SKU to get started.'}</p>{canManage && !families.length && <button type="button" onClick={openCreateProduct} className="mt-4 min-h-10 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Create first product</button>}</div>}
    </section>}

    {productDrawerOpen && canManage && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !createFamily.isPending && !saveStorefrontDetails.isPending && !saveFamilyImage.isPending && !addVariant.isPending) setProductDrawerOpen(false) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="product-drawer-title" className="max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
      <div className="min-w-0"><h2 id="product-drawer-title" className="text-base font-bold text-slate-900">{productDrawerMode === 'create' ? 'Create bakery product' : `Edit ${family?.name ?? 'product profile'}`}</h2><p className="mt-1 text-xs text-slate-500">{productDrawerMode === 'create' ? 'Create a product family and its first sellable SKU.' : 'Update product details, image, and sellable SKUs.'}</p></div>
      <div className="flex shrink-0 items-center gap-2">
        {productDrawerMode === 'edit' && family && <button type="submit" form={`product-details-${family.id}`} disabled={saveStorefrontDetails.isPending} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saveStorefrontDetails.isPending ? 'Saving…' : 'Save changes'}</button>}
        <button ref={drawerCloseButton} type="button" aria-label="Close product drawer" onClick={() => setProductDrawerOpen(false)} disabled={createFamily.isPending || saveStorefrontDetails.isPending || saveFamilyImage.isPending || addVariant.isPending} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X className="size-4" /></button>
      </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">
      {productDrawerMode === 'create' && <form onSubmit={submitFamily} className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-bold"><PackageCheck className="size-4 text-primary" /> Create product family and first SKU</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Family code"><input required name="code" maxLength={40} className={inputClass} /></Field>
          <Field label="Product family"><input required name="name" maxLength={160} className={inputClass} /></Field>
          <Field label="Category"><input required name="category" maxLength={80} placeholder="Bread, cookies…" className={inputClass} /></Field>
          <Field label="Flavour"><input name="flavour" maxLength={80} placeholder="Optional" className={inputClass} /></Field>
          <Field label="Website slug (optional)"><input name="storefrontSlug" maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="classic-country-loaf" className={inputClass} /></Field>
          <Field label="Website description (optional)"><textarea name="storefrontDescription" maxLength={2000} rows={2} className={inputClass} /></Field>
          <Field label="Base unit"><input required name="baseUnit" maxLength={24} placeholder="piece" className={inputClass} /></Field>
          <Field label="Shelf life (days)"><input required name="shelfLifeDays" type="number" min="0.25" max="365" step="0.25" defaultValue="2" className={inputClass} /></Field>
          <Field label="Date label"><select name="dateLabelType" className={inputClass}><option value="best_before">Best before</option><option value="use_by">Use by</option></select></Field>
          <Field label="Storage guidance"><input name="storageInstructions" maxLength={500} className={inputClass} /></Field>
          <Field label="First SKU"><input required name="sku" maxLength={40} className={inputClass} /></Field>
          <Field label="Variant name"><input required name="variantName" maxLength={160} placeholder="12-piece pack" className={inputClass} /></Field>
          <Field label="Sale unit"><input required name="saleUnit" maxLength={40} placeholder="pack" className={inputClass} /></Field>
          <Field label="Base units per sale unit"><input required name="unitsPerSaleUnit" type="number" min="1" step="1" defaultValue="1" className={inputClass} /></Field>
          <Field label="Price (UGX)"><input required name="price" type="number" min="1" step="1" className={inputClass} /></Field>
          <PackagingMaterialsFields materials={packagingMaterials} prefix="familyPackaging" />
        </div>
        {message && <p role="status" className="text-xs text-amber-800">{message}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setProductDrawerOpen(false)} disabled={createFamily.isPending} className="min-h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold">Cancel</button><button type="submit" disabled={createFamily.isPending} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40">{createFamily.isPending ? 'Saving…' : 'Create product'}</button></div>
      </form>}

      {productDrawerMode === 'edit' && <div className="space-y-4">
        <form id={`product-details-${family?.id ?? 'none'}`} key={`family-details-${family?.id ?? 'none'}`} onSubmit={submitStorefrontDetails} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <h3 className="text-sm font-bold">Website product details</h3>
            <p className="mt-1 text-[11px] text-slate-500">Family and date-label changes apply to future batches; existing recipe and lot snapshots remain unchanged.</p>
          </div>
          {family ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Family name"><input required name="familyName" defaultValue={family.name} maxLength={160} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending} /></Field>
              <Field label="Category"><input required name="familyCategory" defaultValue={family.category} maxLength={80} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending} /></Field>
              <Field label="Flavour"><input name="familyFlavour" defaultValue={family.flavour} maxLength={80} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending} /></Field>
              <Field label="Shelf life (days)"><input required name="shelfLifeDays" type="number" min="0.25" max="365" step="0.25" defaultValue={family.shelfLifeDays} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending} /></Field>
              <Field label="Date label"><select name="dateLabelType" defaultValue={family.dateLabelType} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending}><option value="best_before">Best before</option><option value="use_by">Use by</option></select></Field>
              <Field label="Storage guidance"><input name="storageInstructions" defaultValue={family.storageInstructions} maxLength={500} className={inputClass} disabled={!canManage || saveStorefrontDetails.isPending} /></Field>
            </div>
            <Field label="Website slug">
              <input
                value={storefrontSlugDraft}
                onChange={(event) => setStorefrontSlugDraft(event.target.value)}
                maxLength={120}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="classic-country-loaf"
                className={inputClass}
                disabled={!canManage || saveStorefrontDetails.isPending}
              />
            </Field>
            <Field label="Website description">
              <textarea
                value={storefrontDescriptionDraft}
                onChange={(event) => setStorefrontDescriptionDraft(event.target.value)}
                maxLength={2000}
                rows={3}
                className={inputClass}
                disabled={!canManage || saveStorefrontDetails.isPending}
              />
            </Field>
            {storefrontError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{storefrontError}</p>}
          </> : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Select a product family to edit its website details.</p>}
        </form>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold"><ImagePlus className="size-4 text-primary" /> Product profile image</h3>
            <p className="mt-1 text-[11px] text-slate-500">One primary image for the selected product family · JPEG, PNG, or WebP · up to 5 MB.</p>
          </div>
          {family ? <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
                {(familyImagePreview || family.storefront.images[0]?.url)
                  ? <img
                    src={familyImagePreview || family.storefront.images[0]?.url || ''}
                    alt={familyImageAltText || family.name}
                    className="size-full object-cover"
                  />
                  : <ImagePlus className="size-8" />}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-xs font-semibold text-slate-700">{family.name}</p>
                <label className="block text-xs font-semibold text-slate-600">Image alt text
                  <input
                    value={familyImageAltText}
                    onChange={(event) => setFamilyImageAltText(event.target.value)}
                    maxLength={240}
                    className={inputClass}
                  />
                </label>
                <input
                  ref={familyImageInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Choose product image"
                  onChange={selectFamilyImage}
                  disabled={saveFamilyImage.isPending || !canManage}
                  className="sr-only"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => familyImageInput.current?.click()}
                    disabled={saveFamilyImage.isPending || !canManage}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40"
                  >
                    <Upload className="size-3.5" /> Choose image
                  </button>
                  {familyImageFile && <button
                    type="button"
                    onClick={submitFamilyImage}
                    disabled={saveFamilyImage.isPending || !canManage}
                    className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {saveFamilyImage.isPending ? 'Uploading…' : 'Upload image'}
                  </button>}
                  {!familyImageFile && family.storefront.images[0] && <button
                    type="button"
                    onClick={() => removeFamilyImage.mutate(family.id)}
                    disabled={removeFamilyImage.isPending || !canManage}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" /> {removeFamilyImage.isPending ? 'Removing…' : 'Remove image'}
                  </button>}
                </div>
              </div>
            </div>
            {familyImageError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{familyImageError}</p>}
            {imageCleanupPending > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-900">{imageCleanupPending} previous image{imageCleanupPending === 1 ? '' : 's'} still need Cloudinary cleanup.</p>
              <button
                type="button"
                onClick={() => retryImageCleanup.mutate(family.id)}
                disabled={retryImageCleanup.isPending || !canManage}
                className="min-h-8 rounded-md border border-amber-300 px-2.5 text-xs font-semibold text-amber-900 disabled:opacity-40"
              >
                {retryImageCleanup.isPending ? 'Retrying…' : 'Retry cleanup'}
              </button>
            </div>}
          </> : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Create or select a product family to add its image.</p>}
        </section>

        <form onSubmit={submitVariant} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <h3 className="text-sm font-bold sm:col-span-2">Add sellable variant to {family?.name ?? 'a family'}</h3>
          <Field label="SKU"><input required name="sku" maxLength={40} className={inputClass} /></Field><Field label="Variant name"><input required name="name" maxLength={160} className={inputClass} /></Field>
          <Field label="Sale unit"><input required name="saleUnit" maxLength={40} className={inputClass} /></Field><Field label="Base units per sale unit"><input required name="unitsPerSaleUnit" type="number" min="1" step="1" defaultValue="1" className={inputClass} /></Field>
          <Field label="Price (UGX)"><input required name="price" type="number" min="1" step="1" className={inputClass} /></Field>
          <PackagingMaterialsFields materials={packagingMaterials} prefix="variantPackaging" />
          <button type="submit" disabled={!family || addVariant.isPending} className="mt-5 min-h-11 rounded-lg border border-slate-200 px-4 text-xs font-semibold disabled:opacity-40">{addVariant.isPending ? 'Adding…' : 'Add variant'}</button>
        </form>
      </div>}
      </div>
      </section>
    </div>}

    {activeView === 'recipes' && <section id="production-panel" role="tabpanel" aria-labelledby="production-tab-recipes" tabIndex={0} className="space-y-4 outline-none">
      <div><h3 className="text-base font-bold text-slate-900">Recipes and versions</h3><p className="mt-1 text-xs text-slate-500">Each save creates a new recipe version; batches keep the recipe snapshot they started with.</p></div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <Field label="Product family"><select aria-label="Recipe family" value={familyId} onChange={(event) => { const selectedFamily = families.find((item) => item.id === event.target.value); setFamilyId(event.target.value); setIngredientDrafts(ingredientsFromFamily(selectedFamily)); setStorefrontSlugDraft(selectedFamily?.storefront.slug || ''); setStorefrontDescriptionDraft(selectedFamily?.storefront.description || '') }} className={inputClass}><option value="">Select family</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        {!canManage && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">View only: recipe changes are restricted by your role.</p>}
        {family ? <>
          <div className="mt-4 flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold text-slate-800">{family.name}</h4><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{family.recipe ? `Current version ${family.recipe.version}` : 'No recipe yet'}</span></div>
          {canManage ? <form key={`family-recipe-${family.id}-${family.recipe?.version ?? 'none'}`} onSubmit={submitRecipe} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected yield per batch"><input required name="batchYield" type="number" min="0.000001" step="any" defaultValue={family.recipe?.batchYield ?? ''} className={inputClass} /></Field><Field label="Yield unit"><input required name="yieldUnit" maxLength={40} defaultValue={family.recipe?.yieldUnit ?? family.baseUnit ?? ''} className={inputClass} /></Field></div>
            <div className="space-y-2">{ingredientDrafts.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]"><Field label={`Ingredient ${index + 1}`}><select required value={line.materialId} onChange={(event) => setIngredientDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, materialId: event.target.value } : row))} className={inputClass}><option value="">Select ingredient</option>{ingredientMaterials.map((material) => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</select></Field><Field label="Quantity per batch"><input required type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => setIngredientDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={inputClass} /></Field><button type="button" aria-label="Remove ingredient" disabled={ingredientDrafts.length === 1} onClick={() => setIngredientDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="mt-5 min-h-10 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Remove</button></div>)}</div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setIngredientDrafts((rows) => [...rows, { materialId: '', quantity: '' }])} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Plus className="size-4" /> Add ingredient</button><button type="submit" disabled={!ingredientDrafts.length || saveRecipe.isPending} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saveRecipe.isPending ? 'Saving…' : family.recipe ? 'Save new version' : 'Create recipe'}</button></div>
          </form> : family.recipe ? <div className="mt-4 space-y-2 text-xs text-slate-600"><p>Yield: {family.recipe.batchYield.toLocaleString()} {family.recipe.yieldUnit} per batch</p>{family.recipe.ingredients.map((line) => <p key={line.materialId}>{line.materialName}: {line.quantityPerBatch.toLocaleString()} {line.unit}</p>)}</div> : <p className="mt-4 text-xs text-slate-500">No recipe has been saved for this product family.</p>}
        </> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Create a product family before adding a recipe.</p>}
      </section>
    </section>}

    {activeView === 'batches' && <section id="production-panel" role="tabpanel" aria-labelledby="production-tab-batches" tabIndex={0} className="space-y-4 outline-none">
      <div><h3 className="text-base font-bold text-slate-900">Production batches</h3><p className="mt-1 text-xs text-slate-500">Start a batch from the current recipe, record measured use, and review batch history.</p></div>
      {!canManage && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">View only: starting and completing batches is restricted by your role.</p>}
      {canManage && <div className="grid gap-4 xl:grid-cols-2">
      <form onSubmit={submitBatch} className="grid content-start gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <h3 className="text-sm font-bold sm:col-span-2">Start production batch</h3>
        <Field label="Product family"><select required name="familyId" defaultValue={familyId} className={inputClass}><option value="">Select family</option>{families.filter((item) => item.active && item.recipe).map((item) => <option key={item.id} value={item.id}>{item.name} · recipe v{item.recipe?.version}</option>)}</select></Field>
        <Field label="Production date"><input required name="productionDate" type="date" max={today()} defaultValue={today()} className={inputClass} /></Field>
        <Field label="Location"><input required name="location" defaultValue="Main Warehouse" maxLength={100} className={inputClass} /></Field>
        <Field label="Batch multiplier"><input required name="batchMultiplier" type="number" min="0.000001" max="1000" step="any" defaultValue="1" className={inputClass} /></Field>
        <Field label="Batch notes"><input name="notes" maxLength={500} placeholder="Optional process or operator note" className={inputClass} /></Field>
        <button type="submit" disabled={startBatch.isPending || !families.some((item) => item.active && item.recipe)} className="min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2">{startBatch.isPending ? 'Starting…' : 'Start batch'}</button>
      </form>

      <form onSubmit={submitCompletion} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Record measured use and complete batch</h3>
        <Field label="In-progress batch"><select required value={batchId} onChange={(event) => setBatchId(event.target.value)} className={inputClass}><option value="">Select batch</option>{activeBatches.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.familyName}</option>)}</select></Field>
        {batch && family && batch.familyId === family.id ? <>
          <div className="space-y-2">{batch.ingredients.map((line) => <Field key={line.materialId} label={`${line.materialName} · expected ${line.expectedQuantity} ${line.unit}`}><input required type="number" min="0" step="any" value={actualDrafts[line.materialId] ?? ''} onChange={(event) => setActualDrafts((values) => ({ ...values, [line.materialId]: event.target.value }))} className={inputClass} /></Field>)}</div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Finished SKU"><select required name="variantId" className={inputClass}>{family.variants.filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku} · {variant.name}</option>)}</select></Field><Field label="Finished sale units"><input required name="quantity" type="number" min="1" step="1" className={inputClass} /></Field><Field label="Waste quantity"><input name="wasteQuantity" type="number" min="0" step="any" defaultValue="0" className={inputClass} /></Field><Field label="Waste reason"><input name="wasteReason" className={inputClass} /></Field><Field label="Expiry override (optional)"><input name="expiryDate" type="date" min={batch.productionDate} className={inputClass} /></Field><Field label="Override reason"><input name="dateOverrideReason" maxLength={500} className={inputClass} /></Field><Field label="Best-before supervisor review (if needed)"><input name="bestBeforeReviewReason" maxLength={500} className={inputClass} /></Field></div>
          <p className="text-[11px] text-slate-500">Expected expiry: {batch.productionDate} plus {batch.shelfLifeDays} shelf-life days snapshotted when the batch started. A different date requires a reason.</p>
          <button type="submit" disabled={completeBatch.isPending || !family.variants.some((variant) => variant.active)} className="min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40">{completeBatch.isPending ? 'Posting…' : 'Complete batch and post stock'}</button>
        </> : <p className="text-xs text-slate-500">{activeBatches.length ? 'Select an in-progress batch. Its recipe snapshot determines the measured ingredient list.' : 'No in-progress batches.'}</p>}
      </form>
      </div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-bold">Batch history</h3><p className="mt-1 text-xs text-slate-500">{batches.length} batches · expected quantities are snapshots from the selected recipe version.</p></div>
        {!batches.length ? <p className="p-5 text-xs text-slate-500">No bakery batches recorded.</p> : <div className="max-h-96 overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Reference</th><th className="p-3">Date / product</th><th className="p-3">Recipe</th><th className="p-3">Yield planned / actual</th><th className="p-3">Status</th><th className="p-3">Expiry</th></tr></thead><tbody>{batches.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 font-mono">{item.reference}</td><td className="p-3">{item.productionDate} · {item.familyName}<div className="text-slate-500">{item.notes}</div></td><td className="p-3">v{item.recipeVersion} × {item.batchMultiplier}</td><td className="p-3">{(item.batchYield * item.batchMultiplier).toLocaleString()} / {item.actualYield?.toLocaleString() ?? '—'} {item.yieldUnit}</td><td className="p-3">{item.status}</td><td className="p-3">{item.expiryDate ?? 'Pending'}</td></tr>)}</tbody></table></div>}
      </div>
    </section>}

    {activeView === 'stock' && <section id="production-panel" role="tabpanel" aria-labelledby="production-tab-stock" tabIndex={0} className="space-y-4 outline-none">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="text-base font-bold text-slate-900">Finished stock</h3><p className="mt-1 text-xs text-slate-500">Review lot balances, post allowed stock actions, and trace finished-stock movements.</p></div>
        {!canManageInventory && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Receiving and adjustments require inventory-management access.</p>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-bold">Finished stock lots</h3><p className="mt-1 text-xs text-slate-500">Production and manual receipt lots with dated stock movements and lot-level balances.</p></div>
        {stockBySku.length > 0 && <div className="border-b border-slate-100 p-4">
          <h4 className="text-xs font-bold">Current stock by SKU</h4>
          <div className="mt-2 overflow-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr><th className="p-2">SKU</th><th className="p-2">On hand</th><th className="p-2">Reserved</th><th className="p-2">Available</th></tr></thead><tbody>{stockBySku.map((balance) => <tr key={balance.sku} className="border-t border-slate-100"><td className="p-2">{balance.sku} · {balance.productName}</td><td className="p-2">{balance.remainingQuantity} {balance.saleUnit}</td><td className="p-2">{balance.reservedQuantity} {balance.saleUnit}</td><td className="p-2 font-semibold">{balance.remainingQuantity - balance.reservedQuantity} {balance.saleUnit}</td></tr>)}</tbody></table></div>
        </div>}
        {canManageInventory && <form onSubmit={submitManualReceipt} className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <h4 className="text-xs font-bold sm:col-span-2 xl:col-span-4">Receive bakery finished stock</h4>
          <Field label="Product family"><select required name="familyId" value={receiptFamilyId} onChange={(event) => setReceiptFamilyId(event.target.value)} className={inputClass}><option value="">Select family</option>{families.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Sellable SKU"><select required name="variantId" className={inputClass}><option value="">Select SKU</option>{receiptFamily?.variants.filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku} · {variant.name}</option>)}</select></Field>
          <Field label="Quantity"><input required name="quantity" type="number" min="1" step="1" className={inputClass} /></Field>
          <Field label="Location"><input required name="location" maxLength={100} defaultValue="Main Warehouse" className={inputClass} /></Field>
          <Field label="Production date"><input required name="productionDate" type="date" max={today()} defaultValue={today()} className={inputClass} /></Field>
          <Field label="Receipt date"><input required name="receiptDate" type="date" max={today()} defaultValue={today()} className={inputClass} /></Field>
          <Field label="Expiry / best-before date"><input required name="expiryDate" type="date" className={inputClass} /></Field>
          <Field label="Receipt reference"><input required name="reference" maxLength={100} className={inputClass} /></Field>
          <Field label="Reason"><input required name="reason" maxLength={300} className={inputClass} /></Field>
          <button type="submit" disabled={receiveLot.isPending || !receiptFamily?.variants.some((variant) => variant.active)} className="min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2 xl:col-span-4">{receiveLot.isPending ? 'Receiving…' : 'Post manual receipt'}</button>
        </form>}
        {!lots.length ? <p className="p-5 text-xs text-slate-500">No finished-stock lots recorded.</p> : <div className="max-h-96 overflow-auto"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Lot / SKU</th><th className="p-3">Produced</th><th className="p-3">Remaining</th><th className="p-3">Dates</th><th className="p-3">Source / status</th>{canManageInventory && <th className="p-3">Adjustment</th>}{canManage && <th className="p-3">Write-off</th>}</tr></thead><tbody>{lots.map((lot) => <tr key={lot.id} className="border-t border-slate-100"><td className="p-3">{lot.reference}<div className="text-slate-500">{lot.sku} · {lot.productName} · {lot.location}</div></td><td className="p-3">{lot.producedQuantity} {lot.saleUnit}</td><td className="p-3">{lot.remainingQuantity} {lot.saleUnit}</td><td className="p-3">{lot.productionDate}<div className="text-slate-500">{lot.dateLabelType.replace('_', ' ')} · {lot.expiryDate}</div></td><td className="p-3">{lot.sourceType === 'manual_receipt' ? 'Manual receipt' : lot.sourceType === 'legacy_migration' ? 'Legacy migration' : 'Bakery production'}<div className="text-slate-500">{lot.status}</div></td>{canManageInventory && <td className="p-2">{lot.status !== 'written_off' && <form onSubmit={submitLotAdjustment} className="flex min-w-[340px] gap-1"><input type="hidden" name="lotId" value={lot.id} /><select aria-label={`Adjustment direction for ${lot.reference}`} name="direction" className="w-20 rounded border border-slate-200 px-1 py-1.5"><option value="in">Increase</option><option value="out">Decrease</option></select><input aria-label={`Adjustment quantity for ${lot.reference}`} required name="quantity" type="number" min="1" step="1" placeholder="Qty" className="w-16 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Adjustment date for ${lot.reference}`} required name="date" type="date" defaultValue={today()} max={today()} className="w-32 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Adjustment reason for ${lot.reference}`} required name="reason" maxLength={300} placeholder="Reason" className="w-24 rounded border border-slate-200 px-2 py-1.5" /><button type="submit" disabled={adjustLot.isPending} className="rounded border border-slate-200 px-2 py-1.5 font-semibold disabled:opacity-40">Post</button></form>}</td>}{canManage && <td className="p-2">{lot.status === 'active' && lot.remainingQuantity > lot.reservedQuantity && <form onSubmit={submitWriteOff} className="flex min-w-[280px] gap-1"><input type="hidden" name="lotId" value={lot.id} /><input aria-label={`Write-off quantity for ${lot.reference}`} required name="quantity" type="number" min="1" max={lot.remainingQuantity - lot.reservedQuantity} step="1" placeholder="Qty" className="w-16 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Write-off reason for ${lot.reference}`} required name="reason" placeholder="Reason" className="w-24 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Write-off date for ${lot.reference}`} required name="date" type="date" defaultValue={today()} max={today()} className="w-32 rounded border border-slate-200 px-2 py-1.5" /><button type="submit" disabled={writeOffLot.isPending} className="rounded border border-rose-200 px-2 py-1.5 font-semibold text-rose-700 disabled:opacity-40">Write off</button></form>}</td>}</tr>)}</tbody></table></div>}
        <div className="border-t border-slate-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-sm font-bold">Finished-stock movement history</h4><p className="mt-1 text-xs text-slate-500">{lotMovements.length} movements</p></div><label className="relative block w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} aria-label="Search stock movements" placeholder="Search reference, SKU, or reason" className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30" /></label></div>
          {!filteredMovements.length ? <p className="mt-3 text-xs text-slate-500">{lotMovements.length ? 'No movements match your search.' : 'No finished-stock movements recorded.'}</p> : <div className="mt-3 max-h-64 overflow-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Lot / SKU</th><th className="p-2">Movement</th><th className="p-2">Quantity</th><th className="p-2">Reason</th></tr></thead><tbody>{filteredMovements.map((movement) => <tr key={movement.id} className="border-t border-slate-100"><td className="p-2">{movement.date}</td><td className="p-2">{movement.lotReference}<div className="text-slate-500">{movement.sku} · {movement.productName}</div></td><td className="p-2">{movement.type}</td><td className="p-2">{movement.direction === 'out' ? '−' : '+'}{movement.quantity} {movement.saleUnit}</td><td className="p-2">{movement.reason || '—'}</td></tr>)}</tbody></table></div>}
        </div>
      </div>
    </section>}
  </div>
}
