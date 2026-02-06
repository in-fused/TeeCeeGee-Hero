import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { CardDashboard } from '@/sections/CardDashboard';
import { InventoryManager } from '@/sections/InventoryManager';
import { ShipmentTracker } from '@/sections/ShipmentTracker';
import { ReplenishmentPanel } from '@/sections/ReplenishmentPanel';
import { WebhookManager } from '@/sections/WebhookManager';
import { AnalyticsDashboard } from '@/sections/AnalyticsDashboard';
import { Package, Warehouse, Truck, RefreshCw, Webhook, BarChart3 } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState('cards');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <Package className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold">PackFinder Inventory Manager</h1>
                <p className="text-sm text-muted-foreground">
                  Pokémon & One Piece TCG Tracking System
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium">Real-time Sync</p>
                <p className="text-xs text-green-600">Connected</p>
              </div>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-fit">
            <TabsTrigger value="cards" className="gap-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Cards</span>
            </TabsTrigger>
            <TabsTrigger value="inventory" className="gap-2">
              <Warehouse className="h-4 w-4" />
              <span className="hidden sm:inline">Inventory</span>
            </TabsTrigger>
            <TabsTrigger value="shipments" className="gap-2">
              <Truck className="h-4 w-4" />
              <span className="hidden sm:inline">Shipments</span>
            </TabsTrigger>
            <TabsTrigger value="replenishment" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Replenish</span>
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-2">
              <Webhook className="h-4 w-4" />
              <span className="hidden sm:inline">Webhooks</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Analytics</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cards" className="space-y-4">
            <CardDashboard />
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            <InventoryManager />
          </TabsContent>

          <TabsContent value="shipments" className="space-y-4">
            <ShipmentTracker />
          </TabsContent>

          <TabsContent value="replenishment" className="space-y-4">
            <ReplenishmentPanel />
          </TabsContent>

          <TabsContent value="webhooks" className="space-y-4">
            <WebhookManager />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <AnalyticsDashboard />
          </TabsContent>
        </Tabs>
      </main>

      <Toaster position="top-right" />
    </div>
  );
}

export default App;
