import { motion } from 'framer-motion';

interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function FilterChip({ label, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? 'text-white' : 'text-gray-400 hover:text-white bg-white/5 hover:bg-white/10'
      }`}
    >
      {active && (
        <motion.div
          layoutId="filter-chip"
          className="absolute inset-0 rounded-full bg-brand-600"
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        />
      )}
      <span className="relative z-10">{label}</span>
    </button>
  );
}
