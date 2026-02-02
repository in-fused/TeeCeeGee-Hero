import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'db', 'migrations', '001_initial_schema.sql');

describe('Database schema validation', () => {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  it('should enable PostGIS extension', () => {
    expect(schema).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
  });

  it('should define store_type enum with required categories', () => {
    expect(schema).toContain("'big_box'");
    expect(schema).toContain("'lgs'");
    expect(schema).toContain("'vending'");
  });

  it('should define game_type enum for pokemon and one_piece', () => {
    expect(schema).toContain("'pokemon'");
    expect(schema).toContain("'one_piece'");
  });

  it('should define language_type enum', () => {
    expect(schema).toContain("'ENG'");
    expect(schema).toContain("'JPN'");
  });

  it('should define product_type enum with TCG product types', () => {
    expect(schema).toContain("'etb'");
    expect(schema).toContain("'booster_box'");
    expect(schema).toContain("'booster_pack'");
  });

  it('should create all required tables', () => {
    const tables = [
      'zip_centroids',
      'stores',
      'products',
      'skus',
      'availability_signals',
      'shipments',
      'restock_events',
      'connector_health',
    ];
    for (const table of tables) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('should use geography type for spatial columns', () => {
    expect(schema).toContain('GEOGRAPHY(POINT, 4326)');
  });

  it('should create GIST indexes for spatial queries', () => {
    expect(schema).toContain('USING GIST(location)');
  });

  it('should have osm_id unique constraint on stores', () => {
    expect(schema).toContain('osm_id BIGINT UNIQUE');
  });

  it('should have confidence check constraints on signals', () => {
    expect(schema).toContain('confidence >= 0 AND confidence <= 1');
  });

  it('should track connector health with explicit status', () => {
    expect(schema).toContain('connector_name TEXT UNIQUE NOT NULL');
    expect(schema).toContain('last_success_at');
    expect(schema).toContain('last_failure_at');
    expect(schema).toContain('last_error');
  });
});
