import { useState, useCallback } from 'react';
import { useShipments, useReceiving } from '@/hooks/useInventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { 
  Truck, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Plus,
  Search,
  RefreshCw,
} from 'lucide-react';
import type { Shipment, ShipmentStatus } from '@/types';

const shipmentStatusColors: Record<ShipmentStatus, string> = {
  pending: 'bg-gray-500',
  label_created: 'bg-blue-500',
  picked_up: 'bg-blue-600',
  in_transit: 'bg-yellow-500',
  out_for_delivery: 'bg-orange-500',
  delivered: 'bg-green-500',
  exception: 'bg-red-500',
  returned: 'bg-purple-500',
  unknown: 'bg-gray-400',
};

const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  pending: 'Pending',
  label_created: 'Label Created',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  exception: 'Exception',
  returned: 'Returned',
  unknown: 'Unknown',
};

export function ShipmentTracker() {
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | ''>('');
  const [carrierFilter, _setCarrierFilter] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [trackingCarrier, setTrackingCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingResult, setTrackingResult] = useState<Partial<Shipment> | null>(null);

  const { 
    shipments, 
    loading, 
    error: _error, 
    refresh, 
    createShipment, 
    updateStatus,
    trackShipment 
  } = useShipments({
    status: statusFilter || undefined,
    carrier: carrierFilter || undefined,
  });

  const { receivingEvents, createReceivingEvent } = useReceiving();

  const [newShipment, setNewShipment] = useState<Partial<Shipment>>({
    carrier: 'USPS',
    status: 'pending',
    items: [],
  });

  const handleCreateShipment = useCallback(async () => {
    if (!newShipment.carrier || !newShipment.trackingNumber || !newShipment.destinationStoreId) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      await createShipment(newShipment as Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>);
      toast.success('Shipment created successfully');
      setCreateDialogOpen(false);
      setNewShipment({ carrier: 'USPS', status: 'pending', items: [] });
    } catch (err) {
      toast.error('Failed to create shipment');
    }
  }, [newShipment, createShipment]);

  const handleTrackShipment = useCallback(async () => {
    if (!trackingCarrier || !trackingNumber) {
      toast.error('Please enter carrier and tracking number');
      return;
    }

    const result = await trackShipment(trackingCarrier, trackingNumber);
    setTrackingResult(result);
  }, [trackingCarrier, trackingNumber, trackShipment]);

  const handleUpdateStatus = useCallback(async (shipmentId: string, newStatus: ShipmentStatus) => {
    try {
      await updateStatus(shipmentId, newStatus, `Status updated to ${newStatus}`);
      toast.success('Status updated');
      
      if (newStatus === 'delivered') {
        toast.info('Shipment delivered - create receiving event to process inventory');
      }
    } catch (err) {
      toast.error('Failed to update status');
    }
  }, [updateStatus]);

  const handleCreateReceiving = useCallback(async (shipment: Shipment) => {
    try {
      await createReceivingEvent({
        shipmentId: shipment.id,
        storeId: shipment.destinationStoreId,
        receivedBy: 'current-user',
        items: shipment.items.map(item => ({
          cardId: item.cardId,
          cardName: item.cardName,
          quantityReceived: item.quantity,
          quantityExpected: item.quantity,
          condition: 'sealed',
          unitCost: item.expectedPrice,
          totalCost: item.expectedPrice * item.quantity,
        })),
        source: 'shipment_delivery',
      });
      toast.success('Receiving event created');
    } catch (err) {
      toast.error('Failed to create receiving event');
    }
  }, [createReceivingEvent]);

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Shipments</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {shipments.filter(s => s.status !== 'delivered' && s.status !== 'returned').length}
            </div>
            <p className="text-xs text-muted-foreground">In transit or pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Delivered Today</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {shipments.filter(s => {
                if (s.status !== 'delivered' || !s.deliveredAt) return false;
                const delivered = new Date(s.deliveredAt);
                const today = new Date();
                return delivered.toDateString() === today.toDateString();
              }).length}
            </div>
            <p className="text-xs text-muted-foreground">Received today</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Receiving</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {shipments.filter(s => s.status === 'delivered').length - receivingEvents.length}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting processing</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Exceptions</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {shipments.filter(s => s.status === 'exception').length}
            </div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Shipment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Shipment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Carrier</label>
                <Select 
                  value={newShipment.carrier} 
                  onValueChange={(v) => setNewShipment(prev => ({ ...prev, carrier: v as Shipment['carrier'] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USPS">USPS</SelectItem>
                    <SelectItem value="UPS">UPS</SelectItem>
                    <SelectItem value="FedEx">FedEx</SelectItem>
                    <SelectItem value="DHL">DHL</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Tracking Number</label>
                <Input
                  value={newShipment.trackingNumber || ''}
                  onChange={(e) => setNewShipment(prev => ({ ...prev, trackingNumber: e.target.value }))}
                  placeholder="Enter tracking number"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Destination Store</label>
                <Input
                  value={newShipment.destinationStoreId || ''}
                  onChange={(e) => setNewShipment(prev => ({ ...prev, destinationStoreId: e.target.value }))}
                  placeholder="Store ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Origin ZIP</label>
                <Input
                  value={newShipment.originZip || ''}
                  onChange={(e) => setNewShipment(prev => ({ ...prev, originZip: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <Button onClick={handleCreateShipment} className="w-full">
                Create Shipment
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Search className="mr-2 h-4 w-4" />
              Track Shipment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Track Shipment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Carrier</label>
                <Select value={trackingCarrier} onValueChange={setTrackingCarrier}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select carrier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USPS">USPS</SelectItem>
                    <SelectItem value="UPS">UPS</SelectItem>
                    <SelectItem value="FedEx">FedEx</SelectItem>
                    <SelectItem value="DHL">DHL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Tracking Number</label>
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Enter tracking number"
                />
              </div>
              <Button onClick={handleTrackShipment} className="w-full">
                Track
              </Button>
              
              {trackingResult && (
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Status:</span>
                    <Badge className={shipmentStatusColors[trackingResult.status as ShipmentStatus]}>
                      {shipmentStatusLabels[trackingResult.status as ShipmentStatus]}
                    </Badge>
                  </div>
                  {trackingResult.lastEvent && (
                    <div>
                      <span className="text-sm text-muted-foreground">Last Event:</span>
                      <p>{trackingResult.lastEvent}</p>
                    </div>
                  )}
                  {trackingResult.eta && (
                    <div>
                      <span className="text-sm text-muted-foreground">ETA:</span>
                      <p>{new Date(trackingResult.eta).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ShipmentStatus)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Statuses</SelectItem>
            {Object.entries(shipmentStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Shipments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Shipments</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : shipments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No shipments found
                    </TableCell>
                  </TableRow>
                ) : (
                  shipments.map((shipment) => (
                    <TableRow key={shipment.id}>
                      <TableCell className="font-medium">
                        {shipment.trackingNumber}
                      </TableCell>
                      <TableCell>{shipment.carrier}</TableCell>
                      <TableCell>
                        <Badge className={shipmentStatusColors[shipment.status]}>
                          {shipmentStatusLabels[shipment.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{shipment.destinationStoreId}</TableCell>
                      <TableCell>{shipment.items.length} items</TableCell>
                      <TableCell>
                        {shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Select 
                            value={shipment.status} 
                            onValueChange={(v) => handleUpdateStatus(shipment.id, v as ShipmentStatus)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(shipmentStatusLabels).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          
                          {shipment.status === 'delivered' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleCreateReceiving(shipment)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Receiving Events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Receiving Events</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivingEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No receiving events
                    </TableCell>
                  </TableRow>
                ) : (
                  receivingEvents.slice(0, 10).map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        {new Date(event.receivedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{event.storeId}</TableCell>
                      <TableCell>{event.receivedBy}</TableCell>
                      <TableCell>{event.items.length} items</TableCell>
                      <TableCell>
                        <Badge variant="outline">{event.source}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
