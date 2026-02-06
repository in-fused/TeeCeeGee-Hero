import type { PokemonCard, Card, ApiResponse } from '@/types';

const POKEMON_TCG_API_BASE = 'https://api.pokemontcg.io/v2';
const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2/en';

// Free API key for development (rate limited)
const POKEMON_TCG_API_KEY = import.meta.env.VITE_POKEMON_TCG_API_KEY || '';

interface PokemonTCGCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  rules?: string[];
  ancientTrait?: {
    name: string;
    text: string;
  };
  abilities?: Array<{
    name: string;
    text: string;
    type: string;
  }>;
  attacks?: Array<{
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }>;
  weaknesses?: Array<{
    type: string;
    value: string;
  }>;
  resistances?: Array<{
    type: string;
    value: string;
  }>;
  retreatCost?: string[];
  convertedRetreatCost?: number;
  set: {
    id: string;
    name: string;
    series: string;
    printedTotal: number;
    total: number;
    legalities: {
      unlimited?: string;
      standard?: string;
      expanded?: string;
    };
    ptcgoCode?: string;
    releaseDate: string;
    updatedAt: string;
    images: {
      symbol: string;
      logo: string;
    };
  };
  number: string;
  artist?: string;
  rarity: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  legalities: {
    unlimited?: string;
    standard?: string;
    expanded?: string;
  };
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices: {
      normal?: {
        low: number | null;
        mid: number | null;
        high: number | null;
        market: number | null;
        directLow: number | null;
      };
      holofoil?: {
        low: number | null;
        mid: number | null;
        high: number | null;
        market: number | null;
        directLow: number | null;
      };
      reverseHolofoil?: {
        low: number | null;
        mid: number | null;
        high: number | null;
        market: number | null;
        directLow: number | null;
      };
      firstEditionNormal?: {
        low: number | null;
        mid: number | null;
        high: number | null;
        market: number | null;
        directLow: number | null;
      };
      firstEditionHolofoil?: {
        low: number | null;
        mid: number | null;
        high: number | null;
        market: number | null;
        directLow: number | null;
      };
    };
  };
  cardmarket?: {
    url: string;
    updatedAt: string;
    prices: {
      averageSellPrice: number | null;
      lowPrice: number | null;
      trendPrice: number | null;
      germanProLow: number | null;
      suggestedPrice: number | null;
      reverseHoloSell: number | null;
      reverseHoloLow: number | null;
      reverseHoloTrend: number | null;
      lowPriceExPlus: number | null;
      avg1: number | null;
      avg7: number | null;
      avg30: number | null;
      reverseHoloAvg1: number | null;
      reverseHoloAvg7: number | null;
      reverseHoloAvg30: number | null;
    };
  };
}

interface PokemonTCGSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  legalities: {
    unlimited?: string;
    standard?: string;
    expanded?: string;
  };
  ptcgoCode?: string;
  releaseDate: string;
  updatedAt: string;
  images: {
    symbol: string;
    logo: string;
  };
}

function transformPokemonTCGCard(apiCard: PokemonTCGCard): PokemonCard {
  const tcgplayerId = apiCard.tcgplayer ? parseInt(apiCard.id.replace(/[^0-9]/g, '')) || undefined : undefined;
  
  // Get market price from tcgplayer data (prefer holofoil, then normal)
  let marketPrice: number | undefined;
  if (apiCard.tcgplayer?.prices) {
    const prices = apiCard.tcgplayer.prices;
    marketPrice = prices.holofoil?.market 
      ?? prices.normal?.market 
      ?? prices.reverseHolofoil?.market 
      ?? undefined;
  }

  return {
    id: apiCard.id,
    tcgplayerId,
    name: apiCard.name,
    setName: apiCard.set.name,
    game: 'pokemon',
    supertype: apiCard.supertype,
    subtypes: apiCard.subtypes,
    hp: apiCard.hp,
    types: apiCard.types,
    attacks: apiCard.attacks,
    weaknesses: apiCard.weaknesses,
    resistances: apiCard.resistances,
    retreatCost: apiCard.retreatCost,
    convertedRetreatCost: apiCard.convertedRetreatCost,
    number: apiCard.number,
    rarity: apiCard.rarity,
    artist: apiCard.artist,
    flavorText: apiCard.flavorText,
    nationalPokedexNumbers: apiCard.nationalPokedexNumbers,
    legalities: apiCard.legalities,
    imageUrl: apiCard.images.large,
    marketPrice,
    releaseDate: apiCard.set.releaseDate,
    language: 'ENG',
    lastUpdated: apiCard.tcgplayer?.updatedAt || new Date().toISOString(),
  };
}

class PokemonApiService {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  constructor() {
    if (POKEMON_TCG_API_KEY) {
      this.headers['X-Api-Key'] = POKEMON_TCG_API_KEY;
    }
  }

