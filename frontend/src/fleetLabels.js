const FLEET_NAMES = ['Nandi', 'Kaveri', 'Vayu', 'Mitra', 'Tara', 'Siri', 'Maya', 'Aruna', 'Dhruva', 'Tejas']

function busSequence(busId) {
  const match = String(busId || '').match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

export function displayBusId(busId) {
  const sequence = busSequence(busId)
  return `BUS-${String(sequence).padStart(3, '0')}`
}

export function displayBusName(busId) {
  const sequence = busSequence(busId)
  const name = FLEET_NAMES[sequence % FLEET_NAMES.length]
  return `${name} ${String(sequence).padStart(3, '0')}`
}

export function busLabelSearchText(busId) {
  return `${displayBusId(busId)} ${displayBusName(busId)}`.toLowerCase()
}
