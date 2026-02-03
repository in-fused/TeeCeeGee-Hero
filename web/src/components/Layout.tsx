import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/search', label: 'Products' },
  { to: '/map', label: 'Store Map' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface)]">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[var(--color-surface)]/80 border-b border-[var(--color-border-subtle)]">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-pokemon-yellow)] to-[var(--color-pokemon-blue)] flex items-center justify-center text-sm font-bold text-gray-950 group-hover:scale-110 transition-transform">
              PF
            </div>
            <span className="text-lg font-semibold tracking-tight text-white">
              PackFinder
            </span>
          </NavLink>

          <div className="flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `relative px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute inset-0 rounded-lg bg-white/10"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--color-border-subtle)] py-6 text-center text-xs text-gray-500">
        PackFinder &mdash; TCG Sealed Product Tracker &middot; Not affiliated with Nintendo, Bandai, or
        The Pokémon Company
      </footer>
    </div>
  );
}
