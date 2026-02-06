import type { OnePieceCard, Card, ApiResponse } from '@/types';

const OPTCG_API_BASE = 'https://optcgapi.com/api';
const API_TCG_BASE = 'https://api.apitcg.com/v1/one-piece/cards';

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
  card_text?: string;
}

interface APITCGCard {
  id: string;
  name: string;
  set: string;
  number: string;
  rarity: string;
  category: string;
  color: string[];
  power?: number;
  counter?: number;
  life?: number;
  cost?: number;
  attribute?: string;
  effect?: string;
  trigger?: string;
  imageUrl?: string;
  price?: number;
  releaseDate?: string;
}

function transformOPTCGCard(apiCard: OPTCGApiCard): OnePieceCard {
  return {
    id: apiCard.id,
    name: apiCard.name,
    setName: apiCard.set || 'Unknown',
    game: 'one_piece',
    cardType: (apiCard.category as OnePieceCard['cardType']) || 'CHARACTER',
    color: apiCard.color || [],
    power: apiCard.power,
    counter: apiCard.counter,
    life: apiCard.life,
    cost: apiCard.cost,
    attribute: apiCard.attribute,
    rarity: apiCard.rarity,
    effect: apiCard.effect,
    trigger: apiCard.trigger,
    block: apiCard.block,
    imageUrl: apiCard.image_url,
    marketPrice: apiCard.market_price,
    msrp: apiCard.inventory_price,
    language: 'ENG',
    lastUpdated: new Date().toISOString(),
  };
}

function transformAPITCGCard(apiCard: APITCGCard): OnePieceCard {
  return {
    id: apiCard.id,
    name: apiCard.name,
    setName: apiCard.set || 'Unknown',
    game: 'one_piece',
    cardType: (apiCard.category as OnePieceCard['cardType']) || 'CHARACTER',
    color: apiCard.color || [],
    power: apiCard.power,
    counter: apiCard.counter,
    life: apiCard.life,
    cost: apiCard.cost,
    attribute: apiCard.attribute,
    rarity: apiCard.rarity,
    effect: apiCard.effect,
    trigger: apiCard.trigger,
    imageUrl: apiCard.imageUrl,
    marketPrice: apiCard.price,
    releaseDate: apiCard.releaseDate,
    language: 'ENG',
    lastUpdated: new Date().toISOString(),
  };
}

class OnePieceApiService {
  // Fetch all One Piece cards
  async getAllCards(options: {
    page?: number;
    pageSize?: number;
    setId?: string;
    search?: string;
    rarity?: string;
    color?: string;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 100, setId, search, rarity, color } = options;

    try {
      // Try OPTCG API first
      return await this.getCardsFromOPTCG({ page, pageSize, setId, search, rarity, color });
    } catch (error) {
      console.error('OPTCG API failed, trying fallback:', error);
      // Fallback to API.TCG
      return this.getCardsFromAPITCG({ page, pageSize, setId, search });
    }
  }

