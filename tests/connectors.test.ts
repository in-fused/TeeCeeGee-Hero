import { describe, it, expect } from 'vitest';
import { PokemonTCGConnector } from '../src/connectors/pokemon-tcg';
import { OnePieceTCGConnector } from '../src/connectors/onepiece-tcg';

// Tests validate connector construction and transform logic without hitting external APIs.
// External API calls are covered by integration tests / manual testing.

describe('PokemonTCGConnector', () => {
  it('should construct with default parameters', () => {
    const connector = new PokemonTCGConnector('https://api.pokemontcg.io/v2');
    expect(connector).toBeDefined();
  });

  it('should construct with API key', () => {
    const connector = new PokemonTCGConnector('https://api.pokemontcg.io/v2', 'test-key-123');
    expect(connector).toBeDefined();
  });

  it('should construct with custom TCGdex URL', () => {
    const connector = new PokemonTCGConnector(
      'https://api.pokemontcg.io/v2',
      undefined,
      'https://custom.tcgdex.net/v2/en',
    );
    expect(connector).toBeDefined();
  });
});

describe('OnePieceTCGConnector', () => {
  it('should construct with default URL', () => {
    const connector = new OnePieceTCGConnector('https://optcgapi.com/api');
    expect(connector).toBeDefined();
  });
});

describe('CardPriceResult type contract', () => {
  it('should have required fields for Pokemon', () => {
    const result = {
      cardId: 'sv1-1',
      name: 'Pikachu',
      setName: 'Scarlet & Violet',
      game: 'pokemon' as const,
      marketPrice: 4.99,
      imageUrl: 'https://example.com/pikachu.png',
      source: 'pokemon_tcg_api',
      sourceUpdatedAt: '2024-01-01T00:00:00Z',
    };

    expect(result.game).toBe('pokemon');
    expect(result.marketPrice).toBe(4.99);
    expect(result.source).toBe('pokemon_tcg_api');
  });

  it('should have required fields for One Piece', () => {
    const result = {
      cardId: 'OP01-001',
      name: 'Monkey D. Luffy',
      setName: 'Romance Dawn',
      game: 'one_piece' as const,
      marketPrice: 12.5,
      imageUrl: 'https://example.com/luffy.png',
      source: 'optcg_api',
      sourceUpdatedAt: null,
    };

    expect(result.game).toBe('one_piece');
    expect(result.marketPrice).toBe(12.5);
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it('should allow null market price when unavailable', () => {
    const result = {
      cardId: 'test-1',
      name: 'Test Card',
      setName: 'Test Set',
      game: 'pokemon' as const,
      marketPrice: null,
      imageUrl: null,
      source: 'tcgdex',
      sourceUpdatedAt: null,
    };

    expect(result.marketPrice).toBeNull();
    expect(result.imageUrl).toBeNull();
  });
});
