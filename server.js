const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const db = new Database('tcg_hero.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Haversine formula to calculate distance (replaces PostGIS for MVP)
function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Radius of earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS zip_codes (
    zip TEXT PRIMARY KEY,
    city TEXT,
    state TEXT,
    lat REAL,
    lng REAL
  );
  
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    brand TEXT,
    type TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    lat REAL,
    lng REAL,
    phone TEXT
  );
`);

// Seed data endpoint (mini version with just major cities first)
app.get('/api/seed-demo-data', (req, res) => {
  const zips = [
    ['90210', 'Beverly Hills', 'CA', 34.0901, -118.4065],
    ['10001', 'New York', 'NY', 40.7506, -73.9934],
    ['60611', 'Chicago', 'IL', 41.8906, -87.6243],
    ['75201', 'Dallas', 'TX', 32.7883, -96.7994],
    ['98101', 'Seattle', 'WA', 47.6101, -122.3335]
  ];
  
  const insertZip = db.prepare('INSERT OR IGNORE INTO zip_codes VALUES (?, ?, ?, ?, ?)');
  zips.forEach(z => insertZip.run(z));

  const stores = [
    ['Target - Beverly Hills', 'Target', 'BIG_BOX', '8500 Beverly Blvd', 'Beverly Hills', 'CA', '90210', 34.0837, -118.3973, '(310) 555-0100'],
    ['GameStop - Rodeo', 'GameStop', 'LOCAL_GAME_STORE', '200 N Rodeo Dr', 'Beverly Hills', 'CA', '90210', 34.0675, -118.4004, '(310) 555-0200'],
    ['NYC Card Kingdom', 'Independent', 'LOCAL_GAME_STORE', '123 Main St', 'New York', 'NY', '10001', 40.7484, -73.9967, '(212) 555-0300'],
    ['Dallas Collectibles', 'Independent', 'LOCAL_GAME_STORE', '500 Commerce St', 'Dallas', 'TX', '75201', 32.7792, -96.7953, '(214) 555-0400']
  ];
  
  const insertStore = db.prepare('INSERT OR IGNORE INTO stores (name, brand, type, address, city, state, zip, lat, lng, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stores.forEach(s => insertStore.run(s));
  
  res.json({ message: 'Demo data loaded', zips: zips.length, stores: stores.length });
});

// THE CORE FEATURE: Zip radius search
app.get('/api/stores/nearby', (req, res) => {
  const { zip, radius = 5 } = req.query;
  
  if (!zip) return res.status(400).json({ error: 'Zip code required' });
  
  // Look up ZIP coordinates
  const zipData = db.prepare('SELECT * FROM zip_codes WHERE zip = ?').get(zip);
  if (!zipData) return res.status(404).json({ error: 'ZIP code not in database (use demo data first)' });
  
  // Get all stores and calculate distance in JavaScript
  const stores = db.prepare('SELECT * FROM stores').all();
  const nearby = stores.map(store => {
    const dist = getDistanceMiles(zipData.lat, zipData.lng, store.lat, store.lng);
    return { ...store, distance_miles: dist.toFixed(2) };
  }).filter(store => parseFloat(store.distance_miles) <= parseInt(radius))
    .sort((a, b) => parseFloat(a.distance_miles) - parseFloat(b.distance_miles));
  
  res.json({
    center: { lat: zipData.lat, lng: zipData.lng },
    stores: nearby,
    count: nearby.length
  });
});

// Get all stores (for map)
app.get('/api/stores', (req, res) => {
  const stores = db.prepare('SELECT * FROM stores').all();
  res.json(stores);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TCG Hero running on port ${PORT}`);
  console.log(`Visit: http://localhost:${PORT}`);
});
