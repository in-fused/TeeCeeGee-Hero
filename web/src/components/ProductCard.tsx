import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Product } from '../lib/api';

const typeColors: Record<string, string> = {
  etb: 'bg-purple-500/20 text-purple-300',
  booster_box: 'bg-blue-500/20 text-blue-300',
  booster_pack: 'bg-cyan-500/20 text-cyan-300',
  blister: 'bg-green-500/20 text-green-300',
  collection_box: 'bg-amber-500/20 text-amber-300',
  tin: 'bg-rose-500/20 text-rose-300',
  bundle: 'bg-orange-500/20 text-orange-300',
  other: 'bg-gray-500/20 text-gray-300',
};

const gameGradient: Record<string, string> = {
  pokemon: 'from-[var(--color-pokemon-yellow)]/10 to-[var(--color-pokemon-blue)]/10',
  one_piece: 'from-[var(--color-onepiece-red)]/10 to-red-900/10',
};

function formatType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildMarketplaceLinks(product: Product) {
  return {
    tcgplayer: `https://www.tcgplayer.com/product/${product.tcgplayer_id}`,
    ebay_search: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product.name)}&_sacat=0`,
  };
}

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = typeColors[product.product_type] || typeColors.other;
  const gradient = gameGradient[product.game] || gameGradient.pokemon;
  const links = buildMarketplaceLinks(product);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3, ease: 'easeOut' }}
      className={`group relative rounded-xl border border-[var(--color-border-subtle)] bg-gradient-to-br ${gradient} hover:border-white/20 transition-all duration-200 hover:shadow-lg hover:shadow-black/20`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
          >
            {formatType(product.product_type)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            {product.language}
          </span>
        </div>

        <h3 className="text-sm font-semibold text-white leading-snug mb-2 line-clamp-2 group-hover:text-brand-300 transition-colors">
          {product.name}
        </h3>

        {product.set_name && (
          <p className="text-xs text-gray-400 mb-3 truncate">{product.set_name}</p>
        )}

        <div className="flex items-center justify-between">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider ${
              product.game === 'pokemon'
                ? 'text-[var(--color-pokemon-yellow)]'
                : 'text-[var(--color-onepiece-red)]'
            }`}
          >
            {product.game === 'pokemon' ? 'Pokémon' : 'One Piece'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">#{product.tcgplayer_id}</span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded marketplace links */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-white/10">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mt-3 mb-2">
                Buy Online
              </p>
              <div className="flex flex-col gap-2">
                <a
                  href={links.tcgplayer}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a7fbb]/20 hover:bg-[#1a7fbb]/30 border border-[#1a7fbb]/30 transition-colors group/link"
                >
                  <span className="text-sm">🃏</span>
                  <span className="text-xs font-medium text-[#5eb8e8] group-hover/link:text-white transition-colors">
                    TCGplayer
                  </span>
                  <svg
                    className="w-3 h-3 ml-auto text-gray-500 group-hover/link:text-white transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
                <a
                  href={links.ebay_search}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#e53238]/20 hover:bg-[#e53238]/30 border border-[#e53238]/30 transition-colors group/link"
                >
                  <span className="text-sm">🛒</span>
                  <span className="text-xs font-medium text-[#f5af02] group-hover/link:text-white transition-colors">
                    eBay Search
                  </span>
                  <svg
                    className="w-3 h-3 ml-auto text-gray-500 group-hover/link:text-white transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
