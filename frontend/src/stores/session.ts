import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    operatorName: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '光伏电站运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operatorName.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 备品备件页可切换当前操作人：办理领用对值班人放开，改库位只认本库位保管人。
    setOperator(name: string) {
      this.operatorName = name
      this.operator = name
    },
  },
})
