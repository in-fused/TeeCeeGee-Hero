import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PageTransition } from '../components/PageTransition';
import { Spinner } from '../components/Spinner';
import {
  scraperStatus,
  scraperSearch,
  scraperListings,
  scraperJobs,
  scraperChanges,
  type ScraperStatusResponse,
  type ScraperListing,
  type ScrapingJobResponse,
  type InventoryChangeResponse,
} from '../lib/scraper-api';

const PASSWORD = 'PackFinder';

export function Scraper() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handleLogin = () => {
    if (passwordInput === PASSWORD) {
      setAuthenticated(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  if (!authenticated) {
    return (
      <PageTransition>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="bg-[var(--color-surface-raised)] rounded-2xl p-8 border border-[var(--color-border-subtle)] w-full max-w-sm">
            <h2 className="text-xl font-semibold text-white mb-1">Scraper Dashboard</h2>
            <p className="text-sm text-gray-400 mb-6">Enter password to access</p>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Password"
              className="w-full px-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 mb-3"
            />
            {passwordError && (
              <p className="text-red-400 text-xs mb-3">Incorrect password (case-sensitive)</p>
            )}
            <button
              onClick={handleLogin}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors"
            >
              Access
            </button>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Scraper Dashboard</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StatusPanel />
          <SearchPanel />
          <ListingsPanel />
          <JobsPanel />
          <ChangesPanel />
        </div>
      </div>
    </PageTransition>
  );
}

function StatusPanel() {
  const [data, setData] = useState<ScraperStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    scraperStatus().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <Card title="Status">
      {loading ? <Spinner /> : !data ? (
        <p className="text-gray-500 text-sm">Could not load status. Ensure ADMIN_SECRET is set and the scraper migration has been applied.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-gray-300">
            <span>Active Listings</span>
            <span className="text-white font-medium">{data.database.activeListings}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>Total Listings</span>
            <span className="text-white font-medium">{data.database.totalListings}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>Recent Changes (24h)</span>
            <span className="text-white font-medium">{data.database.recentChanges}</span>
          </div>
          {data.database.byRetailer.length > 0 && (
            <div className="pt-2 border-t border-[var(--color-border-subtle)]">
              <p className="text-gray-400 text-xs uppercase mb-2">By Retailer</p>
              {data.database.byRetailer.map((r) => (
                <div key={r.retailer} className="flex justify-between text-gray-300">
                  <span className="capitalize">{r.retailer}</span>
                  <span>{r.count}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pt-2 border-t border-[var(--color-border-subtle)]">
            <p className="text-gray-400 text-xs uppercase mb-2">Scrapers</p>
            {data.scrapers.map((s) => (
              <div key={s.name} className="flex justify-between text-gray-300">
                <span className="capitalize">{s.name}</span>
                <span>{s.requestCount} reqs</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScraperListing[]>([]);
  const [errors, setErrors] = useState<Array<{ retailer: string; error: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await scraperSearch(query);
      setResults(data.results);
      setErrors(data.errors || []);
    } catch {
      setResults([]);
      setErrors([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <Card title="Live Search (across retailers)">
      <div className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="e.g. Charizard ETB, Scarlet & Violet booster box..."
          className="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-brand-500"
        />
        <button
          onClick={doSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>
      {loading && <Spinner />}
      {!loading && searched && results.length === 0 && (
        <p className="text-gray-500 text-sm">No results found. Currently active sources: TCGplayer, eBay. Other retailers (Amazon, Walmart, Target, GameStop, Best Buy) require browser automation setup.</p>
      )}
      {errors.length > 0 && (
        <div className="mb-3 text-[10px] text-yellow-400/70">
          {errors.map((e, i) => (
            <span key={i} className="capitalize">{e.retailer}: {e.error}{i < errors.length - 1 ? ' | ' : ''}</span>
          ))}
        </div>
      )}
      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
              {r.imageUrl && (
                <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{r.name}</p>
                <p className="text-gray-500 text-xs capitalize">{r.retailer} &middot; {r.game} &middot; {r.status.replace('_', ' ')}</p>
              </div>
              <div className="text-right">
                <p className="text-white text-sm font-medium">${r.price.toFixed(2)}</p>
                {r.productUrl && (
                  <a href={r.productUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 text-xs hover:underline">
                    View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ListingsPanel() {
  const [listings, setListings] = useState<ScraperListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    scraperListings({ limit: '20' })
      .then((d) => { setListings(d.listings); setTotal(d.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card title={`Stored Listings (${total})`}>
      {loading ? <Spinner /> : listings.length === 0 ? (
        <p className="text-gray-500 text-sm">No listings stored yet. Use the search or scrape a set to populate data.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {listings.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{l.name}</p>
                <p className="text-gray-500 text-xs capitalize">{l.retailer} &middot; {l.game} &middot; {l.status.replace('_', ' ')}</p>
              </div>
              <p className="text-white text-sm font-medium">${Number(l.price).toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function JobsPanel() {
  const [jobs, setJobs] = useState<ScrapingJobResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    scraperJobs().then(setJobs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <Card title="Scraping Jobs">
      {loading ? <Spinner /> : jobs.length === 0 ? (
        <p className="text-gray-500 text-sm">No scraping jobs yet</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {jobs.map((j) => (
            <div key={j.id} className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
              <div className="flex justify-between items-center">
                <p className="text-white text-sm">{j.name}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  j.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                  j.status === 'running' ? 'bg-blue-900/50 text-blue-400' :
                  j.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {j.status}
                </span>
              </div>
              <p className="text-gray-500 text-xs mt-1">
                {j.successful_scrapes}/{j.processed_urls} scraped &middot; {j.new_listings} new
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangesPanel() {
  const [changes, setChanges] = useState<InventoryChangeResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    scraperChanges().then(setChanges).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <Card title="Recent Changes">
      {loading ? <Spinner /> : changes.length === 0 ? (
        <p className="text-gray-500 text-sm">No recent changes detected</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {changes.map((c) => (
            <div key={c.id} className="p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
              <div className="flex justify-between items-center">
                <p className="text-white text-sm truncate">{c.name}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  c.change_type === 'price_change' ? 'bg-yellow-900/50 text-yellow-400' :
                  c.change_type === 'status_change' ? 'bg-purple-900/50 text-purple-400' :
                  'bg-cyan-900/50 text-cyan-400'
                }`}>
                  {c.change_type.replace('_', ' ')}
                </span>
              </div>
              <p className="text-gray-500 text-xs mt-1">
                {c.retailer} &middot; {new Date(c.detected_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--color-surface-raised)] rounded-xl p-5 border border-[var(--color-border-subtle)]"
    >
      <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">{title}</h3>
      {children}
    </motion.div>
  );
}
