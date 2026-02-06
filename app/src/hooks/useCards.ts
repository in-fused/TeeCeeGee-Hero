import { useState, useEffect, useCallback, useRef } from 'react';
import { cardService } from '@/services/cardService';
import type { Card, CardFilter, PokemonCard, OnePieceCard } from '@/services/cardService';

interface UseCardsOptions {
  page?: number;
  pageSize?: number;
  filter?: CardFilter;
  autoLoad?: boolean;
}

interface UseCardsReturn {
  cards: Card[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  total: number;
  loadMore: () => void;
  refresh: () => void;
  search: (query: string) => void;
}

export function useCards(options: UseCardsOptions = {}): UseCardsReturn {
  const { pageSize = 50, filter, autoLoad = true } = options;
  
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchCards = useCallback(async (pageNum: number, append: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      const result = await cardService.getAllCards({
        page: pageNum,
        pageSize,
        filter: {
          ...filter,
          search: searchQuery || filter?.search,
        },
      });

      setCards(prev => append ? [...prev, ...result.data] : result.data);
      setHasMore(result.meta?.hasMore || false);
      setTotal(result.meta?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch cards'));
    } finally {
      setLoading(false);
    }
  }, [pageSize, filter, searchQuery]);

  useEffect(() => {
    if (autoLoad) {
      setPage(1);
      fetchCards(1, false);
    }
  }, [filter?.game, filter?.setName, filter?.rarity, searchQuery, autoLoad]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchCards(nextPage, true);
    }
  }, [loading, hasMore, page, fetchCards]);

  const refresh = useCallback(() => {
    setPage(1);
    fetchCards(1, false);
  }, [fetchCards]);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  return {
    cards,
    loading,
    error,
    hasMore,
    total,
    loadMore,
    refresh,
    search,
  };
}

interface UseCardDetailsOptions {
  cardId: string;
  game: 'pokemon' | 'one_piece';
}

interface UseCardDetailsReturn {
  card: Card | null;
  inventory: Array<{
    storeId: string;
    storeName: string;
    quantity: number;
    price: number;
  }>;
  totalQuantity: number;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useCardDetails(options: UseCardDetailsOptions): UseCardDetailsReturn {
  const { cardId, game } = options;
  
  const [card, setCard] = useState<Card | null>(null);
  const [inventory, setInventory] = useState<UseCardDetailsReturn['inventory']>([]);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!cardId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await cardService.getCardWithInventory(cardId, game);
      setCard(result.card);
      setInventory(result.inventory.map(item => ({
        storeId: item.storeId,
        storeName: item.storeName,
        quantity: item.quantity,
        price: item.price,
      })));
      setTotalQuantity(result.totalQuantity);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch card details'));
    } finally {
      setLoading(false);
    }
  }, [cardId, game]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  return {
    card,
    inventory,
    totalQuantity,
    loading,
    error,
    refresh: fetchDetails,
  };
}

interface UseCardSearchOptions {
  debounceMs?: number;
}

interface UseCardSearchReturn {
  query: string;
  results: Card[];
  loading: boolean;
  error: Error | null;
  setQuery: (query: string) => void;
  clear: () => void;
}

export function useCardSearch(options: UseCardSearchOptions = {}): UseCardSearchReturn {
  const { debounceMs = 300 } = options;
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (query.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    
    debounceTimer.current = setTimeout(async () => {
      try {
        const cards = await cardService.searchCards(query);
        setResults(cards.slice(0, 20)); // Limit to 20 results
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Search failed'));
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, debounceMs]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
  }, []);

  return {
    query,
    results,
    loading,
    error,
    setQuery,
    clear,
  };
}

interface UseSetsReturn {
  sets: Array<{
    id: string;
    name: string;
    game: 'pokemon' | 'one_piece';
    series?: string;
    releaseDate: string;
    total: number;
  }>;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useSets(): UseSetsReturn {
  const [sets, setSets] = useState<UseSetsReturn['sets']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await cardService.getAllSets();
      setSets(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch sets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  return {
    sets,
    loading,
    error,
    refresh: fetchSets,
  };
}

interface UseCardAnalyticsOptions {
  cardId: string;
  game: 'pokemon' | 'one_piece';
}

interface UseCardAnalyticsReturn {
  analytics: {
    priceHistory: Array<{ date: string; price: number; source: string }>;
    marketTrend: 'rising' | 'falling' | 'stable';
    averagePrice: number;
    priceChange24h: number;
    priceChange7d: number;
  } | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useCardAnalytics(options: UseCardAnalyticsOptions): UseCardAnalyticsReturn {
  const { cardId, game } = options;
  
  const [analytics, setAnalytics] = useState<UseCardAnalyticsReturn['analytics']>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!cardId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await cardService.getCardAnalytics(cardId, game);
      setAnalytics({
        priceHistory: result.priceHistory,
        marketTrend: result.marketTrend,
        averagePrice: result.averagePrice,
        priceChange24h: result.priceChange24h,
        priceChange7d: result.priceChange7d,
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch analytics'));
    } finally {
      setLoading(false);
    }
  }, [cardId, game]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    analytics,
    loading,
    error,
    refresh: fetchAnalytics,
  };
}

export type { Card, PokemonCard, OnePieceCard, CardFilter };
