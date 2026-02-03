/** Shared product classification/normalization helpers for TCGCSV connector */

export function detectProductType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('elite trainer box') || lower.includes('etb')) return 'etb';
  if (lower.includes('booster box')) return 'booster_box';
  if (lower.includes('booster pack') || lower.includes('sleeved booster')) return 'booster_pack';
  if (lower.includes('blister')) return 'blister';
  if (lower.includes('collection box') || lower.includes('premium collection'))
    return 'collection_box';
  if (lower.includes(' tin ') || lower.endsWith(' tin')) return 'tin';
  if (lower.includes('bundle')) return 'bundle';
  return 'other';
}

export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

export function detectLanguage(name: string, setName: string | null): string {
  const combined = `${name} ${setName || ''}`.toLowerCase();
  if (combined.includes('japanese') || combined.includes('jpn') || combined.includes('japan'))
    return 'JPN';
  return 'ENG';
}

/** Filter sealed product names — returns true if the product name looks like sealed product */
export function isSealedProduct(name: string): boolean {
  const lower = name.toLowerCase();
  const sealedKeywords = [
    'elite trainer box',
    'etb',
    'booster box',
    'booster pack',
    'sleeved booster',
    'blister',
    'collection box',
    'premium collection',
    ' tin ',
    'bundle',
    'booster bundle',
    'build & battle',
    'build and battle',
    'starter deck',
    'theme deck',
    'v box',
    'vmax box',
    'vstar box',
    'ex box',
    'gx box',
    'ultra premium',
    'special collection',
    'poster collection',
    'lunchbox',
    'mini tin',
    'paldea evolved',
    'tech sticker',
    'binder collection',
    'trainer gallery',
    'case',
    'display',
    'box set',
  ];
  return sealedKeywords.some((kw) =>
    kw.startsWith(' ') ? lower.includes(kw) : lower.includes(kw),
  );
}
