import { useState, useCallback } from 'react';
import { useInventory, useStockLevels, useInventoryMetrics } from '@/hooks/useInventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingDown,
  Plus,
  Minus,
  RefreshCw,
  DollarSign,
  Boxes,
} from 'lucide-react';
import type { InventoryItem } from '@/types';

export function InventoryManager() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState(0);

  const { inventory, loading, error: _error, refresh, adjustStock } = useInventory({
    filter: selectedStore ? { storeId: selectedStore } : undefined,
  });

  const { stockLevels, lowStockItems, refresh: refreshStockLevels } = useStockLevels({
    storeId: selectedStore,
  });

  const { metrics } = useInventoryMetrics();

  const handleAdjustStock = useCallback(async () => {
    if (!selectedItem || adjustmentAmount === 0) return;

    try {
      await adjustStock(
        selectedItem.cardId,
        selectedItem.storeId,
        adjustmentAmount,
        'Manual stock adjustment'
      );
      toast.success(`Stock adjusted by ${adjustmentAmount > 0 ? '+' : ''}${adjustmentAmount}`);
      setAdjustDialogOpen(false);
      setAdjustmentAmount(0);
      refreshStockLevels();
    } catch (err) {
      toast.error('Failed to adjust stock');
    }
  }, [selectedItem, adjustmentAmount, adjustStock, refreshStockLevels]);

  const filteredInventory = inventory.filter(item =>
    item.cardName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.cardId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getConditionBadge = (condition: InventoryItem['condition']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      sealed: 'default',
      nm: 'secondary',
      lp: 'outline',
      mp: 'outline',
      hp: 'destructive',
      damaged: 'destructive',
    };
    return <Badge variant={variants[condition] || 'outline'}>{condition.toUpperCase()}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Inventory</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.totalCards.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">Cards in stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${metrics?.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Total value</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {metrics?.lowStockCount || 0}
            </div>
            <p className="text-xs text-muted-foreground">Items below reorder point</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {metrics?.outOfStockCount || 0}
            </div>
            <p className="text-xs text-muted-foreground">Items needing restock</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="inventory" className="space-y-4">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="stock-levels">Stock Levels</TabsTrigger>
          <TabsTrigger value="low-stock">
            Low Stock
            {lowStockItems.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {lowStockItems.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Inventory Items</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={selectedStore} onValueChange={setSelectedStore}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="All Stores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Stores</SelectItem>
                      <SelectItem value="store-1">Store 1</SelectItem>
                      <SelectItem value="store-2">Store 2</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search inventory..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 w-64"
                    />
                  </div>
                  <Button variant="outline" size="icon" onClick={refresh}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Card</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : filteredInventory.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No inventory items found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredInventory.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{item.cardName || item.cardId}</p>
                              <p className="text-sm text-muted-foreground">{item.cardId}</p>
                            </div>
                          </TableCell>
                          <TableCell>{item.storeName || item.storeId}</TableCell>
                          <TableCell>{getConditionBadge(item.condition)}</TableCell>
                          <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                          <TableCell className="text-right">${item.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            ${(item.price * item.quantity).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedItem(item)}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Adjust
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Adjust Stock</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-sm text-muted-foreground">Item</p>
                                    <p className="font-medium">{selectedItem?.cardName || selectedItem?.cardId}</p>
                                  </div>
                                  <div>
                                    <p className="text-sm text-muted-foreground">Current Quantity</p>
                                    <p className="font-medium">{selectedItem?.quantity}</p>
                                  </div>
                                  <div>
                                    <p className="text-sm text-muted-foreground">Adjustment</p>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setAdjustmentAmount(prev => prev - 1)}
                                      >
                                        <Minus className="h-4 w-4" />
                                      </Button>
                                      <Input
                                        type="number"
                                        value={adjustmentAmount}
                                        onChange={(e) => setAdjustmentAmount(parseInt(e.target.value) || 0)}
                                        className="text-center w-24"
                                      />
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setAdjustmentAmount(prev => prev + 1)}
                                      >
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-sm text-muted-foreground">New Quantity</p>
                                    <p className="font-medium">
                                      {(selectedItem?.quantity || 0) + adjustmentAmount}
                                    </p>
                                  </div>
                                  <Button onClick={handleAdjustStock} className="w-full">
                                    Confirm Adjustment
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock-levels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stock Levels</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Card ID</TableHead>
                      <TableHead>Store ID</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Reorder Point</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockLevels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No stock levels found
                        </TableCell>
                      </TableRow>
                    ) : (
                      stockLevels.map((level) => (
                        <TableRow key={`${level.cardId}-${level.storeId}`}>
                          <TableCell className="font-medium">{level.cardId}</TableCell>
                          <TableCell>{level.storeId}</TableCell>
                          <TableCell className="text-right">{level.quantity}</TableCell>
                          <TableCell className="text-right">{level.reservedQuantity}</TableCell>
                          <TableCell className="text-right">{level.availableQuantity}</TableCell>
                          <TableCell className="text-right">{level.reorderPoint}</TableCell>
                          <TableCell>
                            {level.availableQuantity === 0 ? (
                              <Badge variant="destructive">Out of Stock</Badge>
                            ) : level.availableQuantity <= level.reorderPoint ? (
                              <Badge variant="secondary">Low Stock</Badge>
                            ) : (
                              <Badge variant="default">In Stock</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="low-stock" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Low Stock Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              {lowStockItems.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
                  <p className="mt-4 text-muted-foreground">No low stock items</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lowStockItems.map((item) => (
                    <Card key={`${item.cardId}-${item.storeId}`} className="border-yellow-200 bg-yellow-50">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{item.cardId}</p>
                            <p className="text-sm text-muted-foreground">
                              Store: {item.storeId}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-yellow-700">
                              {item.availableQuantity} / {item.reorderPoint}
                            </p>
                            <p className="text-sm text-yellow-600">Available / Reorder Point</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
