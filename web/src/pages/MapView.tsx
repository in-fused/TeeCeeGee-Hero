import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'framer-motion';
import { PageTransition } from '../components/PageTransition';
import { SearchInput } from '../components/SearchInput';
import { StoreCard } from '../components/StoreCard';
import { Spinner } from '../components/Spinner';
import { searchStores, searchPrices, type Store, type ScrapedListingResult } from '../lib/api';

// ── Retailer mapping ──
// Maps store names to scraper retailer IDs so we can search the right online store
const RETAILER_MATCHERS: Array<{ pattern: RegExp; retailer: string; label: string }> = [
  { pattern: /walmart/i, retailer: 'walmart', label: 'Walmart' },
  { pattern: /target/i, retailer: 'target', label: 'Target' },
  { pattern: /gamestop/i, retailer: 'gamestop', label: 'GameStop' },
  { pattern: /best\s?buy/i, retailer: 'bestbuy', label: 'Best Buy' },
  { pattern: /costco/i, retailer: 'amazon', label: 'Amazon' },
  { pattern: /sam'?s\s?club/i, retailer: 'walmart', label: 'Walmart' },
  { pattern: /cool\s?stuff/i, retailer: 'coolstuffinc', label: 'CoolStuffInc' },
  { pattern: /card\s?kingdom/i, retailer: 'cardkingdom', label: 'Card Kingdom' },
];

function storeToRetailer(storeName: string): { retailer: string; label: string } | null {
  for (const m of RETAILER_MATCHERS) {
    if (m.pattern.test(storeName)) return { retailer: m.retailer, label: m.label };
  }
  return null;
}

const RETAILER_COLORS: Record<string, string> = {
  tcgplayer: 'bg-[#1a7fbb]/30 text-[#5eb8e8]',
  ebay: 'bg-[#e53238]/30 text-[#f5af02]',
  amazon: 'bg-[#ff9900]/20 text-[#ff9900]',
  walmart: 'bg-[#0071dc]/20 text-[#74b9ff]',
  target: 'bg-[#cc0000]/20 text-[#ff6666]',
  gamestop: 'bg-[#e21e25]/20 text-[#ff7777]',
  bestbuy: 'bg-[#0046be]/20 text-[#6db3f2]',
  cardkingdom: 'bg-[#1e3a5f]/20 text-[#6db3f2]',
  coolstuffinc: 'bg-[#ff6600]/20 text-[#ff9955]',
};

// Custom marker icons
function createIcon(color: string) {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

const storeIcons: Record<string, L.DivIcon> = {
  big_box: createIcon('#3b82f6'),
  lgs: createIcon('#a855f7'),
  vending: createIcon('#22c55e'),
  unknown: createIcon('#6b7280'),
};

const RADII = [
  { value: '5', label: '5 mi' },
  { value: '15', label: '15 mi' },
  { value: '20', label: '20 mi' },
];

const STORE_TYPES = [
  { value: '', label: 'All' },
  { value: 'big_box', label: 'Big Box' },
  { value: 'lgs', label: 'Game Stores' },
  { value: 'vending', label: 'Vending' },
];

function FlyTo({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], zoom, { duration: 1.2 });
  }, [map, lat, lng, zoom]);
  return null;
}

