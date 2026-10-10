-- Restore the two catalog entries required by opening-stock and pig-sale workflows.
-- This is idempotent and does not change existing business transactions.
INSERT INTO public.sakhelwe_products (name, unit, division, threshold)
VALUES
  ('Whole chickens', 'each', 'Poultry', 5),
  ('Live pigs', 'each', 'Pigs', 5)
ON CONFLICT (name) DO NOTHING;
