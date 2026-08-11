/**
 * Client-side alias for the shared Market Q&A answer-format helpers.
 * Single source of truth lives beside the edge function so the server's
 * repairs and the renderer's repairs can never drift apart.
 */
export * from '../../supabase/functions/_shared/marketQaAnswerFormat.pure.ts';
