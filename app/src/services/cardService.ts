import { pokemonApi } from './pokemonApi';
import { onePieceApi } from './onePieceApi';
import { inventoryService } from './inventoryService';
import { webhookService } from './webhookService';
import type { 
  Card, 
  PokemonCard, 
  OnePieceCard, 
  CardFilter, 
  ApiResponse,
  InventoryItem,
  AvailabilitySignal 
} from '@/types';

export type { Card, PokemonCard, OnePieceCard, CardFilter };

class CardService {
  // ========== Card Fetching ==========

  async getAllCards(options: {
    page?: number;
    pageSize?: number;
    filter?: CardFilter;
  } = {}): Promise<ApiResponse<Card[]>> {
    const { page = 1, pageSize = 100, filter } = options;

    // Fetch from both APIs in parallel
    const [pokemonResult, onePieceResult] = await Promise.all([
      this.getPokemonCards({ page, pageSize, filter }),
      this.getOnePieceCards({ page, pageSize, filter }),
    ]);

    // Combine results
    const allCards = [...pokemonResult.data, ...onePieceResult.data];

    // Apply additional filters
    let filteredCards = allCards;
    
    if (filter) {
      if (filter.game) {
        filteredCards = filteredCards.filter(card => card.game === filter.game);
      }
      if (filter.setName) {
        filteredCards = filteredCards.filter(card => 
          card.setName.toLowerCase().includes(filter.setName!.toLowerCase())
        );
      }
      if (filter.rarity) {
        filteredCards = filteredCards.filter(card => card.rarity === filter.rarity);
      }
      if (filter.cardType) {
        filteredCards = filteredCards.filter(card => card.cardType === filter.cardType);
      }
      if (filter.minPrice !== undefined) {
        filteredCards = filteredCards.filter(card => 
          (card.marketPrice || 0) >= filter.minPrice!
        );
      }
      if (filter.maxPrice !== undefined) {
        filteredCards = filteredCards.filter(card => 
          (card.marketPrice || Infinity) <= filter.maxPrice!
        );
      }
      if (filter.inStock) {
        const inventory = await inventoryService.getInventory({ inStock: true });
        const inStockCardIds = new Set(inventory.map(item => item.cardId));
        filteredCards = filteredCards.filter(card => inStockCardIds.has(card.id));
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        filteredCards = filteredCards.filter(card =>
          card.name.toLowerCase().includes(searchLower) ||
          card.setName.toLowerCase().includes(searchLower) ||
          card.number?.toLowerCase().includes(searchLower)
        );
      }
    }

    // Sort by name
    filteredCards.sort((a, b) => a.name.localeCompare(b.name));

    // Paginate
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedCards = filteredCards.slice(start, end);

    return {
      data: paginatedCards,
      meta: {
        total: filteredCards.length,
        page,
        limit: pageSize,
        hasMore: end < filteredCards.length,
      },
    };
  }

  private async getPokemonCards(options: {
    page?: number;
    pageSize?: number;
    filter?: CardFilter;
  }): Promise<ApiResponse<Card[]>> {
    if (options.filter?.game && options.filter.game !== 'pokemon') {
      return { data: [], meta: { total: 0, page: 1, limit: options.pageSize || 100, hasMore: false } };
    }

    return pokemonApi.getAllCards({
      page: options.page,
      pageSize: options.pageSize,
      search: options.filter?.search,
      rarity: options.filter?.rarity,
    });
  }

  private async getOnePieceCards(options: {
    page?: number;
    pageSize?: number;
    filter?: CardFilter;
  }): Promise<ApiResponse<Card[]>> {
    if (options.filter?.game && options.filter.game !== 'one_piece') {
      return { data: [], meta: { total: 0, page: 1, limit: options.pageSize || 100, hasMore: false } };
    }

    return onePieceApi.getAllCards({
      page: options.page,
      pageSize: options.pageSize,
      search: options.filter?.search,
      rarity: options.filter?.rarity,
    });
  }

  // ========== Single Card Operations ==========

  async getCardById(cardId: string, game: 'pokemon' | 'one_piece'): Promise<Card | null> {
    if (game === 'pokemon') {
      return pokemonApi.getCardById(cardId);
    } else {
      return onePieceApi.getCardById(cardId);
    }
  }

  async getCardWithInventory(cardId: string, game: 'pokemon' | 'one_piece'): Promise<{
    card: Card | null;
    inventory: InventoryItem[];
    totalQuantity: number;
  }> {
    const card = await this.getCardById(cardId, game);
    const inventory = await inventoryService.getInventory({ cardId });
    const totalQuantity = inventory.reduce((sum, item) => sum + item.quantity, 0);

    return { card, inventory, totalQuantity };
  }

