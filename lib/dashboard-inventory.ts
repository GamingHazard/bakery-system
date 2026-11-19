import type { BakeryProductFamily, FinishedStockLotRecord } from '@/lib/user-api'

export type FinishedProductInventorySummary = {
  stockValue: number
  lowStockSkus: number
  outOfStockSkus: number
  availableFamilies: number
  totalProducts: number
  activeProducts: number
  inactiveProducts: number
  publishedProducts: number
  unpublishedProducts: number
}

export function summarizeFinishedProductInventory(
  families: BakeryProductFamily[],
  lots: FinishedStockLotRecord[],
): FinishedProductInventorySummary {
  const onHandByVariant = new Map<string, number>()

  for (const lot of lots) {
    if (lot.status === 'written_off' || lot.remainingQuantity <= 0) continue
    onHandByVariant.set(
      lot.variantId,
      (onHandByVariant.get(lot.variantId) ?? 0) + lot.remainingQuantity,
    )
  }

  const summary: FinishedProductInventorySummary = {
    stockValue: 0,
    lowStockSkus: 0,
    outOfStockSkus: 0,
    availableFamilies: 0,
    totalProducts: 0,
    activeProducts: 0,
    inactiveProducts: 0,
    publishedProducts: 0,
    unpublishedProducts: 0,
  }

  for (const family of families) {
    const activeVariants = family.variants.filter((variant) => variant.active)
    if (family.active && activeVariants.length > 0) summary.availableFamilies += 1
    summary.totalProducts += 1
    if (family.active) {
      summary.activeProducts += 1
    } else {
      summary.inactiveProducts += 1
    }

    if (family.storefront.published) {
      summary.publishedProducts += 1
    } else {
      summary.unpublishedProducts += 1
    }

    for (const variant of family.variants) {
      if (variant.active) {
        const onHand = onHandByVariant.get(variant.id) ?? 0

        if (onHand > 0) {
          summary.stockValue += onHand * variant.price
          if (onHand <= variant.lowStockThreshold) summary.lowStockSkus += 1
        } else {
          summary.outOfStockSkus += 1
        }
      }
    }
  }

  return summary
}
