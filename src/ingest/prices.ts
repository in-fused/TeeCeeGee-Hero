/**
 * Price Sync Ingestion Module
 *
 * Pulls market prices from Pokemon TCG API and One Piece TCG API,
 * stores them in price_history, and updates product.market_price.
 * Generates availability signals when significant price changes occur.
 */

import { Pool } from 'pg';
import { PokemonTCGConnector } from '../connectors/pokemon-tcg';
import { OnePieceTCGConnector } from '../connectors/onepiece-tcg';
import { logger } from '../lib/logger';

export interface PriceSyncResult {
  pokemon_prices_fetched: number;
  onepiece_prices_fetched: number;
  prices_updated: number;
  price_changes_detected: number;
  errors: number;
}

// Threshold for "significant" price change (10%)
const PRICE_CHANGE_THRESHOLD = 0.1;

export async function ingestPrices(
  pool: Pool,
  pokemonConnector: PokemonTCGConnector,
  onePieceConnector: OnePieceTCGConnector,
): Promise<PriceSyncResult> {
  const result: PriceSyncResult = {
    pokemon_prices_fetched: 0,
    onepiece_prices_fetched: 0,
    prices_updated: 0,
    price_changes_detected: 0,
    errors: 0,
  };

  // Get all products from DB that have tcgplayer_ids
  const productsResult = await pool.query(
    'SELECT id, tcgplayer_id, name, game, market_price FROM products',
  );
  const products = productsResult.rows;

  if (products.length === 0) {
    logger.info('No products found for price sync');
    return result;
  }

  // Sync Pokemon prices
  try {
    const pokemonCards = await pokemonConnector.getCards({ pageSize: 250 });
    result.pokemon_prices_fetched = pokemonCards.cards.length;

    for (const card of pokemonCards.cards) {
      if (card.marketPrice === null) continue;

      try {
        await updateProductPrice(pool, card.name, 'pokemon', card.marketPrice, card.source, result);
      } catch (err) {
        logger.error({ err, cardName: card.name }, 'Failed to update Pokemon price');
        result.errors++;
      }
    }
  } catch (err) {
    logger.error({ err }, 'Pokemon price sync failed');
    result.errors++;
  }

  // Sync One Piece prices
  try {
    const opCards = await onePieceConnector.getCards({ pageSize: 100 });
    result.onepiece_prices_fetched = opCards.cards.length;

    for (const card of opCards.cards) {
      if (card.marketPrice === null) continue;

      try {
        await updateProductPrice(
          pool,
          card.name,
          'one_piece',
          card.marketPrice,
          card.source,
          result,
        );
      } catch (err) {
        logger.error({ err, cardName: card.name }, 'Failed to update One Piece price');
        result.errors++;
      }
    }
  } catch (err) {
    logger.error({ err }, 'One Piece price sync failed');
    result.errors++;
  }

  logger.info(result, 'Price sync complete');
  return result;
}

async function updateProductPrice(
  pool: Pool,
  productName: string,
  game: string,
  newPrice: number,
  source: string,
  result: PriceSyncResult,
): Promise<void> {
  // Match product by normalized name and game
  const matchResult = await pool.query(
    `SELECT id, market_price FROM products
     WHERE game = $1 AND (
       name ILIKE $2
       OR normalized_name ILIKE $3
     )
     LIMIT 1`,
    [game, `%${productName}%`, `%${productName.toLowerCase()}%`],
  );

  if (matchResult.rows.length === 0) return;

  const product = matchResult.rows[0];
  const oldPrice = product.market_price ? parseFloat(product.market_price) : null;

  // Insert into price_history
  await pool.query(
    `INSERT INTO price_history (product_id, price, source, observed_at)
     VALUES ($1, $2, $3, NOW())`,
    [product.id, newPrice, source],
  );

  // Update product market_price
  await pool.query(
    `UPDATE products SET market_price = $1, price_updated_at = NOW() WHERE id = $2`,
    [newPrice, product.id],
  );
  result.prices_updated++;

  // Detect significant price changes and record as availability signals
  if (oldPrice !== null && oldPrice > 0) {
    const changePercent = Math.abs(newPrice - oldPrice) / oldPrice;
    if (changePercent >= PRICE_CHANGE_THRESHOLD) {
      const signalType = newPrice < oldPrice ? 'price_drop' : 'price_increase';
      await pool.query(
        `INSERT INTO availability_signals (product_id, signal_type, confidence, source, raw_data, observed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          product.id,
          signalType,
          0.9, // High confidence from API data
          source,
          JSON.stringify({
            old_price: oldPrice,
            new_price: newPrice,
            change_percent: (changePercent * 100).toFixed(1),
          }),
        ],
      );
      result.price_changes_detected++;
    }
  }
}
