import { useState, useMemo } from 'react';
import { useInventoryMetrics } from '@/hooks/useInventory';
import { useCards } from '@/hooks/useCards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  TrendingDown, 
  Package, 
  DollarSign, 
  ShoppingCart,
  Truck,
  Activity,
} from 'lucide-react';

// Simple chart component using divs
function SimpleBarChart({ 
  data, 
  maxValue 
}: { 
  data: Array<{ label: string; value: number; color?: string }>;
  maxValue: number;
}) {
  return (
    <div className="space-y-2">
      {data.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-24 text-sm text-muted-foreground truncate">{item.label}</div>
          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full ${item.color || 'bg-primary'} transition-all duration-500`}
              style={{ width: `${(item.value / maxValue) * 100}%` }}
            />
          </div>
          <div className="w-16 text-sm text-right">{item.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function SimplePieChart({ 
  data 
}: { 
  data: Array<{ label: string; value: number; color: string }>;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let currentAngle = 0;

  return (
    <div className="flex items-center gap-8">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {data.map((item, idx) => {
            const angle = (item.value / total) * 360;
            const startAngle = currentAngle;
            currentAngle += angle;
            
            const x1 = 50 + 40 * Math.cos((startAngle * Math.PI) / 180);
            const y1 = 50 + 40 * Math.sin((startAngle * Math.PI) / 180);
            const x2 = 50 + 40 * Math.cos(((startAngle + angle) * Math.PI) / 180);
            const y2 = 50 + 40 * Math.sin(((startAngle + angle) * Math.PI) / 180);
            
            const largeArc = angle > 180 ? 1 : 0;
            
            return (
              <path
                key={idx}
                d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={item.color}
                stroke="white"
                strokeWidth="2"
              />
            );
          })}
          <circle cx="50" cy="50" r="20" fill="white" />
        </svg>
      </div>
      <div className="space-y-1">
        {data.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.label}:</span>
            <span className="font-medium">{((item.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const { metrics, loading: metricsLoading } = useInventoryMetrics();
  const { cards, loading: cardsLoading } = useCards({ pageSize: 1000 });

  const loading = metricsLoading || cardsLoading;

  // Calculate analytics
  const analytics = useMemo(() => {
    if (!cards.length) return null;

    // Game distribution
    const gameDistribution = {
      pokemon: cards.filter(c => c.game === 'pokemon').length,
      one_piece: cards.filter(c => c.game === 'one_piece').length,
    };

    // Price ranges
    const priceRanges = {
      under5: cards.filter(c => (c.marketPrice || 0) > 0 && (c.marketPrice || 0) < 5).length,
      under25: cards.filter(c => (c.marketPrice || 0) >= 5 && (c.marketPrice || 0) < 25).length,
      under100: cards.filter(c => (c.marketPrice || 0) >= 25 && (c.marketPrice || 0) < 100).length,
      over100: cards.filter(c => (c.marketPrice || 0) >= 100).length,
      noPrice: cards.filter(c => !c.marketPrice).length,
    };

    // Top sets
    const setCounts: Record<string, number> = {};
    cards.forEach(card => {
      setCounts[card.setName] = (setCounts[card.setName] || 0) + 1;
    });
    const topSets = Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ label: name, value: count }));

    // Rarity distribution
    const rarityCounts: Record<string, number> = {};
    cards.forEach(card => {
      if (card.rarity) {
        rarityCounts[card.rarity] = (rarityCounts[card.rarity] || 0) + 1;
      }
    });
    const topRarities = Object.entries(rarityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ label: name, value: count, color: getRarityColor(name) }));

    // Price statistics
    const prices = cards.map(c => c.marketPrice || 0).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;

    return {
      gameDistribution,
      priceRanges,
      topSets,
      topRarities,
      avgPrice,
      maxPrice,
      minPrice,
      totalCards: cards.length,
      cardsWithPrice: prices.length,
    };
  }, [cards]);

  function getRarityColor(rarity: string): string {
    const colors: Record<string, string> = {
      'Common': '#9CA3AF',
      'Uncommon': '#10B981',
      'Rare': '#3B82F6',
      'Holo Rare': '#8B5CF6',
      'Ultra Rare': '#F59E0B',
      'Secret Rare': '#EF4444',
    };
    return colors[rarity] || '#6B7280';
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
          <p className="text-muted-foreground">Insights into your card inventory and operations</p>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as typeof timeRange)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 Days</SelectItem>
            <SelectItem value="30d">30 Days</SelectItem>
            <SelectItem value="90d">90 Days</SelectItem>
            <SelectItem value="1y">1 Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cards</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Skeleton className="h-8 w-24" /> : analytics?.totalCards.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics?.cardsWithPrice.toLocaleString()} with price data
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Market Price</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Skeleton className="h-8 w-24" /> : `$${analytics?.avgPrice.toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground">
              Range: ${analytics?.minPrice.toFixed(2)} - ${analytics?.maxPrice.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Skeleton className="h-8 w-24" /> : `$${metrics?.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics?.totalCards.toLocaleString()} cards in stock
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Skeleton className="h-8 w-24" /> : metrics?.pendingShipments}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics?.recentRestocks} restocks this week
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="distribution" className="space-y-4">
        <TabsList>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="sets">Top Sets</TabsTrigger>
        </TabsList>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Game Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics && (
                  <SimplePieChart 
                    data={[
                      { label: 'Pokémon', value: analytics.gameDistribution.pokemon, color: '#EF4444' },
                      { label: 'One Piece', value: analytics.gameDistribution.one_piece, color: '#3B82F6' },
                    ]} 
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Rarity Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics && (
                  <SimpleBarChart 
                    data={analytics.topRarities}
                    maxValue={Math.max(...analytics.topRarities.map(r => r.value))}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Price Range Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics && (
                <SimpleBarChart 
                  data={[
                    { label: 'Under $5', value: analytics.priceRanges.under5, color: '#10B981' },
                    { label: '$5 - $25', value: analytics.priceRanges.under25, color: '#3B82F6' },
                    { label: '$25 - $100', value: analytics.priceRanges.under100, color: '#8B5CF6' },
                    { label: 'Over $100', value: analytics.priceRanges.over100, color: '#EF4444' },
                    { label: 'No Price', value: analytics.priceRanges.noPrice, color: '#9CA3AF' },
                  ]}
                  maxValue={Math.max(
                    analytics.priceRanges.under5,
                    analytics.priceRanges.under25,
                    analytics.priceRanges.under100,
                    analytics.priceRanges.over100,
                    analytics.priceRanges.noPrice
                  )}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top Sets by Card Count</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics && (
                <SimpleBarChart 
                  data={analytics.topSets}
                  maxValue={analytics.topSets[0]?.value || 1}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Inventory Status */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                <Package className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Stock</p>
                <p className="text-2xl font-bold">
                  {metrics ? metrics.totalCards - metrics.outOfStockCount : '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <Activity className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {metrics?.lowStockCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrendingDown className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-bold text-red-600">
                  {metrics?.outOfStockCount}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
