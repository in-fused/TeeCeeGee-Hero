import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageTransition } from '../components/PageTransition';

export function Home() {
  const navigate = useNavigate();
  const [zip, setZip] = useState('');
  const [query, setQuery] = useState('');

  return (
    <PageTransition>
      <div className="relative overflow-hidden">
        {/* Hero gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-900/20 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-brand-500/8 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto px-4 pt-24 pb-32 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4">
              <span className="bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">
                Find Sealed TCG
              </span>
              <br />
              <span className="bg-gradient-to-r from-[var(--color-pokemon-yellow)] to-[var(--color-pokemon-blue)] bg-clip-text text-transparent">
                Products Near You
              </span>
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="text-lg text-gray-400 max-w-xl mx-auto mb-12"
          >
            Track Pokemon and One Piece sealed products at stores in your area.
            ETBs, booster boxes, tins, and more.
          </motion.p>

          {/* Search cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto"
          >
            {/* Store finder */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (zip.length === 5) navigate(`/map?zip=${zip}`);
              }}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]/80 backdrop-blur-sm p-6 text-left hover:border-white/10 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-white mb-1">Find Stores</h2>
              <p className="text-xs text-gray-400 mb-4">Locate nearby retailers by ZIP code</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  placeholder="ZIP code"
                  value={zip}
                  onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
                <button
                  type="submit"
                  disabled={zip.length !== 5}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Search
                </button>
              </div>
            </form>

            {/* Product search */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
              }}
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]/80 backdrop-blur-sm p-6 text-left hover:border-white/10 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-white mb-1">Search Products</h2>
              <p className="text-xs text-gray-400 mb-4">Browse ETBs, booster boxes, tins &amp; more</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Scarlet Violet ETB"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Search
                </button>
              </div>
            </form>
          </motion.div>

          {/* Feature pills */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="flex flex-wrap justify-center gap-3 mt-12"
          >
            {['Pokemon', 'One Piece', 'ETBs', 'Booster Boxes', 'Tins', 'Big Box Stores', 'Local Game Stores'].map(
              (tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 rounded-full text-xs font-medium text-gray-400 bg-white/5 border border-white/5"
                >
                  {tag}
                </span>
              ),
            )}
          </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}
