/** Add calendar months in UTC, clamping to the last day of shorter months (31 Oct + 4 = 28/29 Feb). */
export function addMonths(date, months) {
  const d = new Date(date)
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
}
