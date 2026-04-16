import { MemoryRepository } from './memory-repository';
import type { Repository } from './repository';
import { SupabaseRepository } from './supabase-repository';

/**
 * Pick the right repository implementation based on environment.
 * If Supabase env vars are missing we fall back to an in-memory store so the
 * app boots in local dev / CI without any external services.
 */
export function createRepository(env: {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}): Repository {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return new MemoryRepository();
}
