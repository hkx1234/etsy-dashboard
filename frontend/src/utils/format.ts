export function formatMoney(value: number) {
  return `$${value.toLocaleString('en-US')}`
}

export function formatNumber(value: number) {
  return value.toLocaleString('zh-CN')
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}