  private async getCardsFromOPTCG(options: {
    page?: number;
    pageSize?: number;
    setId?: string;
    search?: string;
    rarity?: string;
    color?: string;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 100, setId, search, rarity, color } = options;

    let url = `${OPTCG_API_BASE}/cards`;
    const params = new URLSearchParams();
    
    params.append('page', page.toString());
    params.append('limit', pageSize.toString());
    
    if (setId) params.append('set', setId);
    if (search) params.append('name', search);
    if (rarity) params.append('rarity', rarity);
    if (color) params.append('color', color);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`OPTCG API error: ${response.status}`);
    }

    const data = await response.json();
    const cards = data.cards?.map(transformOPTCGCard) || [];

    return {
      data: cards,
      meta: {
        total: data.total || cards.length,
        page,
        limit: pageSize,
        hasMore: data.has_more || false,
      },
    };
  }

  private async getCardsFromAPITCG(options: {
    page?: number;
    pageSize?: number;
    setId?: string;
    search?: string;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 100, setId, search } = options;

    let url = API_TCG_BASE;
    const params = new URLSearchParams();
    
    params.append('page', page.toString());
    params.append('limit', pageSize.toString());
    
    if (setId) params.append('set', setId);
    if (search) params.append('q', search);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API.TCG error: ${response.status}`);
      }

      const data = await response.json();
      const cards = data.data?.map(transformAPITCGCard) || [];

      return {
        data: cards,
        meta: {
          total: data.total || cards.length,
          page,
          limit: pageSize,
          hasMore: data.has_more || false,
        },
      };
    } catch (error) {
      console.error('Error fetching from API.TCG:', error);
      return { data: [], meta: { total: 0, page, limit: pageSize, hasMore: false } };
    }
  }

  // Fetch a single card by ID
  async getCardById(cardId: string): Promise<Card | null> {
    try {
      const response = await fetch(`${OPTCG_API_BASE}/cards/${cardId}`);

      if (!response.ok) {
        throw new Error(`OPTCG API error: ${response.status}`);
      }

      const data = await response.json();
      return transformOPTCGCard(data);
    } catch (error) {
      console.error(`Error fetching One Piece card ${cardId}:`, error);
      return null;
    }
  }

  // Fetch all sets
  async getSets(): Promise<Array<{ id: string; name: string; releaseDate: string; total: number }>> {
    try {
      const response = await fetch(`${OPTCG_API_BASE}/sets`);

      if (!response.ok) {
        throw new Error(`OPTCG API error: ${response.status}`);
      }

      const data = await response.json();
      return data.sets?.map((set: Record<string, unknown>) => ({
        id: (set.id as string) || '',
        name: (set.name as string) || '',
        releaseDate: (set.release_date as string) || '',
        total: (set.card_count as number) || 0,
      })) || [];
    } catch (error) {
      console.error('Error fetching One Piece sets:', error);
      return [];
    }
  }

  // Fetch cards by set
  async getCardsBySet(setId: string): Promise<Card[]> {
    const result = await this.getAllCards({ setId });
    return result.data;
  }

  // Search cards by name
  async searchCards(query: string): Promise<Card[]> {
    const result = await this.getAllCards({ search: query });
    return result.data;
  }

  // Get price history for a card
  async getPriceHistory(cardId: string): Promise<Array<{ date: string; price: number; source: string }>> {
    try {
      const response = await fetch(`${OPTCG_API_BASE}/cards/${cardId}/price-history`);

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.history?.map((entry: Record<string, unknown>) => ({
        date: (entry.date as string) || '',
        price: (entry.price as number) || 0,
        source: 'optcg',
      })) || [];
    } catch (error) {
      console.error(`Error fetching price history for ${cardId}:`, error);
      return [];
    }
  }

  // Get structure decks
  async getStructureDecks(): Promise<Array<{ id: string; name: string; releaseDate: string }>> {
    try {
      const response = await fetch(`${OPTCG_API_BASE}/structure-decks`);

      if (!response.ok) {
        throw new Error(`OPTCG API error: ${response.status}`);
      }

      const data = await response.json();
      return data.decks?.map((deck: Record<string, unknown>) => ({
        id: (deck.id as string) || '',
        name: (deck.name as string) || '',
        releaseDate: (deck.release_date as string) || '',
      })) || [];
    } catch (error) {
      console.error('Error fetching structure decks:', error);
      return [];
    }
  }

  // Get promo cards
  async getPromoCards(): Promise<Card[]> {
    try {
      const response = await fetch(`${OPTCG_API_BASE}/cards?category=PROMO`);

      if (!response.ok) {
        throw new Error(`OPTCG API error: ${response.status}`);
      }

      const data = await response.json();
      return data.cards?.map(transformOPTCGCard) || [];
    } catch (error) {
      console.error('Error fetching promo cards:', error);
      return [];
    }
  }
}

export const onePieceApi = new OnePieceApiService();