  // Fetch all Pokémon cards with pagination
  async getAllCards(options: {
    page?: number;
    pageSize?: number;
    setId?: string;
    search?: string;
    rarity?: string;
    supertype?: string;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 250, setId, search, rarity, supertype } = options;
    
    let query = '';
    const conditions: string[] = [];
    
    if (setId) conditions.push(`set.id:${setId}`);
    if (search) conditions.push(`name:"${search}"*`);
    if (rarity) conditions.push(`rarity:"${rarity}"`);
    if (supertype) conditions.push(`supertype:"${supertype}"`);
    
    if (conditions.length > 0) {
      query = `?q=${conditions.join(' ')}`;
    }

    const url = `${POKEMON_TCG_API_BASE}/cards${query}&page=${page}&pageSize=${pageSize}`;
    
    try {
      const response = await fetch(url, { headers: this.headers });
      
      if (!response.ok) {
        throw new Error(`Pokemon TCG API error: ${response.status}`);
      }

      const data = await response.json();
      const cards = data.data.map(transformPokemonTCGCard);
      
      return {
        data: cards,
        meta: {
          total: data.totalCount,
          page,
          limit: pageSize,
          hasMore: data.totalCount > page * pageSize,
        },
      };
    } catch (error) {
      console.error('Error fetching Pokemon cards:', error);
      // Fallback to TCGdex API if Pokemon TCG API fails
      return this.getCardsFromTCGdex(options);
    }
  }

  // Fallback to TCGdex API
  private async getCardsFromTCGdex(options: {
    page?: number;
    pageSize?: number;
    setId?: string;
    search?: string;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 250, setId, search } = options;
    
    let url = `${TCGDEX_API_BASE}/cards`;
    
    if (setId) {
      url = `${TCGDEX_API_BASE}/sets/${setId}`;
    } else if (search) {
      url = `${TCGDEX_API_BASE}/cards?name=${encodeURIComponent(search)}`;
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`TCGdex API error: ${response.status}`);
      }

      const data = await response.json();
      const cardsData = setId ? data.cards : data;
      
      const cards: Card[] = cardsData.map((card: Record<string, unknown>) => this.transformTCGdexCard(card));
      
      return {
        data: cards,
        meta: {
          total: cards.length,
          page,
          limit: pageSize,
          hasMore: false,
        },
      };
    } catch (error) {
      console.error('Error fetching from TCGdex:', error);
      return { data: [], meta: { total: 0, page, limit: pageSize, hasMore: false } };
    }
  }

  private transformTCGdexCard(apiCard: Record<string, unknown>): Card {
    const set = apiCard.set as Record<string, unknown> | undefined;
    const images = apiCard.images as Record<string, unknown> | undefined;
    const cardmarket = apiCard.cardmarket as Record<string, unknown> | undefined;
    const cardmarketPrices = cardmarket?.prices as Record<string, unknown> | undefined;
    const tcgplayer = apiCard.tcgplayer as Record<string, unknown> | undefined;
    const tcgplayerPrices = tcgplayer?.prices as Record<string, unknown> | undefined;
    const normalPrices = tcgplayerPrices?.normal as Record<string, unknown> | undefined;
    
    return {
      id: (apiCard.id as string) || '',
      name: (apiCard.name as string) || '',
      setName: (set?.name as string) || '',
      game: 'pokemon',
      cardType: (apiCard.supertype as string) || '',
      rarity: (apiCard.rarity as string) || '',
      number: (apiCard.localId as string) || '',
      imageUrl: (apiCard.image as string) || (images?.large as string) || '',
      marketPrice: (cardmarketPrices?.averageSellPrice as number) || (normalPrices?.market as number),
      releaseDate: (set?.releaseDate as string) || '',
      language: 'ENG',
      lastUpdated: new Date().toISOString(),
    };
  }

  // Fetch a single card by ID
  async getCardById(cardId: string): Promise<Card | null> {
    try {
      const response = await fetch(`${POKEMON_TCG_API_BASE}/cards/${cardId}`, {
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(`Pokemon TCG API error: ${response.status}`);
      }

      const data = await response.json();
      return transformPokemonTCGCard(data.data);
    } catch (error) {
      console.error(`Error fetching Pokemon card ${cardId}:`, error);
      return null;
    }
  }

  // Fetch all sets
  async getSets(): Promise<Array<{ id: string; name: string; series: string; releaseDate: string; total: number }>> {
    try {
      const response = await fetch(`${POKEMON_TCG_API_BASE}/sets`, { headers: this.headers });

      if (!response.ok) {
        throw new Error(`Pokemon TCG API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data.map((set: PokemonTCGSet) => ({
        id: set.id,
        name: set.name,
        series: set.series,
        releaseDate: set.releaseDate,
        total: set.total,
      }));
    } catch (error) {
      console.error('Error fetching Pokemon sets:', error);
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

  // Get price history for a card (using TCGplayer data)
  async getPriceHistory(cardId: string): Promise<Array<{ date: string; price: number; source: string }>> {
    try {
      const response = await fetch(`${POKEMON_TCG_API_BASE}/cards/${cardId}`, {
        headers: this.headers,
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const card = data.data;
      
      // Return current price as single point (historical data requires premium API)
      const prices = card.tcgplayer?.prices;
      const currentPrice = prices?.holofoil?.market ?? prices?.normal?.market;
      
      if (currentPrice) {
        return [{
          date: card.tcgplayer.updatedAt,
          price: currentPrice,
          source: 'tcgplayer',
        }];
      }
      
      return [];
    } catch (error) {
      console.error(`Error fetching price history for ${cardId}:`, error);
      return [];
    }
  }
}

export const pokemonApi = new PokemonApiService();
