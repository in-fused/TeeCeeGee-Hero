import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PageTransition } from '../components/PageTransition';
import { SearchInput } from '../components/SearchInput';
import { FilterChip } from '../components/FilterChip';
import { ProductCard } from '../components/ProductCard';
import { Spinner } from '../components/Spinner';
import { useDebounce } from '../hooks/useDebounce';
import { searchProducts, type Product } from '../lib/api';

const GAMES = [
  { value: '', label: 'All Games' },
  { value: 'pokemon', label: 'Pokemon' },
  { value: 'one_piece', label: 'One Piece' },
];

const TYPES = [
  { value: '', label: 'All Types' },
  { value: 'etb', label: 'ETB' },
  { value: 'booster_box', label: 'Booster Box' },
  { value: 'booster_pack', label: 'Booster Pack' },
  { value: 'tin', label: 'Tin' },
  { value: 'collection_box', label: 'Collection Box' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'blister', label: 'Blister' },
];

const PAGE_SIZE = 48;

export function Search() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [game, setGame] = useState(searchParams.get('game') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const debouncedQuery = useDebounce(query, 300);

  const fetchProducts = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      setError('');
      try {
        const result = await searchProducts({
          q: debouncedQuery || undefined,
          game: game || undefined,
          type: type || undefined,
          limit: String(PAGE_SIZE),
          offset: String(newOffset),
        });
        setProducts(result.products || []);
        setTotal(result.total || 0);
        setOffset(newOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setProducts([]);
      } finally {
        setLoading(false);
      }
    },
    [debouncedQuery, game, type],
  );

  useEffect(() => {
    fetchProducts(0);
    const params: Record<string, string> = {};
    if (debouncedQuery) params.q = debouncedQuery;
    if (game) params.game = game;
    if (type) params.type = type;
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, game, type, fetchProducts, setSearchParams]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <PageTransition>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search bar */}
        <div className="max-w-2xl mx-auto mb-8">
          <SearchInput
            placeholder="Search products... (e.g. Scarlet Violet, Charizard, Romance Dawn)"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2 ml-1">
              Game
            </p>
            <div className="flex flex-wrap gap-1.5">
              {GAMES.map((g) => (
                <FilterChip
                  key={g.value}
                  label={g.label}
                  active={game === g.value}
                  onClick={() => setGame(g.value)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2 ml-1">
              Type
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => (
                <FilterChip
                  key={t.value}
                  label={t.label}
                  active={type === t.value}
                  onClick={() => setType(t.value)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-400">
            {loading ? (
              'Searching...'
            ) : (
              <>
                <span className="text-white font-semibold">{total.toLocaleString()}</span> products
                found
              </>
            )}
          </p>
          {totalPages > 1 && (
            <p className="text-xs text-gray-500">
              Page {currentPage} of {totalPages}
            </p>
          )}
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 mb-6 text-sm text-red-300"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading */}
        {loading && <Spinner className="py-20" />}

        {/* Results grid */}
        {!loading && products.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && products.length === 0 && !error && (
          <div className="text-center py-20">
            <p className="text-gray-500 text-sm">No products found. Try adjusting your filters.</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button
              onClick={() => fetchProducts(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-sm text-gray-400">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => fetchProducts(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
