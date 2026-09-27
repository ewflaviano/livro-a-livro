// UI-only occupancy: no form content, identity or persisted consent.
let occupied = 0;
const listeners = new Set<() => void>();
export const getUiOccupancy = () => occupied;
export const subscribeUiOccupancy = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function occupyUi() {
  occupied++; listeners.forEach(listener => listener());
  return () => { occupied--; listeners.forEach(listener => listener()); };
}
