/**
 * Pokemon TCG API Connector
 *
 * Server-side adapter for api.pokemontcg.io/v2 with TCGdex fallback.
 * Fetches card/product data with market prices from TCGPlayer.
 *
 * Adapted from kimi-api branch pokemonApi.ts (client-side) to server-side
 * connector pattern matching our existing TCGCSV/OSM connectors.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../lib/logger';

export interface PokemonTCGPrice {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  directLow: number | null;
}

export interface PokemonTCGCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  rarity: string;
  number: string;
  set: {
    id: string;
    name: string;
    series: string;
    releaseDate: string;
    total: number;
  };
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices: {
      normal?: PokemonTCGPrice;
      holofoil?: PokemonTCGPrice;
      reverseHolofoil?: PokemonTCGPrice;
    };
  };
  cardmarket?: {
    url: string;
    updatedAt: string;
    prices: {
      averageSellPrice: number | null;
      lowPrice: number | null;
      trendPrice: number | null;
    };
  };
}

export interface PokemonTCGSet {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  total: number;
  images: {
    symbol: string;
    logo: string;
  };
}

export interface CardPriceResult {
  cardId: string;
  name: string;
  setName: string;
  game: 'pokemon';
  marketPrice: number | null;
  imageUrl: string | null;
  source: string;
  sourceUpdatedAt: string | null;
}

export class PokemonTCGConnector {
  private client: AxiosInstance;
  private fallbackClient: AxiosInstance;

  constructor(apiUrl: string, apiKey?: string, tcgdexUrl?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    }

    this.client = axios.create({
      baseURL: apiUrl,
      timeout: 30_000,
      headers,
    });

    this.fallbackClient = axios.create({
      baseURL: tcgdexUrl || 'https://api.tcgdex.net/v2/en',
      timeout: 30_000,
    });
  }

  /**
   * Fetch cards with market prices, with pagination.
   * Falls back to TCGdex if the primary API fails.
   */
  async getCards(
    options: {
      page?: number;
      pageSize?: number;
      setId?: string;
      search?: string;
    } = {},
  ): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { page = 1, pageSize = 250, setId, search } = options;

    try {
      return await this.getCardsFromPrimary({ page, pageSize, setId, search });
    } catch (err) {
      logger.warn({ err }, 'Pokemon TCG API failed, falling back to TCGdex');
      return this.getCardsFromTCGdex({ page, pageSize, setId, search });
    }
  }

  private async getCardsFromPrimary(options: {
    page: number;
    pageSize: number;
    setId?: string;
    search?: string;
  }): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { page, pageSize, setId, search } = options;
    const conditions: string[] = [];

    if (setId) conditions.push(`set.id:${setId}`);
    if (search) conditions.push(`name:"${search}"*`);

    const params: Record<string, string | number> = { page, pageSize };
    if (conditions.length > 0) {
      params.q = conditions.join(' ');
    }

    const response = await this.client.get('/cards', { params });
    const data = response.data;

    const cards: CardPriceResult[] = (data.data || []).map((card: PokemonTCGCard) =>
      this.transformCard(card),
    );

    return {
      cards,
      total: data.totalCount || cards.length,
      hasMore: (data.totalCount || 0) > page * pageSize,
    };
  }

  private async getCardsFromTCGdex(options: {
    page: number;
    pageSize: number;
    setId?: string;
    search?: string;
  }): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { setId, search } = options;

    try {
      let url = '/cards';
      if (setId) {
        url = `/sets/${setId}`;
      } else if (search) {
        url = `/cards?name=${encodeURIComponent(search)}`;
      }

      const response = await this.fallbackClient.get(url);
      const data = response.data;
      const cardsData = setId ? data.cards || [] : Array.isArray(data) ? data : [];

      const cards: CardPriceResult[] = cardsData.map(
        (card: Record<string, unknown>): CardPriceResult => ({
          cardId: String(card.id || ''),
          name: String(card.name || ''),
          setName: String((card.set as Record<string, unknown>)?.name || ''),
          game: 'pokemon',
          marketPrice: null, // TCGdex does not provide market prices
          imageUrl: String(card.image || '') || null,
          source: 'tcgdex',
          sourceUpdatedAt: null,
        }),
      );

      return { cards, total: cards.length, hasMore: false };
    } catch (err) {
      logger.error({ err }, 'TCGdex fallback also failed');
      return { cards: [], total: 0, hasMore: false };
    }
  }

  /** Fetch all sets */
  async getSets(): Promise<
    Array<{ id: string; name: string; series: string; releaseDate: string; total: number }>
  > {
    try {
      const response = await this.client.get('/sets');
      return (response.data.data || []).map((set: PokemonTCGSet) => ({
        id: set.id,
        name: set.name,
        series: set.series,
        releaseDate: set.releaseDate,
        total: set.total,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to fetch Pokemon sets');
      return [];
    }
  }

  /** Fetch a single card by ID with pricing */
  async getCard(cardId: string): Promise<CardPriceResult | null> {
    try {
      const response = await this.client.get(`/cards/${cardId}`);
      return this.transformCard(response.data.data);
    } catch (err) {
      logger.error({ err, cardId }, 'Failed to fetch Pokemon card');
      return null;
    }
  }

  private transformCard(apiCard: PokemonTCGCard): CardPriceResult {
    let marketPrice: number | null = null;
    if (apiCard.tcgplayer?.prices) {
      const prices = apiCard.tcgplayer.prices;
      marketPrice =
        prices.holofoil?.market ?? prices.normal?.market ?? prices.reverseHolofoil?.market ?? null;
    }

    return {
      cardId: apiCard.id,
      name: apiCard.name,
      setName: apiCard.set.name,
      game: 'pokemon',
      marketPrice,
      imageUrl: apiCard.images?.large || apiCard.images?.small || null,
      source: 'pokemon_tcg_api',
      sourceUpdatedAt: apiCard.tcgplayer?.updatedAt || null,
    };
  }
}
