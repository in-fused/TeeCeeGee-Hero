import { useState, useCallback } from 'react';
import { useReplenishment, useStockLevels } from '@/hooks/useInventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { 
  RefreshCw, 
  Plus, 
  CheckCircle2, 
  Clock,
  TrendingDown,
  ShoppingCart,
  Truck,
  ClipboardList,
} from 'lucide-react';
import type { ReplenishmentOrder, ReplenishmentStatus, ReplenishmentItem } from '@/types';

const statusColors: Record<ReplenishmentStatus, string> = {
  draft: 'bg-gray-500',
  pending_approval: 'bg-yellow-500',
  ordered: 'bg-blue-500',
  partially_shipped: 'bg-orange-500',
  shipped: 'bg-purple-500',
  in_transit: 'bg-indigo-500',
  delivered: 'bg-green-500',
  partially_received: 'bg-teal-500',
  received: 'bg-green-600',
  cancelled: 'bg-red-500',
};

const statusLabels: Record<ReplenishmentStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  ordered: 'Ordered',
  partially_shipped: 'Partially Shipped',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export function ReplenishmentPanel() {
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<ReplenishmentStatus | ''>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [suggestionsDialogOpen, setSuggestionsDialogOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{
    cardId: string;
    cardName: string;
    currentStock: number;
    reorderPoint: number;
    suggestedOrder: number;
    priority: 'high' | 'medium' | 'low';
  }>>([]);

  const { 
    orders, 
    loading, 
    error: _error, 
    refresh, 
    createOrder, 
    updateStatus,
    getSuggestions 
  } = useReplenishment({
    storeId: selectedStore,
    status: statusFilter || undefined,
  });

  const { lowStockItems } = useStockLevels({ storeId: selectedStore });

  const [newOrder, setNewOrder] = useState<Partial<ReplenishmentOrder>>({
    status: 'draft',
    items: [],
  });

  const [newItem, setNewItem] = useState<Partial<ReplenishmentItem>>({
    quantityOrdered: 1,
    unitCost: 0,
  });

  const handleLoadSuggestions = useCallback(async () => {
    if (!selectedStore) {
      toast.error('Please select a store first');
      return;
    }

    const sugg = await getSuggestions(selectedStore);
    setSuggestions(sugg);
    setSuggestionsDialogOpen(true);
  }, [selectedStore, getSuggestions]);

  const handleAddSuggestionToOrder = useCallback((suggestion: typeof suggestions[0]) => {
    const item: ReplenishmentItem = {
      cardId: suggestion.cardId,
      cardName: suggestion.cardName,
      quantityOrdered: suggestion.suggestedOrder,
      unitCost: 0,
      totalCost: 0,
    };

    setNewOrder(prev => ({
      ...prev,
      items: [...(prev.items || []), item],
    }));

    toast.success(`Added ${suggestion.cardName} to order`);
  }, []);

  const handleAddItem = useCallback(() => {
    if (!newItem.cardId || !newItem.quantityOrdered) {
      toast.error('Please fill in item details');
      return;
    }

    const item: ReplenishmentItem = {
      cardId: newItem.cardId,
      cardName: newItem.cardName || newItem.cardId,
      quantityOrdered: newItem.quantityOrdered,
      unitCost: newItem.unitCost || 0,
      totalCost: (newItem.unitCost || 0) * newItem.quantityOrdered,
    };

    setNewOrder(prev => ({
      ...prev,
      items: [...(prev.items || []), item],
    }));

    setNewItem({ quantityOrdered: 1, unitCost: 0 });
  }, [newItem]);

  const handleCreateOrder = useCallback(async () => {
    if (!newOrder.storeId || !newOrder.items || newOrder.items.length === 0) {
      toast.error('Please add items to the order');
      return;
    }

    const totalCost = newOrder.items.reduce((sum, item) => sum + item.totalCost, 0);

    try {
      await createOrder({
        ...newOrder,
        totalCost,
        source: 'manual',
      } as Omit<ReplenishmentOrder, 'id' | 'createdAt' | 'updatedAt'>);
      
      toast.success('Order created successfully');
      setCreateDialogOpen(false);
      setNewOrder({ status: 'draft', items: [] });
    } catch (err) {
      toast.error('Failed to create order');
    }
  }, [newOrder, createOrder]);

  const handleUpdateStatus = useCallback(async (orderId: string, newStatus: ReplenishmentStatus) => {
    try {
      await updateStatus(orderId, newStatus);
      toast.success(`Order status updated to ${statusLabels[newStatus]}`);
    } catch (err) {
      toast.error('Failed to update status');
    }
  }, [updateStatus]);

  const calculateOrderTotal = (items: ReplenishmentItem[]) => {
    return items.reduce((sum, item) => sum + item.totalCost, 0);
  };

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {orders.filter(o => ['draft', 'pending_approval', 'ordered'].includes(o.status)).length}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting processing</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Transit</CardTitle>
            <Truck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {orders.filter(o => ['shipped', 'in_transit', 'delivered'].includes(o.status)).length}
            </div>
            <p className="text-xs text-muted-foreground">On the way</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Reorder</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {lowStockItems.length}
            </div>
            <p className="text-xs text-muted-foreground">Items below reorder point</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Ordered (30d)</CardTitle>
            <ShoppingCart className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${orders
                .filter(o => o.status !== 'cancelled')
                .reduce((sum, o) => sum + o.totalCost, 0)
                .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">Total value</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedStore} onValueChange={setSelectedStore}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select Store" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Stores</SelectItem>
            <SelectItem value="store-1">Store 1</SelectItem>
            <SelectItem value="store-2">Store 2</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={handleLoadSuggestions} variant="outline">
          <ClipboardList className="mr-2 h-4 w-4" />
          View Suggestions
        </Button>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Replenishment Order</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Store</label>
                <Input
                  value={newOrder.storeId || ''}
                  onChange={(e) => setNewOrder(prev => ({ ...prev, storeId: e.target.value }))}
                  placeholder="Store ID"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Supplier ID (Optional)</label>
                <Input
                  value={newOrder.supplierId || ''}
                  onChange={(e) => setNewOrder(prev => ({ ...prev, supplierId: e.target.value }))}
                  placeholder="Supplier ID"
                />
              </div>

              <Separator />

              <div>
                <label className="text-sm font-medium">Add Item</label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  <Input
                    placeholder="Card ID"
                    value={newItem.cardId || ''}
                    onChange={(e) => setNewItem(prev => ({ ...prev, cardId: e.target.value }))}
                  />
                  <Input
                    placeholder="Card Name"
                    value={newItem.cardName || ''}
                    onChange={(e) => setNewItem(prev => ({ ...prev, cardName: e.target.value }))}
                  />
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={newItem.quantityOrdered}
                    onChange={(e) => setNewItem(prev => ({ 
                      ...prev, 
                      quantityOrdered: parseInt(e.target.value) || 0 
                    }))}
                  />
                  <Input
                    type="number"
                    placeholder="Unit Cost"
                    value={newItem.unitCost}
                    onChange={(e) => setNewItem(prev => ({ 
                      ...prev, 
                      unitCost: parseFloat(e.target.value) || 0 
                    }))}
                  />
                </div>
                <Button onClick={handleAddItem} className="mt-2" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </div>

              {newOrder.items && newOrder.items.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <label className="text-sm font-medium">Order Items</label>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Card</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Unit Cost</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newOrder.items.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{item.cardName}</TableCell>
                            <TableCell className="text-right">{item.quantityOrdered}</TableCell>
                            <TableCell className="text-right">${item.unitCost.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${item.totalCost.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={3} className="text-right font-bold">Total:</TableCell>
                          <TableCell className="text-right font-bold">
                            ${calculateOrderTotal(newOrder.items).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              <Button onClick={handleCreateOrder} className="w-full">
                Create Order
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReplenishmentStatus)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Statuses</SelectItem>
            {Object.entries(statusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Replenishment Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No orders found
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>{order.storeId}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[order.status]}>
                          {statusLabels[order.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{order.items.length}</TableCell>
                      <TableCell className="text-right">
                        ${order.totalCost.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {order.orderedAt ? new Date(order.orderedAt).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        {order.expectedDelivery ? new Date(order.expectedDelivery).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        <Select 
                          value={order.status} 
                          onValueChange={(v) => handleUpdateStatus(order.id, v as ReplenishmentStatus)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(statusLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Suggestions Dialog */}
      <Dialog open={suggestionsDialogOpen} onOpenChange={setSuggestionsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Replenishment Suggestions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {suggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
                <p>No replenishment suggestions at this time</p>
                <p className="text-sm">All items are above their reorder points</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Card</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Reorder Pt</TableHead>
                    <TableHead className="text-right">Suggested</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.map((suggestion) => (
                    <TableRow key={suggestion.cardId}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{suggestion.cardName}</p>
                          <p className="text-sm text-muted-foreground">{suggestion.cardId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{suggestion.currentStock}</TableCell>
                      <TableCell className="text-right">{suggestion.reorderPoint}</TableCell>
                      <TableCell className="text-right font-bold">
                        {suggestion.suggestedOrder}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={suggestion.priority === 'high' ? 'destructive' : 'secondary'}
                        >
                          {suggestion.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleAddSuggestionToOrder(suggestion)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