  // ========== Set Operations ==========

  async getAllSets(): Promise<Array<{
    id: string;
    name: string;
    game: 'pokemon' | 'one_piece';
    series?: string;
    releaseDate: string;
    total: number;
  }>> {
    const [pokemonSets, onePieceSets] = await Promise.all([
      pokemonApi.getSets(),
      onePieceApi.getSets(),
    ]);

    const combinedSets = [
      ...pokemonSets.map(set => ({ ...set, game: 'pokemon' as const })),
      ...onePieceSets.map(set => ({ ...set, game: 'one_piece' as const })),
    ];

    return combinedSets.sort((a, b) => 
      new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
    );
  }

  async getCardsBySet(setId: string, game: 'pokemon' | 'one_piece'): Promise<Card[]> {
    if (game === 'pokemon') {
      return pokemonApi.getCardsBySet(setId);
    } else {
      return onePieceApi.getCardsBySet(setId);
    }
  }

  // ========== Search Operations ==========

  async searchCards(query: string, game?: 'pokemon' | 'one_piece'): Promise<Card[]> {
    if (game === 'pokemon') {
      return pokemonApi.searchCards(query);
    } else if (game === 'one_piece') {
      return onePieceApi.searchCards(query);
    }

    // Search both
    const [pokemonCards, onePieceCards] = await Promise.all([
      pokemonApi.searchCards(query),
      onePieceApi.searchCards(query),
    ]);

    return [...pokemonCards, ...onePieceCards];
  }

  // ========== Price Operations ==========

  async getPriceHistory(cardId: string, game: 'pokemon' | 'one_piece'): Promise<Array<{
    date: string;
    price: number;
    source: string;
  }>> {
    if (game === 'pokemon') {
      return pokemonApi.getPriceHistory(cardId);
    } else {
      return onePieceApi.getPriceHistory(cardId);
    }
  }

  async updateCardPrice(
    cardId: string,
    game: 'pokemon' | 'one_piece',
    newPrice: number
  ): Promise<void> {
    // Emit price change event
    const card = await this.getCardById(cardId, game);
    
    if (card && card.marketPrice !== newPrice) {
      await webhookService.emitEvent('price.changed', {
        cardId,
        cardName: card.name,
        oldPrice: card.marketPrice,
        newPrice,
        game,
        setName: card.setName,
      });
    }
  }

  // ========== Inventory Integration ==========

  async addCardToInventory(
    card: Card,
    storeId: string,
    quantity: number,
    price: number,
    condition: InventoryItem['condition'] = 'nm'
  ): Promise<InventoryItem> {
    const inventoryItem: InventoryItem = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      cardId: card.id,
      storeId,
      storeName: '', // Will be populated from store service
      quantity,
      condition,
      price,
      currency: 'USD',
      lastUpdated: new Date().toISOString(),
      source: 'manual_entry',
    };

    const saved = await inventoryService.updateInventory(inventoryItem);

    // Emit inventory updated event
    await webhookService.emitEvent('inventory.updated', {
      cardId: card.id,
      cardName: card.name,
      storeId,
      quantity,
      price,
      game: card.game,
    });

    // Check if low stock
    if (quantity <= 5) {
      await webhookService.emitEvent('inventory.low_stock', {
        cardId: card.id,
        cardName: card.name,
        storeId,
        currentQuantity: quantity,
        reorderPoint: 5,
        game: card.game,
      });
    }