export function MapView() {
  const [searchParams] = useSearchParams();
  const [zip, setZip] = useState(searchParams.get('zip') || '');
  const [radius, setRadius] = useState('15');
  const [storeType, setStoreType] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [storeListings, setStoreListings] = useState<ScrapedListingResult[]>([]);
  const [loadingStoreListings, setLoadingStoreListings] = useState(false);
  const [listings, setListings] = useState<ScrapedListingResult[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const doSearch = useCallback(async () => {
    if (!/^\d{5}$/.test(zip)) return;
    setLoading(true);
    setError('');
    setSelectedStore(null);
    setListings([]);
    setStoreListings([]);
    try {
      const result = await searchStores({
        zip,
        radius,
        store_type: storeType || undefined,
      });
      setStores(result.stores || []);
      if (result.center) {
        setCenter({ lat: result.center.latitude, lng: result.center.longitude });
      }

      // Fire off live price searches in background for common TCG products
      setLoadingPrices(true);
      const searches = ['pokemon etb', 'pokemon booster box', 'one piece booster box'];
      Promise.all(
        searches.map((q) =>
          searchPrices({ q, limit: '10' }).catch(() => ({ results: [] as ScrapedListingResult[], total: 0 })),
        ),
      )
        .then((responses) => {
          const all = responses.flatMap((r) => r.results || []);
          // Deduplicate by product_url
          const seen = new Set<string>();
          const unique = all.filter((l) => {
            if (!l.product_url || seen.has(l.product_url)) return false;
            seen.add(l.product_url);
            return true;
          });
          if (unique.length > 0) {
            setListings(unique.sort((a, b) => a.price - b.price));
          }
        })
        .finally(() => setLoadingPrices(false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, [zip, radius, storeType]);

  // Auto-search if ZIP comes from URL
  useEffect(() => {
    if (searchParams.get('zip')) {
      doSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStoreSelect(store: Store) {
    setSelectedStore(store);
    setStoreListings([]);
    if (mapRef.current) {
      mapRef.current.flyTo([store.latitude, store.longitude], 16, { duration: 1 });
    }

    // Search for TCG products relevant to this store's retailer
    setLoadingStoreListings(true);
    try {
      const match = storeToRetailer(store.name);
      // Search the matched retailer + tcgplayer as baseline
      const retailerParam = match?.retailer;
      const results = await searchPrices({
        q: 'pokemon sealed',
        limit: '15',
        retailer: retailerParam,
      });
      setStoreListings(results.results || []);
    } catch {
      setStoreListings([]);
    } finally {
      setLoadingStoreListings(false);
    }
  }

  function openDirections(store: Store) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`;
    window.open(url, '_blank');
  }

  return (
    <PageTransition>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <div className="lg:w-96 shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-y-auto">
          <div className="p-4 border-b border-[var(--color-border-subtle)]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doSearch();
              }}
              className="space-y-3"
            >
              <SearchInput
                icon="location"
                placeholder="Enter ZIP code"
                value={zip}
                onChange={(e) => setZip(e.currentTarget.value.replace(/\D/g, ''))}
                maxLength={5}
                inputMode="numeric"
              />

              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                  Radius
                </span>
                {RADII.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRadius(r.value)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      radius === r.value
                        ? 'bg-brand-600 text-white'
                        : 'text-gray-400 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                  Type
                </span>
                {STORE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setStoreType(t.value)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      storeType === t.value
                        ? 'bg-brand-600 text-white'
                        : 'text-gray-400 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={zip.length !== 5 || loading}
                className="w-full py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Searching...' : 'Find Stores'}
              </button>
            </form>
          </div>

          {/* Results */}
          <div className="p-4">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-4 text-xs text-red-300"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {loading && <Spinner className="py-12" />}

            {!loading && stores.length > 0 && (
              <>
                <p className="text-xs text-gray-400 mb-3">
                  <span className="text-white font-semibold">{stores.length}</span> stores within{' '}
                  {radius} miles
                </p>
                <div className="space-y-2">
                  {stores.map((store, i) => (
                    <StoreCard
                      key={store.id}
                      store={store}
                      index={i}
                      onSelect={handleStoreSelect}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Live prices loading indicator */}
            {!loading && loadingPrices && listings.length === 0 && stores.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[var(--color-border-subtle)]">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-3">
                  Live Prices &amp; Stock
                </p>
                <div className="flex items-center gap-2 py-4">
                  <Spinner />
                  <span className="text-xs text-gray-500">Fetching live prices across retailers...</span>
                </div>
              </div>
            )}

            {/* Scraped listings with real prices and stock from all retailers */}
            {!loading && listings.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[var(--color-border-subtle)]">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-3">
                  Live Prices &amp; Stock
                </p>
                <div className="space-y-2">
                  {listings.slice(0, 30).map((l) => (
                    <a
                      key={l.id || l.product_url}
                      href={l.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg bg-white/5 p-3 border border-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        {l.image_url && (
                          <img src={l.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-medium text-white truncate">{l.name}</h4>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full capitalize ${RETAILER_COLORS[l.retailer] || 'bg-gray-800 text-gray-400'}`}>
                              {l.retailer}
                            </span>
                            <span className="text-gray-600 text-[10px] capitalize">{l.game?.replace('_', ' ')}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-white">${Number(l.price).toFixed(2)}</p>
                          <span className={`inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                            l.status === 'in_stock' ? 'bg-green-500/20 text-green-300' :
                            l.status === 'preorder' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {l.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                  {listings.length > 30 && (
                    <p className="text-[10px] text-gray-500 text-center pt-1">
                      +{listings.length - 30} more listings
                    </p>
                  )}
                </div>
              </div>
            )}

            {!loading && stores.length === 0 && center && (
              <p className="text-center text-sm text-gray-500 py-12">
                No stores found in this area.
              </p>
            )}

            {!loading && !center && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-500 mb-1">Enter a ZIP code to find stores</p>
                <p className="text-xs text-gray-600">
                  We&apos;ll show TCG retailers near you with live pricing
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={[39.8283, -98.5795]}
            zoom={4}
            className="w-full h-full"
            ref={mapRef}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            />

            {center && (
              <FlyTo lat={center.lat} lng={center.lng} zoom={radius === '5' ? 13 : radius === '15' ? 11 : 10} />
            )}

            {stores.map((store) => (
              <Marker
                key={store.id}
                position={[store.latitude, store.longitude]}
                icon={storeIcons[store.store_type] || storeIcons.unknown}
                eventHandlers={{
                  click: () => handleStoreSelect(store),
                }}
              >
                <Popup>
                  <div className="min-w-[200px]">
                    <h3 className="font-semibold text-sm mb-1">{store.name}</h3>
                    {store.address && (
                      <p className="text-xs text-gray-300 mb-2">
                        {store.address}
                        {store.city && `, ${store.city}`}
                        {store.state && ` ${store.state}`}
                      </p>
                    )}
                    <p className="text-xs text-brand-400 mb-3">
                      {store.distance_miles.toFixed(1)} miles away
                    </p>
                    <button
                      onClick={() => openDirections(store)}
                      className="w-full py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors"
                    >
                      Get Directions
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Selected store overlay — shows live prices for that retailer */}
          <AnimatePresence>
            {selectedStore && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-6 left-6 right-6 lg:left-auto lg:right-6 lg:w-96 z-[1000] rounded-xl bg-[var(--color-surface-raised)]/95 backdrop-blur-xl border border-[var(--color-border-subtle)] p-4 shadow-2xl max-h-[60vh] overflow-y-auto"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-sm text-white">{selectedStore.name}</h3>
                    {selectedStore.address && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {selectedStore.address}
                        {selectedStore.city && `, ${selectedStore.city}`}
                        {selectedStore.state && ` ${selectedStore.state}`}
                      </p>
                    )}
                    <p className="text-xs text-brand-400 mt-1">
                      {selectedStore.distance_miles.toFixed(1)} mi
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedStore(null)}
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <button
                  onClick={() => openDirections(selectedStore)}
                  className="w-full mt-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors"
                >
                  Open in Google Maps
                </button>

                {/* Live TCG pricing for this retailer */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2">
                    TCG Sealed Products {storeToRetailer(selectedStore.name) ? `at ${storeToRetailer(selectedStore.name)!.label}` : ''}
                  </p>

                  {loadingStoreListings && (
                    <div className="flex items-center gap-2 py-4">
                      <Spinner />
                      <span className="text-[10px] text-gray-500">Searching live prices...</span>
                    </div>
                  )}

                  {!loadingStoreListings && storeListings.length === 0 && (
                    <p className="text-xs text-gray-500 py-3">
                      No live pricing available for this retailer yet.
                      {storeToRetailer(selectedStore.name)
                        ? ' Browser automation (Playwright) may be needed.'
                        : ' Check the Prices tab for available listings.'}
                    </p>
                  )}

                  {!loadingStoreListings && storeListings.length > 0 && (
                    <div className="space-y-2">
                      {storeListings.slice(0, 8).map((l) => (
                        <a
                          key={l.id || l.product_url}
                          href={l.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg bg-white/5 p-2.5 border border-white/5 hover:bg-white/10 transition-colors"
                        >
                          <div className="flex items-start gap-2">
                            {l.image_url && (
                              <img src={l.image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <h4 className="text-[11px] font-medium text-white truncate">{l.name}</h4>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className={`text-[8px] font-medium px-1 py-0.5 rounded-full capitalize ${RETAILER_COLORS[l.retailer] || 'bg-gray-800 text-gray-400'}`}>
                                  {l.retailer}
                                </span>
                                <span className={`text-[8px] font-medium px-1 py-0.5 rounded-full ${
                                  l.status === 'in_stock' ? 'bg-green-500/20 text-green-300' :
                                  l.status === 'preorder' ? 'bg-blue-500/20 text-blue-300' :
                                  'bg-gray-500/20 text-gray-400'
                                }`}>
                                  {l.status.replace('_', ' ')}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-white shrink-0">
                              ${Number(l.price).toFixed(2)}
                            </p>
                          </div>
                        </a>
                      ))}
                      {storeListings.length > 8 && (
                        <p className="text-[10px] text-gray-500 text-center pt-1">
                          +{storeListings.length - 8} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  );
}
