export function formatMoney(value: number) {
  return `$${value.toLocaleString('en-US')}`
}

export function formatCnyMoney(value: number, currency = 'CNY') {
  const amount = Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return currency === 'CNY' ? `¥${amount}` : `${currency} ${amount}`
}

export function formatNumber(value: number) {
  return value.toLocaleString('zh-CN')
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}