    return saved;
  }

  async recordAvailability(
    cardId: string,
    game: 'pokemon' | 'one_piece',
    signalType: AvailabilitySignal['signalType'],
    details: {
      storeId?: string;
      storeName?: string;
      price?: number;
      quantity?: number;
      confidence?: number;
      source?: string;
    }
  ): Promise<AvailabilitySignal> {
    const card = await this.getCardById(cardId, game);
    
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }

    const signal = await inventoryService.recordAvailabilitySignal({
      cardId,
      storeId: details.storeId,
      storeName: details.storeName,
      signalType,
      confidence: details.confidence || 1.0,
      price: details.price,
      quantity: details.quantity,
      source: details.source || 'manual',
      rawData: {
        cardName: card.name,
        setName: card.setName,
        game,
      },
    });

    // Emit appropriate event based on signal type
    if (signalType === 'restocked') {
      await webhookService.emitEvent('inventory.restocked', {
        cardId,
        cardName: card.name,
        storeId: details.storeId,
        storeName: details.storeName,
        quantity: details.quantity,
        game,
      });
    }

    return signal;
  }

  // ========== Bulk Operations ==========

  async syncInventoryWithApi(game: 'pokemon' | 'one_piece'): Promise<{
    added: number;
    updated: number;
    errors: number;
  }> {
    const stats = { added: 0, updated: 0, errors: 0 };

    try {
      // Get all cards from API
      const result = await this.getAllCards({ 
        page: 1, 
        pageSize: 1000, 
        filter: { game } 
      });

      // Get current inventory
      const currentInventory = await inventoryService.getInventory({ game });
      const inventoryMap = new Map(currentInventory.map(item => [item.cardId, item]));

      // Process each card
      for (const card of result.data) {
        try {
          const existing = inventoryMap.get(card.id);

          if (existing) {
            // Update price if changed
            if (card.marketPrice && card.marketPrice !== existing.price) {
              existing.price = card.marketPrice;
              existing.lastUpdated = new Date().toISOString();
              await inventoryService.updateInventory(existing);
              stats.updated++;
            }
          } else {
            // Could add new inventory items here if needed
            stats.added++;
          }
        } catch (error) {
          console.error(`Error syncing card ${card.id}:`, error);
          stats.errors++;
        }
      }

      return stats;
    } catch (error) {
      console.error('Error syncing inventory:', error);
      return stats;
    }
  }

  // ========== Analytics ==========

  async getCardAnalytics(cardId: string, game: 'pokemon' | 'one_piece'): Promise<{
    card: Card | null;
    priceHistory: Array<{ date: string; price: number; source: string }>;
    inventoryHistory: InventoryItem[];
    availabilitySignals: AvailabilitySignal[];
    marketTrend: 'rising' | 'falling' | 'stable';
    averagePrice: number;
    priceChange24h: number;
    priceChange7d: number;
  }> {
    const card = await this.getCardById(cardId, game);
    const priceHistory = await this.getPriceHistory(cardId, game);
    const inventory = await inventoryService.getInventory({ cardId });
    const signals = await inventoryService.getAvailabilitySignals({ cardId });

    // Calculate trends
    const prices = priceHistory.map(p => p.price).filter(p => p > 0);
    const averagePrice = prices.length > 0 
      ? prices.reduce((a, b) => a + b, 0) / prices.length 
      : 0;

    let marketTrend: 'rising' | 'falling' | 'stable' = 'stable';
    let priceChange24h = 0;
    let priceChange7d = 0;

    if (prices.length >= 2) {
      const latest = prices[prices.length - 1];
      const previous = prices[prices.length - 2];
      priceChange24h = ((latest - previous) / previous) * 100;

      if (prices.length >= 8) {
        const weekAgo = prices[prices.length - 8];
        priceChange7d = ((latest - weekAgo) / weekAgo) * 100;
      }

      if (priceChange7d > 5) marketTrend = 'rising';
      else if (priceChange7d < -5) marketTrend = 'falling';
    }

    return {
      card,
      priceHistory,
      inventoryHistory: inventory,
      availabilitySignals: signals,
      marketTrend,
      averagePrice,
      priceChange24h,
      priceChange7d,
    };
  }

  // ========== Game-Specific Features ==========

  async getPokemonSpecificData(cardId: string): Promise<{
    weaknesses: Array<{ type: string; value: string }>;
    resistances: Array<{ type: string; value: string }>;
    attacks: Array<{ name: string; damage: string; cost: string[] }>;
    retreatCost: number;
    abilities: Array<{ name: string; text: string }>;
  } | null> {
    const card = await pokemonApi.getCardById(cardId);
    
    if (!card || card.game !== 'pokemon') return null;

    const pokemonCard = card as PokemonCard;

    return {
      weaknesses: pokemonCard.weaknesses || [],
      resistances: pokemonCard.resistances || [],
      attacks: pokemonCard.attacks?.map(a => ({
        name: a.name,
        damage: a.damage,
        cost: a.cost,
      })) || [],
      retreatCost: pokemonCard.convertedRetreatCost || 0,
      abilities: [], // Extract from card data if available
    };
  }

  async getOnePieceSpecificData(cardId: string): Promise<{
    color: string[];
    power?: number;
    counter?: number;
    life?: number;
    cost?: number;
    attribute?: string;
    effect?: string;
    trigger?: string;
  } | null> {
    const card = await onePieceApi.getCardById(cardId);
    
    if (!card || card.game !== 'one_piece') return null;

    const opCard = card as OnePieceCard;

    return {
      color: opCard.color,
      power: opCard.power,
      counter: opCard.counter,
      life: opCard.life,
      cost: opCard.cost,
      attribute: opCard.attribute,
      effect: opCard.effect,
      trigger: opCard.trigger,
    };
  }
}

export const cardService = new CardService();
