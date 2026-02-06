/**
 * One Piece TCG API Connector
 *
 * Server-side adapter for optcgapi.com with apitcg.com fallback.
 * Fetches card data with market pricing for One Piece TCG products.
 *
 * Adapted from kimi-api branch onePieceApi.ts (client-side) to server-side
 * connector pattern matching our existing TCGCSV/OSM connectors.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../lib/logger';

interface OPTCGApiCard {
  id: string;
  name: string;
  category: string;
  type?: string;
  color: string[];
  power?: number;
  counter?: number;
  life?: number;
  cost?: number;
  attribute?: string;
  effect?: string;
  trigger?: string;
  set?: string;
  block?: string;
  rarity?: string;
  image_url?: string;
  market_price?: number;
  inventory_price?: number;
}

export interface CardPriceResult {
  cardId: string;
  name: string;
  setName: string;
  game: 'one_piece';
  marketPrice: number | null;
  imageUrl: string | null;
  source: string;
  sourceUpdatedAt: string | null;
}

export class OnePieceTCGConnector {
  private client: AxiosInstance;
  private fallbackClient: AxiosInstance;

  constructor(apiUrl: string) {
    this.client = axios.create({
      baseURL: apiUrl,
      timeout: 30_000,
    });

    this.fallbackClient = axios.create({
      baseURL: 'https://api.apitcg.com/v1/one-piece',
      timeout: 30_000,
    });
  }

  /**
   * Fetch One Piece cards with market prices.
   * Falls back to APITCG if the primary API fails.
   */
  async getCards(
    options: {
      page?: number;
      pageSize?: number;
      setId?: string;
      search?: string;
    } = {},
  ): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { page = 1, pageSize = 100, setId, search } = options;

    try {
      return await this.getCardsFromPrimary({ page, pageSize, setId, search });
    } catch (err) {
      logger.warn({ err }, 'OPTCG API failed, falling back to APITCG');
      return this.getCardsFromFallback({ page, pageSize, setId, search });
    }
  }

  private async getCardsFromPrimary(options: {
    page: number;
    pageSize: number;
    setId?: string;
    search?: string;
  }): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { page, pageSize, setId, search } = options;

    const params: Record<string, string | number> = {
      page,
      limit: pageSize,
    };
    if (setId) params.set = setId;
    if (search) params.name = search;

    const response = await this.client.get('/cards', { params });
    const data = response.data;

    const cards: CardPriceResult[] = (data.cards || []).map(
      (card: OPTCGApiCard): CardPriceResult => ({
        cardId: card.id,
        name: card.name,
        setName: card.set || 'Unknown',
        game: 'one_piece',
        marketPrice: card.market_price ?? null,
        imageUrl: card.image_url || null,
        source: 'optcg_api',
        sourceUpdatedAt: null,
      }),
    );

    return {
      cards,
      total: data.total || cards.length,
      hasMore: data.has_more || false,
    };
  }

  private async getCardsFromFallback(options: {
    page: number;
    pageSize: number;
    setId?: string;
    search?: string;
  }): Promise<{ cards: CardPriceResult[]; total: number; hasMore: boolean }> {
    const { page, pageSize, setId, search } = options;

    try {
      const params: Record<string, string | number> = {
        page,
        limit: pageSize,
      };
      if (setId) params.set = setId;
      if (search) params.q = search;

      const response = await this.fallbackClient.get('/cards', { params });
      const data = response.data;

      const cards: CardPriceResult[] = (data.data || []).map(
        (card: Record<string, unknown>): CardPriceResult => ({
          cardId: String(card.id || ''),
          name: String(card.name || ''),
          setName: String(card.set || 'Unknown'),
          game: 'one_piece',
          marketPrice: typeof card.price === 'number' ? card.price : null,
          imageUrl: typeof card.imageUrl === 'string' ? card.imageUrl : null,
          source: 'apitcg',
          sourceUpdatedAt: null,
        }),
      );

      return {
        cards,
        total: data.total || cards.length,
        hasMore: data.has_more || false,
      };
    } catch (err) {
      logger.error({ err }, 'APITCG fallback also failed');
      return { cards: [], total: 0, hasMore: false };
    }
  }

  /** Fetch all One Piece sets */
  async getSets(): Promise<
    Array<{ id: string; name: string; releaseDate: string; total: number }>
  > {
    try {
      const response = await this.client.get('/sets');
      const data = response.data;
      return (data.sets || []).map((set: Record<string, unknown>) => ({
        id: String(set.id || ''),
        name: String(set.name || ''),
        releaseDate: String(set.release_date || ''),
        total: Number(set.card_count || 0),
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to fetch One Piece sets');
      return [];
    }
  }

  /** Fetch a single card by ID */
  async getCard(cardId: string): Promise<CardPriceResult | null> {
    try {
      const response = await this.client.get(`/cards/${cardId}`);
      const card = response.data as OPTCGApiCard;
      return {
        cardId: card.id,
        name: card.name,
        setName: card.set || 'Unknown',
        game: 'one_piece',
        marketPrice: card.market_price ?? null,
        imageUrl: card.image_url || null,
        source: 'optcg_api',
        sourceUpdatedAt: null,
      };
    } catch (err) {
      logger.error({ err, cardId }, 'Failed to fetch One Piece card');
      return null;
    }
  }
}
