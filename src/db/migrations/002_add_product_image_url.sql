-- Add image_url column to products table for TCGPlayer product images
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
