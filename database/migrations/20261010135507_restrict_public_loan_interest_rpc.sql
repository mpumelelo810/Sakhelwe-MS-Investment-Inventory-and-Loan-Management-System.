-- The legacy helper has no actor or role check and is not used by the app.
-- Remove direct API execution rights so it cannot be called through the public Data API.
REVOKE EXECUTE ON FUNCTION public.sakhelwe_apply_loan_interest(uuid, integer) FROM PUBLIC, anon, authenticated;
