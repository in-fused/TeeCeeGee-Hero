import { useState, useCallback } from 'react';
import { useCards, useSets, useCardSearch, type CardFilter } from '@/hooks/useCards';
import { cardService } from '@/services/cardService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { 
  Search, 
  Filter, 
  Loader2, 
  Package, 
  TrendingUp, 
  ExternalLink,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Card as CardType } from '@/types';

export function CardDashboard() {
  const [filter, setFilter] = useState<CardFilter>({});
  const [_selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { cards, loading, error, hasMore, total, loadMore, refresh } = useCards({
    pageSize: 50,
    filter,
  });

  const { sets } = useSets();
  const { query, results: searchResults, loading: searchLoading, setQuery, clear } = useCardSearch();

  const handleGameChange = useCallback((game: string) => {
    setFilter((prev: CardFilter) => ({ ...prev, game: game as 'pokemon' | 'one_piece' }));
  }, []);

  const handleSetChange = useCallback((setName: string) => {
    setFilter((prev: CardFilter) => ({ ...prev, setName: setName === 'all' ? undefined : setName }));
  }, []);

  const handleRarityChange = useCallback((rarity: string) => {
    setFilter((prev: CardFilter) => ({ ...prev, rarity: rarity === 'all' ? undefined : rarity }));
  }, []);

  const handleSearchSelect = useCallback((card: CardType) => {
    setSelectedCard(card);
    clear();
    setQuery('');
  }, [clear, setQuery]);

  const handleSyncPrices = useCallback(async () => {
    toast.promise(
      cardService.syncInventoryWithApi(filter.game || 'pokemon'),
      {
        loading: 'Syncing prices with API...',
        success: (result) => `Synced ${result.updated} cards, added ${result.added} new`,
        error: 'Failed to sync prices',
      }
    );
  }, [filter.game]);

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cards</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Across all sets
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pokémon Cards</CardTitle>
            <div className="h-4 w-4 rounded-full bg-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cards.filter(c => c.game === 'pokemon').length.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Loaded in current view
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">One Piece Cards</CardTitle>
            <div className="h-4 w-4 rounded-full bg-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cards.filter(c => c.game === 'one_piece').length.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Loaded in current view
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Market Price</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${cards.length > 0
                ? (cards.reduce((sum, c) => sum + (c.marketPrice || 0), 0) / cards.length).toFixed(2)
                : '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              Average across loaded cards
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search cards by name, set, or number..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
              {searchLoading && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" />
              )}
              
              {/* Search Results Dropdown */}
              {searchResults.length > 0 && (
                <Card className="absolute z-50 mt-1 w-full">
                  <ScrollArea className="max-h-64">
                    {searchResults.map((card) => (
                      <button
                        key={card.id}
                        onClick={() => handleSearchSelect(card)}
                        className="flex w-full items-center gap-3 p-3 hover:bg-muted text-left"
                      >
                        {card.imageUrl && (
                          <img
                            src={card.imageUrl}
                            alt={card.name}
                            className="h-12 w-8 object-contain"
                          />
                        )}
                        <div className="flex-1">
                          <p className="font-medium">{card.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {card.setName} • {card.game === 'pokemon' ? 'Pokémon' : 'One Piece'}
                          </p>
                        </div>
                        {card.marketPrice && (
                          <Badge variant="secondary">
                            ${card.marketPrice.toFixed(2)}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </ScrollArea>
                </Card>
              )}
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {showFilters ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
              </Button>

              <Select onValueChange={handleGameChange} value={filter.game}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Games" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="pokemon">Pokémon</SelectItem>
                  <SelectItem value="one_piece">One Piece</SelectItem>
                </SelectContent>
              </Select>

              <Select onValueChange={handleSetChange}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Sets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sets</SelectItem>
                  {sets.map((set) => (
                    <SelectItem key={set.id} value={set.name}>
                      {set.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={handleSyncPrices}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Prices
              </Button>

              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>

            {/* Expanded Filters */}
            {showFilters && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <Select onValueChange={handleRarityChange}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="All Rarities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Rarities</SelectItem>
                    <SelectItem value="Common">Common</SelectItem>
                    <SelectItem value="Uncommon">Uncommon</SelectItem>
                    <SelectItem value="Rare">Rare</SelectItem>
                    <SelectItem value="Holo Rare">Holo Rare</SelectItem>
                    <SelectItem value="Ultra Rare">Ultra Rare</SelectItem>
                    <SelectItem value="Secret Rare">Secret Rare</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="number"
                  placeholder="Min Price"
                  className="w-32"
                  onChange={(e) => setFilter((prev: CardFilter) => ({ 
                    ...prev, 
                    minPrice: e.target.value ? parseFloat(e.target.value) : undefined 
                  }))}
                />

                <Input
                  type="number"
                  placeholder="Max Price"
                  className="w-32"
                  onChange={(e) => setFilter((prev: CardFilter) => ({ 
                    ...prev, 
                    maxPrice: e.target.value ? parseFloat(e.target.value) : undefined 
                  }))}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading && cards.length === 0 ? (
          // Loading skeletons
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="aspect-[2/3] w-full" />
                <Skeleton className="mt-4 h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </CardContent>
            </Card>
          ))
        ) : error ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center">
              <p className="text-red-500">Error loading cards: {error.message}</p>
              <Button onClick={refresh} className="mt-4">
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : cards.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center">
              <Package className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No cards found</p>
            </CardContent>
          </Card>
        ) : (
          cards.map((card) => (
            <Dialog key={card.id}>
              <DialogTrigger asChild>
                <Card className="cursor-pointer transition-shadow hover:shadow-lg">
                  <CardContent className="p-4">
                    <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
                      {card.imageUrl ? (
                        <img
                          src={card.imageUrl}
                          alt={card.name}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Package className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold line-clamp-2">{card.name}</h3>
                        <Badge variant={card.game === 'pokemon' ? 'default' : 'secondary'}>
                          {card.game === 'pokemon' ? 'PKM' : 'OP'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {card.setName}
                      </p>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">{card.rarity || 'Unknown'}</Badge>
                        {card.marketPrice ? (
                          <span className="font-bold text-green-600">
                            ${card.marketPrice.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">No price</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{card.name}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
                    {card.imageUrl && (
                      <img
                        src={card.imageUrl}
                        alt={card.name}
                        className="h-full w-full object-contain"
                      />
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold">Details</h4>
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Set:</dt>
                          <dd>{card.setName}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Number:</dt>
                          <dd>{card.number || 'N/A'}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Rarity:</dt>
                          <dd>{card.rarity || 'Unknown'}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Game:</dt>
                          <dd>{card.game === 'pokemon' ? 'Pokémon' : 'One Piece'}</dd>
                        </div>
                      </dl>
                    </div>
                    
                    <Separator />
                    
                    <div>
                      <h4 className="font-semibold">Pricing</h4>
                      <div className="mt-2 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Market Price:</span>
                          <span className="text-xl font-bold">
                            {card.marketPrice ? `$${card.marketPrice.toFixed(2)}` : 'N/A'}
                          </span>
                        </div>
                        {card.msrp && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">MSRP:</span>
                            <span>${card.msrp.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={() => toast.info('Add to inventory coming soon')}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add to Inventory
                      </Button>
                      <Button variant="outline" onClick={() => toast.info('View on marketplace coming soon')}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          ))
        )}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center">
          <Button onClick={loadMore} disabled={loading} size="lg">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>Load More Cards</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
