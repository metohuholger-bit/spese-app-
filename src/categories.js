export const CATEGORIES = [
  { id: 'alimentari', label: 'Spesa alimentare', icon: '🛒', color: '#2e8b6a' },
  { id: 'ristoranti', label: 'Ristoranti e bar', icon: '🍝', color: '#d9772b' },
  { id: 'trasporti', label: 'Trasporti', icon: '⛽', color: '#3b78c4' },
  { id: 'casa', label: 'Casa e bollette', icon: '🏠', color: '#8a63c9' },
  { id: 'salute', label: 'Salute', icon: '💊', color: '#cf4f6a' },
  { id: 'shopping', label: 'Shopping', icon: '🛍', color: '#c79a1e' },
  { id: 'svago', label: 'Svago', icon: '🎬', color: '#2a9aa8' },
  { id: 'altro', label: 'Altro', icon: '📦', color: '#7c8088' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.at(-1);
