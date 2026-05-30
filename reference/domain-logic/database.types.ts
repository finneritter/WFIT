// Minimal hand-rolled types matching supabase/migrations/0001_init.sql.
// Replace with auto-generated types via `supabase gen types typescript` once you wire that.
//
// IMPORTANT: supabase-js v2 expects the Database shape to include
// Tables / Views / Functions / Enums / CompositeTypes — even when empty —
// otherwise table/function type inference falls back to `never` / `undefined`.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      catalog_items: {
        Row: {
          slug: string;
          display_name: string;
          part_type: string;
          category: string | null;
          set_slug: string | null;
          ducats: number | null;
          is_vaulted: boolean;
          is_tradeable: boolean;
          thumbnail_url: string | null;
          updated_at: string;
        };
        Insert: {
          slug: string;
          display_name: string;
          part_type: string;
          category?: string | null;
          set_slug?: string | null;
          ducats?: number | null;
          is_vaulted?: boolean;
          is_tradeable?: boolean;
          thumbnail_url?: string | null;
          updated_at?: string;
        };
        Update: {
          slug?: string;
          display_name?: string;
          part_type?: string;
          category?: string | null;
          set_slug?: string | null;
          ducats?: number | null;
          is_vaulted?: boolean;
          is_tradeable?: boolean;
          thumbnail_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      price_cache: {
        Row: {
          slug: string;
          median_plat: number;
          trend: "up" | "flat" | "down";
          fetched_at: string;
          expires_at: string;
        };
        Insert: {
          slug: string;
          median_plat: number;
          trend: "up" | "flat" | "down";
          fetched_at?: string;
          expires_at: string;
        };
        Update: {
          slug?: string;
          median_plat?: number;
          trend?: "up" | "flat" | "down";
          fetched_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          user_id: string;
          slug: string;
          qty: number;
          first_added_at: string;
          last_modified_at: string;
          notes: string | null;
        };
        Insert: {
          user_id?: string;
          slug: string;
          qty: number;
          first_added_at?: string;
          last_modified_at?: string;
          notes?: string | null;
        };
        Update: {
          user_id?: string;
          slug?: string;
          qty?: number;
          first_added_at?: string;
          last_modified_at?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      sale_events: {
        Row: {
          id: number;
          user_id: string;
          slug: string;
          qty: number;
          plat_per_unit: number | null;
          market_median_at_sale_time: number | null;
          sold_at: string;
          notes: string | null;
        };
        Insert: {
          id?: number;
          user_id?: string;
          slug: string;
          qty: number;
          plat_per_unit?: number | null;
          market_median_at_sale_time?: number | null;
          sold_at?: string;
          notes?: string | null;
        };
        Update: {
          id?: number;
          user_id?: string;
          slug?: string;
          qty?: number;
          plat_per_unit?: number | null;
          market_median_at_sale_time?: number | null;
          sold_at?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_to_inventory: {
        Args: { p_slug: string; p_qty?: number };
        Returns: number;
      };
      record_sale: {
        Args: {
          p_slug: string;
          p_qty: number;
          p_plat_per_unit?: number | null;
          p_notes?: string | null;
        };
        Returns: number;
      };
      inventory_summary: {
        Args: Record<string, never>;
        Returns: {
          total_plat: number;
          prime_part_count: number;
          full_set_count: number;
          total_ducats: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
