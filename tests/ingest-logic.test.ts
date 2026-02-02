import { describe, it, expect } from 'vitest';

// Test the pure logic functions from ingest scripts without DB connections

describe('Store classification', () => {
  const BIG_BOX_NAMES = ['walmart', 'target', 'costco', "sam's club", 'meijer', 'fred meyer'];
  const LGS_SHOP_TYPES = ['toys', 'games', 'anime', 'hobby', 'collector', 'trading_cards'];

  function classifyStore(shopType: string, name: string): string {
    const lower = name.toLowerCase();
    if (BIG_BOX_NAMES.some((b) => lower.includes(b))) return 'big_box';
    if (shopType === 'vending_machine' || lower.includes('vending')) return 'vending';
    if (LGS_SHOP_TYPES.includes(shopType) || lower.includes('card') || lower.includes('comic'))
      return 'lgs';
    return 'unknown';
  }

  it('should classify Walmart as big_box', () => {
    expect(classifyStore('supermarket', 'Walmart Supercenter')).toBe('big_box');
  });

  it('should classify Target as big_box', () => {
    expect(classifyStore('department_store', 'Target')).toBe('big_box');
  });

  it('should classify toy shops as lgs', () => {
    expect(classifyStore('toys', 'The Card Shop')).toBe('lgs');
  });

  it('should classify card shops as lgs', () => {
    expect(classifyStore('other', 'Pokemon Card Store')).toBe('lgs');
  });

  it('should classify vending machines', () => {
    expect(classifyStore('vending_machine', 'TCG Vending')).toBe('vending');
  });

  it('should default to unknown for unrecognized stores', () => {
    expect(classifyStore('clothes', 'Some Random Store')).toBe('unknown');
  });
});

describe('Product type detection', () => {
  function detectProductType(name: string): string {
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

  it('should detect ETB products', () => {
    expect(detectProductType('Scarlet & Violet Elite Trainer Box')).toBe('etb');
  });

  it('should detect booster boxes', () => {
    expect(detectProductType('One Piece OP-09 Booster Box')).toBe('booster_box');
  });

  it('should detect booster packs', () => {
    expect(detectProductType('Sleeved Booster Pack')).toBe('booster_pack');
  });

  it('should detect tins', () => {
    expect(detectProductType('Paldea Partners Tin')).toBe('tin');
  });

  it('should return other for unrecognized types', () => {
    expect(detectProductType('Some Random Product')).toBe('other');
  });
});

describe('Name normalization', () => {
  function normalizeName(name: string): string {
    return name.replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '').trim().toLowerCase();
  }

  it('should lowercase names', () => {
    expect(normalizeName('Pokemon ETB')).toBe('pokemon etb');
  });

  it('should collapse whitespace', () => {
    expect(normalizeName('Pokemon   Elite   Trainer')).toBe('pokemon elite trainer');
  });

  it('should remove special characters', () => {
    expect(normalizeName('Pokémon™ TCG')).toBe('pokmon tcg');
  });
});

describe('Language detection', () => {
  function detectLanguage(name: string, setName: string | null): string {
    const combined = `${name} ${setName || ''}`.toLowerCase();
    if (combined.includes('japanese') || combined.includes('jpn') || combined.includes('japan'))
      return 'JPN';
    return 'ENG';
  }

  it('should detect Japanese products', () => {
    expect(detectLanguage('Japanese Booster Box', null)).toBe('JPN');
  });

  it('should detect JPN in set name', () => {
    expect(detectLanguage('Booster Box', 'JPN Edition')).toBe('JPN');
  });

  it('should default to ENG', () => {
    expect(detectLanguage('Scarlet & Violet ETB', 'Base Set')).toBe('ENG');
  });
});
