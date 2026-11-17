'use client'

import BakeryProductionManagement from '@/components/bakery-production-management'
import { useWorkspace } from '@/features/workspace/workspace-context'

export default function ProductionManagement() {
  const { currentUser } = useWorkspace()
  const roles = currentUser.roles
  const canManageProduction = roles.some((role) =>
    ['Super Admin', 'Production Manager', 'Inventory Manager'].includes(role),
  )
  const canManageInventory = roles.some((role) =>
    ['Super Admin', 'Inventory Manager'].includes(role),
  )

  return (
    <BakeryProductionManagement
      canManage={canManageProduction}
      canManageInventory={canManageInventory}
    />
  )
}
