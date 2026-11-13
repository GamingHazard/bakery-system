'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Factory, ImagePlus, PackageCheck, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { createId } from '@/lib/erp'
import {
  addBakeryVariant,
  completeBakeryProductionBatch,
  createBakeryProductFamily,
  createBakeryProductionBatch,
  deleteUnattachedBakeryProductImage,
  listBakeryProductFamilies,
  listBakeryProductionBatches,
  listFinishedStockLots,
  listProductionMaterials,
  retryBakeryProductImageCleanup,
  saveBakeryRecipe,
  updateBakeryProductFamily,
  uploadBakeryProductImage,
  writeOffFinishedStockLot,
  type BakeryProductFamily,
  type ProductionMaterial,
} from '@/lib/user-api'

type Props = {
  canManage: boolean
  onBack: () => void
}

type IngredientDraft = { materialId: string; quantity: string }
type PackagingDraft = { materialId: string; quantity: string }
const key = ['bakery-production']
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:bg-slate-50'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The bakery request could not be completed.'

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

export default function BakeryProductionManagement({ canManage, onBack }: Props) {
  const client = useQueryClient()
  const [familyId, setFamilyId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [familyImageFile, setFamilyImageFile] = useState<File | null>(null)
  const [familyImagePreview, setFamilyImagePreview] = useState('')
  const [familyImageAltText, setFamilyImageAltText] = useState('')
  const [familyImageError, setFamilyImageError] = useState('')
  const [imageCleanupPending, setImageCleanupPending] = useState(0)
  const familyImageInput = useRef<HTMLInputElement>(null)
  const [ingredientDrafts, setIngredientDrafts] = useState<IngredientDraft[]>([{ materialId: '', quantity: '' }])
  const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const workspace = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [familyResult, batchResult, lotResult, materialResult] = await Promise.all([
        listBakeryProductFamilies(),
        listBakeryProductionBatches(),
        listFinishedStockLots(),
        listProductionMaterials(),
      ])
      return {
        families: familyResult.families,
        batches: batchResult.batches,
        lots: lotResult.lots,
        materials: materialResult.materials,
      }
    },
  })
  const families = workspace.data?.families ?? []
  const batches = workspace.data?.batches ?? []
  const lots = workspace.data?.lots ?? []
  const materials = (workspace.data?.materials ?? []).filter((material) => material.active)
  const packagingMaterials = materials.filter((material) => material.category === 'Packaging')
  const family = families.find((item) => item.id === familyId)
  const activeBatches = batches.filter((batch) => batch.status === 'in_progress')
  const batch = activeBatches.find((item) => item.id === batchId)
  const refresh = () => client.invalidateQueries({ queryKey: key })

  useEffect(() => {
    if (!familyId && families.length) setFamilyId(families.find((item) => item.active)?.id ?? families[0].id)
  }, [families, familyId])

  useEffect(() => {
    if (!batchId && activeBatches.length) setBatchId(activeBatches[0].id)
  }, [activeBatches, batchId])

  useEffect(() => {
    setFamilyImageAltText(family?.storefront.images[0]?.altText || family?.name || '')
    setFamilyImageFile(null)
    setFamilyImageError('')
    setImageCleanupPending(family?.imageCleanupPending ?? 0)
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
    if (batch && batch.familyId !== familyId) setFamilyId(batch.familyId)
  }, [batch?.id, batch?.familyId, familyId])

  useEffect(() => {
    setActualDrafts(Object.fromEntries((batch?.ingredients ?? []).map((line) => [line.materialId, String(line.expectedQuantity)])))
  }, [batch?.id])

  const createFamily = useMutation({
    mutationFn: createBakeryProductFamily,
    onSuccess: async ({ family: created }) => {
      setFamilyId(created.id)
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
          throw new Error(`The image could not be saved, and its temporary Cloudinary upload could not be removed: ${errorMessage(cleanupError)}`)
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

  if (workspace.isLoading) return <p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading bakery production…</p>
  if (workspace.isError) return <section className="rounded-xl border border-rose-200 bg-rose-50 p-6"><h2 className="font-semibold text-rose-800">Bakery production data could not be loaded</h2><p className="mt-2 text-sm text-rose-700">{errorMessage(workspace.error)}</p><button type="button" onClick={() => workspace.refetch()} className="mt-3 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800">Retry</button></section>

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><button type="button" onClick={onBack} className="mb-3 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" /> Legacy production</button><p className="text-xs font-medium text-slate-400">Production / Bakery</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Bakery production</h2><p className="mt-1 text-sm text-slate-500">Versioned recipes, measured batch use, sellable variants, and dated finished lots.</p><p role="note" className="mt-2 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Bakery lots are not yet connected to Sales or Orders; do not dispatch them through the legacy drink-product sales flow.</p></div>
      <button type="button" onClick={() => workspace.refetch()} className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 sm:self-auto"><RefreshCw className="size-4" /> Refresh</button>
    </header>

    {message && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{message}</p>}

    {canManage && <section className="grid gap-4 xl:grid-cols-2">
      <form onSubmit={submitFamily} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold"><PackageCheck className="size-4 text-primary" /> Create product family and first SKU</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Family code"><input required name="code" maxLength={40} className={inputClass} /></Field>
          <Field label="Product family"><input required name="name" maxLength={160} className={inputClass} /></Field>
          <Field label="Category"><input required name="category" maxLength={80} placeholder="Bread, cookies…" className={inputClass} /></Field>
          <Field label="Flavour"><input name="flavour" maxLength={80} placeholder="Optional" className={inputClass} /></Field>
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
        <button type="submit" disabled={createFamily.isPending} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">{createFamily.isPending ? 'Saving…' : 'Create family'}</button>
      </form>

      <div className="space-y-4">
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

        <form key={family?.id ?? 'no-family'} onSubmit={submitRecipe} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold"><Factory className="size-4 text-primary" /> Save a recipe version</h3>
            <select aria-label="Recipe family" value={familyId} onChange={(event) => { setFamilyId(event.target.value); setIngredientDrafts(ingredientsFromFamily(families.find((item) => item.id === event.target.value))) }} className="min-h-10 rounded-lg border border-slate-200 px-2 text-xs"><option value="">Select family</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </div>
          <p className="text-[11px] text-slate-500">Saving creates an immutable recipe version; existing batches retain their original recipe snapshot.</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected yield per batch"><input required name="batchYield" type="number" min="0.000001" step="any" defaultValue={family?.recipe?.batchYield ?? ''} className={inputClass} /></Field><Field label="Yield unit"><input required name="yieldUnit" maxLength={40} defaultValue={family?.recipe?.yieldUnit ?? family?.baseUnit ?? ''} className={inputClass} /></Field></div>
          <div className="space-y-2">{ingredientDrafts.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]"><Field label={`Ingredient ${index + 1}`}><select required value={line.materialId} onChange={(event) => setIngredientDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, materialId: event.target.value } : row))} className={inputClass}><option value="">Select raw material</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</select></Field><Field label="Quantity per batch"><input required type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => setIngredientDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={inputClass} /></Field><button type="button" aria-label="Remove ingredient" disabled={ingredientDrafts.length === 1} onClick={() => setIngredientDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="mt-5 min-h-10 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Remove</button></div>)}</div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setIngredientDrafts((rows) => [...rows, { materialId: '', quantity: '' }])} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Plus className="size-4" /> Ingredient</button><button type="submit" disabled={!family || !ingredientDrafts.length || saveRecipe.isPending} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saveRecipe.isPending ? 'Saving…' : 'Save new version'}</button></div>
        </form>

        <form onSubmit={submitVariant} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <h3 className="text-sm font-bold sm:col-span-2">Add sellable variant to {family?.name ?? 'a family'}</h3>
          <Field label="SKU"><input required name="sku" maxLength={40} className={inputClass} /></Field><Field label="Variant name"><input required name="name" maxLength={160} className={inputClass} /></Field>
          <Field label="Sale unit"><input required name="saleUnit" maxLength={40} className={inputClass} /></Field><Field label="Base units per sale unit"><input required name="unitsPerSaleUnit" type="number" min="1" step="1" defaultValue="1" className={inputClass} /></Field>
          <Field label="Price (UGX)"><input required name="price" type="number" min="1" step="1" className={inputClass} /></Field>
          <PackagingMaterialsFields materials={packagingMaterials} prefix="variantPackaging" />
          <button type="submit" disabled={!family || addVariant.isPending} className="mt-5 min-h-11 rounded-lg border border-slate-200 px-4 text-xs font-semibold disabled:opacity-40">{addVariant.isPending ? 'Adding…' : 'Add variant'}</button>
        </form>
      </div>
    </section>}

    {canManage && <section className="grid gap-4 xl:grid-cols-2">
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
    </section>}

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-bold">Batch history</h3><p className="mt-1 text-xs text-slate-500">{batches.length} batches · expected quantities are snapshots from the selected recipe version.</p></div>
        {!batches.length ? <p className="p-5 text-xs text-slate-500">No bakery batches recorded.</p> : <div className="max-h-96 overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Reference</th><th className="p-3">Date / product</th><th className="p-3">Recipe</th><th className="p-3">Yield planned / actual</th><th className="p-3">Status</th><th className="p-3">Expiry</th></tr></thead><tbody>{batches.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 font-mono">{item.reference}</td><td className="p-3">{item.productionDate} · {item.familyName}<div className="text-slate-500">{item.notes}</div></td><td className="p-3">v{item.recipeVersion} × {item.batchMultiplier}</td><td className="p-3">{(item.batchYield * item.batchMultiplier).toLocaleString()} / {item.actualYield?.toLocaleString() ?? '—'} {item.yieldUnit}</td><td className="p-3">{item.status}</td><td className="p-3">{item.expiryDate ?? 'Pending'}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h3 className="text-sm font-bold">Finished stock lots</h3><p className="mt-1 text-xs text-slate-500">Batch-linked stock with the actual product date label and remaining sale units.</p></div>
        {!lots.length ? <p className="p-5 text-xs text-slate-500">No finished-stock lots recorded.</p> : <div className="max-h-96 overflow-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Lot / SKU</th><th className="p-3">Produced</th><th className="p-3">Remaining</th><th className="p-3">Date label</th><th className="p-3">Status</th>{canManage && <th className="p-3">Write-off</th>}</tr></thead><tbody>{lots.map((lot) => <tr key={lot.id} className="border-t border-slate-100"><td className="p-3">{lot.reference}<div className="text-slate-500">{lot.sku} · {lot.productName}</div></td><td className="p-3">{lot.producedQuantity} {lot.saleUnit}</td><td className="p-3">{lot.remainingQuantity} {lot.saleUnit}</td><td className="p-3">{lot.dateLabelType.replace('_', ' ')} · {lot.expiryDate}</td><td className="p-3">{lot.status}</td>{canManage && <td className="p-2">{lot.status === 'active' && lot.remainingQuantity > lot.reservedQuantity && <form onSubmit={submitWriteOff} className="flex min-w-[280px] gap-1"><input type="hidden" name="lotId" value={lot.id} /><input aria-label={`Write-off quantity for ${lot.reference}`} required name="quantity" type="number" min="1" max={lot.remainingQuantity - lot.reservedQuantity} step="1" placeholder="Qty" className="w-16 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Write-off reason for ${lot.reference}`} required name="reason" placeholder="Reason" className="w-24 rounded border border-slate-200 px-2 py-1.5" /><input aria-label={`Write-off date for ${lot.reference}`} required name="date" type="date" defaultValue={today()} max={today()} className="w-32 rounded border border-slate-200 px-2 py-1.5" /><button type="submit" disabled={writeOffLot.isPending} className="rounded border border-rose-200 px-2 py-1.5 font-semibold text-rose-700 disabled:opacity-40">Write off</button></form>}</td>}</tr>)}</tbody></table></div>}
      </div>
    </section>
  </div>
}
