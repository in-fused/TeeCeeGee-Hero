import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { MapView } from './pages/MapView';
import { Scraper } from './pages/Scraper';

export function App() {
  const location = useLocation();

  return (
    <Layout>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/scraper" element={<Scraper />} />
        </Routes>
      </AnimatePresence>
    </Layout>
  );
}
