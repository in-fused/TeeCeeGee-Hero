# PackFinder Inventory Manager

A comprehensive tracking system for Pokémon and One Piece trading cards with real-time inventory, delivery, receiving, and replenishment management.

## 🌐 Live Demo

**Deployed URL:** https://pw3jnw6io5sq2.ok.kimi.link

## ✨ Features

### Card Management
- **Pokémon TCG Integration**: Fetches card data from Pokémon TCG API and TCGdex
- **One Piece TCG Integration**: Fetches card data from OPTCG API
- **Unified Search**: Search across both games simultaneously
- **Price Tracking**: Market price monitoring with history
- **Set Browser**: Browse cards by set/series

### Inventory Tracking
- **Real-time Stock Levels**: Track quantities across multiple stores
- **Low Stock Alerts**: Automatic notifications when inventory falls below reorder points
- **Stock Adjustments**: Manual adjustments with reason tracking
- **Condition Tracking**: Support for sealed, NM, LP, MP, HP, damaged conditions

### Delivery & Receiving
- **Shipment Tracking**: Track shipments from USPS, UPS, FedEx, DHL
- **Status Updates**: Full shipment lifecycle management
- **Receiving Events**: Process incoming inventory with discrepancy tracking
- **Pending Deliveries**: View shipments awaiting processing

### Replenishment Management
- **Auto-Suggestions**: Generate reorder suggestions based on stock levels
- **Purchase Orders**: Create and manage replenishment orders
- **Status Tracking**: Track orders from draft to received
- **Priority Levels**: High/medium/low priority based on stock urgency

### Webhook System
- **Real-time Notifications**: Subscribe to inventory events
- **Event Types**:
  - `inventory.updated` - Inventory quantity or price changes
  - `inventory.low_stock` - Items below reorder point
  - `inventory.restocked` - Items restocked
  - `shipment.created` - New shipment created
  - `shipment.updated` - Shipment status updated
  - `shipment.delivered` - Shipment delivered
  - `receiving.completed` - Receiving process completed
  - `replenishment.ordered` - New order placed
  - `replenishment.received` - Order received
  - `price.changed` - Market price changed significantly

### Analytics Dashboard
- **Inventory Metrics**: Total cards, value, low stock count
- **Game Distribution**: Visual breakdown of Pokémon vs One Piece
- **Price Analysis**: Price range distribution and trends
- **Top Sets**: Most popular sets by card count
- **Rarity Distribution**: Breakdown by card rarity

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: React hooks
- **APIs**: 
  - Pokémon TCG API
  - TCGdex API
  - OPTCG API

### Project Structure
```
src/
├── components/ui/     # shadcn/ui components
├── hooks/             # Custom React hooks
│   ├── useCards.ts    # Card data hooks
│   ├── useInventory.ts # Inventory management hooks
│   └── useWebhooks.ts  # Webhook management hooks
├── services/          # API services
│   ├── pokemonApi.ts  # Pokémon TCG API
│   ├── onePieceApi.ts # One Piece TCG API
│   ├── cardService.ts # Unified card service
│   ├── inventoryService.ts # Inventory management
│   └── webhookService.ts   # Webhook system
├── sections/          # Page sections
│   ├── CardDashboard.tsx      # Card browser
│   ├── InventoryManager.tsx   # Inventory management
│   ├── ShipmentTracker.tsx    # Delivery tracking
│   ├── ReplenishmentPanel.tsx # Reorder management
│   ├── WebhookManager.tsx     # Webhook configuration
│   └── AnalyticsDashboard.tsx # Analytics view
└── types/             # TypeScript types
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd app
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## 📡 API Integration

### Pokémon TCG API
The system integrates with the official Pokémon TCG API for comprehensive card data including:
- Card details (name, set, rarity, type)
- Images (small and large)
- Market prices from TCGplayer
- Attack data, weaknesses, resistances

### One Piece TCG API
Integration with OPTCG API provides:
- Card details (name, set, color, power)
- Card types (LEADER, CHARACTER, EVENT, STAGE, DON)
- Market pricing data
- Effect and trigger text

## 📊 Data Models

### Card
```typescript
interface Card {
  id: string;
  name: string;
  setName: string;
  game: 'pokemon' | 'one_piece';
  rarity?: string;
  imageUrl?: string;
  marketPrice?: number;
  // ... additional fields
}
```

### Inventory Item
```typescript
interface InventoryItem {
  id: string;
  cardId: string;
  cardName?: string;
  storeId: string;
  quantity: number;
  condition: 'sealed' | 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';
  price: number;
  // ... additional fields
}
```

### Shipment
```typescript
interface Shipment {
  id: string;
  carrier: 'USPS' | 'UPS' | 'FedEx' | 'DHL' | 'other';
  trackingNumber: string;
  status: ShipmentStatus;
  items: ShipmentItem[];
  // ... additional fields
}
```

## 🔗 Webhook Integration

To receive real-time updates, create a webhook subscription:

```typescript
// Example webhook payload for inventory.updated
{
  "eventType": "inventory.updated",
  "payload": {
    "cardId": "card-123",
    "cardName": "Pikachu",
    "storeId": "store-1",
    "quantity": 10,
    "price": 5.99,
    "game": "pokemon"
  },
  "timestamp": "2026-02-04T12:00:00Z",
  "signature": "sha256=..."
}
```

## 📝 License

This project is not affiliated with Nintendo, Bandai, The Pokémon Company, or any other trademark holders. All card data and images are property of their respective owners.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For support, please open an issue in the GitHub repository.
