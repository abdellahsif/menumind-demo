/**
 * Database types for supabase-js, matching supabase/migrations.
 * Regenerate after schema changes with:
 *   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrderStatus = "pending" | "confirmed" | "cancelled" | "preparing" | "ready";

export type Database = {
  public: {
    Tables: {
      menu_items: {
        Row: {
          id: string;
          name: string;
          price: number;
          description: string;
          available: boolean;
          allergens: Json | null;
          ingredients: string[];
        };
        Insert: {
          id: string;
          name: string;
          price: number;
          description?: string;
          available?: boolean;
          allergens?: Json | null;
          ingredients?: string[];
        };
        Update: {
          id?: string;
          name?: string;
          price?: number;
          description?: string;
          available?: boolean;
          allergens?: Json | null;
          ingredients?: string[];
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          table_number: number;
          status: OrderStatus;
          discount_percent: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          table_number: number;
          status?: OrderStatus;
          discount_percent?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          table_number?: number;
          status?: OrderStatus;
          discount_percent?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          item_id: string;
          qty: number;
          unit_price_snapshot: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          item_id: string;
          qty: number;
          unit_price_snapshot: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          item_id?: string;
          qty?: number;
          unit_price_snapshot?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      tool_audit_log: {
        Row: {
          id: number;
          order_id: string | null;
          tool_name: string;
          input: Json;
          output: Json | null;
          created_at: string;
        };
        Insert: {
          order_id?: string | null;
          tool_name: string;
          input: Json;
          output?: Json | null;
          created_at?: string;
        };
        Update: {
          order_id?: string | null;
          tool_name?: string;
          input?: Json;
          output?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tool_audit_log_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      order_status: OrderStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
