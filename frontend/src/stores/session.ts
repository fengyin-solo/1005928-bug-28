import { defineStore } from 'pinia'

import type { OperatorProfile, OperatorRole } from '@/data/types'

export const ROLE_LABELS: Record<OperatorRole, string> = {
  keeper: '库位保管人',
  manager: '站长',
  crew: '作业班组',
}

// 默认以 A-01 库位保管人登录，切换身份可演示越权/越级拦截。
const DEFAULT_OPERATOR: OperatorProfile = {
  name: '王库管',
  role: 'keeper',
  warehouse: 'A-01',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_OPERATOR.name,
    role: DEFAULT_OPERATOR.role as OperatorRole,
    warehouse: DEFAULT_OPERATOR.warehouse,
    shiftLabel: '白班 08:00-20:00',
    scope: '光伏电站运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    roleLabel(): string {
      return ROLE_LABELS[this.role]
    },
    profile(): OperatorProfile {
      return { name: this.operator, role: this.role, warehouse: this.warehouse }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(profile: OperatorProfile) {
      this.operator = profile.name
      this.role = profile.role
      this.warehouse = profile.warehouse
    },
  },
})
