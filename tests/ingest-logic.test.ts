import { describe, it, expect } from 'vitest';
import {
  classifyStore,
  detectProductType,
  normalizeName,
  detectLanguage,
  isSealedProduct,
} from '../src/ingest';

// Tests use the shared ingest modules — no duplicated logic

describe('Store classification', () => {
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

  it('should detect blister packs', () => {
    expect(detectProductType('Scarlet & Violet Blister Pack')).toBe('blister');
  });

  it('should detect collection boxes', () => {
    expect(detectProductType('Charizard Premium Collection')).toBe('collection_box');
  });

  it('should detect bundles', () => {
    expect(detectProductType('Scarlet & Violet Booster Bundle')).toBe('bundle');
  });

  it('should return other for unrecognized types', () => {
    expect(detectProductType('Some Random Product')).toBe('other');
  });
});

describe('Name normalization', () => {
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

describe('Sealed product detection', () => {
  it('should detect ETBs as sealed', () => {
    expect(isSealedProduct('Scarlet & Violet Elite Trainer Box')).toBe(true);
  });

  it('should detect booster boxes as sealed', () => {
    expect(isSealedProduct('One Piece OP-09 Booster Box')).toBe(true);
  });

  it('should detect tins as sealed', () => {
    expect(isSealedProduct('Paldea Partners Mini Tin')).toBe(true);
  });

  it('should detect build & battle as sealed', () => {
    expect(isSealedProduct('Scarlet & Violet Build & Battle Box')).toBe(true);
  });

  it('should detect starter decks as sealed', () => {
    expect(isSealedProduct('One Piece Starter Deck - Straw Hat Crew')).toBe(true);
  });

  it('should detect display boxes as sealed', () => {
    expect(isSealedProduct('Obsidian Flames Booster Display')).toBe(true);
  });

  it('should reject individual cards', () => {
    expect(isSealedProduct('Charizard ex 006/165')).toBe(false);
  });

  it('should reject trainer cards', () => {
    expect(isSealedProduct("Professor's Research 087/091")).toBe(false);
  });

  it('should reject energy cards', () => {
    expect(isSealedProduct('Basic Fire Energy')).toBe(false);
  });
});
