import { motion } from 'framer-motion';
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

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const colorClass = typeColors[product.product_type] || typeColors.other;
  const gradient = gameGradient[product.game] || gameGradient.pokemon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3, ease: 'easeOut' }}
      className={`group relative rounded-xl border border-[var(--color-border-subtle)] bg-gradient-to-br ${gradient} p-4 hover:border-white/20 transition-all duration-200 hover:shadow-lg hover:shadow-black/20`}
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
            product.game === 'pokemon' ? 'text-[var(--color-pokemon-yellow)]' : 'text-[var(--color-onepiece-red)]'
          }`}
        >
          {product.game === 'pokemon' ? 'Pokémon' : 'One Piece'}
        </span>
        <span className="text-[10px] text-gray-500">#{product.tcgplayer_id}</span>
      </div>
    </motion.div>
  );
}
