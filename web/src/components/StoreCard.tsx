import { motion } from 'framer-motion';
import type { Store } from '../lib/api';

const storeTypeConfig: Record<string, { label: string; color: string; icon: string }> = {
  big_box: { label: 'Big Box', color: 'bg-blue-500/20 text-blue-300', icon: '🏬' },
  lgs: { label: 'Game Store', color: 'bg-purple-500/20 text-purple-300', icon: '🎴' },
  vending: { label: 'Vending', color: 'bg-green-500/20 text-green-300', icon: '🎰' },
  unknown: { label: 'Store', color: 'bg-gray-500/20 text-gray-300', icon: '📍' },
};

export function StoreCard({
  store,
  index,
  onSelect,
}: {
  store: Store;
  index: number;
  onSelect: (store: Store) => void;
}) {
  const config = storeTypeConfig[store.store_type] || storeTypeConfig.unknown;

  return (
    <motion.button
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      onClick={() => onSelect(store)}
      className="w-full text-left rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 hover:border-brand-500/40 hover:bg-[var(--color-surface-overlay)] transition-all duration-200 group"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl mt-0.5">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white truncate group-hover:text-brand-300 transition-colors">
              {store.name}
            </h3>
            <span
              className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${config.color}`}
            >
              {config.label}
            </span>
          </div>

          {store.address && (
            <p className="text-xs text-gray-400 truncate">
              {store.address}
              {store.city && `, ${store.city}`}
              {store.state && `, ${store.state}`}
            </p>
          )}

          <p className="text-xs text-brand-400 font-medium mt-1.5">
            {store.distance_miles.toFixed(1)} mi away
          </p>
        </div>

        <svg
          className="w-4 h-4 text-gray-500 group-hover:text-brand-400 transition-colors shrink-0 mt-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
    </motion.button>
  );
}
