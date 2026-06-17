// Auto-generated from Supabase (project nscomzzptpjmqlqbwsmu).
// Regenerate with: supabase gen types typescript --project-id <ref>
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      companies: { Row: { id: string; name: string; legal_name: string | null; base_currency: string; tax_number: string | null; address: string | null; phone: string | null; email: string | null; logo_url: string | null; einvoice_meta: Json | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      branches: { Row: { id: string; company_id: string; name: string; code: string | null; address: string | null; phone: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      profiles: { Row: { id: string; company_id: string | null; branch_id: string | null; full_name: string | null; phone: string | null; is_active: boolean; created_at: string }; Insert: any; Update: any; Relationships: [] };
      user_roles: { Row: { id: string; user_id: string; role: Database["public"]["Enums"]["app_role"] }; Insert: any; Update: any; Relationships: [] };
      currencies: { Row: { code: string; name: string; symbol: string | null; is_active: boolean }; Insert: any; Update: any; Relationships: [] };
      exchange_rates: { Row: { id: string; from_currency: string; to_currency: string; rate: number; rate_date: string; created_at: string }; Insert: any; Update: any; Relationships: [] };
      parties: { Row: { id: string; company_id: string; party_type: Database["public"]["Enums"]["party_type"]; name: string; code: string | null; email: string | null; phone: string | null; address: string | null; tax_number: string | null; currency: string | null; credit_limit: number | null; portal_user_id: string | null; is_active: boolean; notes: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      doc_sequences: { Row: { id: string; company_id: string; doc_type: string; prefix: string; next_number: number; padding: number }; Insert: any; Update: any; Relationships: [] };
      hotels: { Row: { id: string; company_id: string; name: string; city: Database["public"]["Enums"]["city_type"]; rating: number | null; distance_haram_m: number | null; supplier_id: string | null; address: string | null; notes: string | null; is_active: boolean; created_at: string }; Insert: any; Update: any; Relationships: [] };
      room_types: { Row: { id: string; hotel_id: string; name: string; capacity: number; created_at: string }; Insert: any; Update: any; Relationships: [] };
      seasons: { Row: { id: string; company_id: string; name: string; start_date: string; end_date: string; created_at: string }; Insert: any; Update: any; Relationships: [] };
      room_rates: { Row: { id: string; room_type_id: string; season_id: string | null; currency: string; cost_price: number; sell_price: number; valid_from: string | null; valid_to: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      allotments: { Row: { id: string; company_id: string; hotel_id: string; room_type_id: string; season_id: string | null; rooms_held: number; start_date: string; end_date: string; release_date: string | null; cost_price: number; currency: string; status: Database["public"]["Enums"]["allotment_status"]; notes: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      packages: { Row: { id: string; company_id: string; name: string; code: string | null; description: string | null; duration_days: number | null; base_currency: string; status: Database["public"]["Enums"]["package_status"]; valid_from: string | null; valid_to: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      package_items: { Row: { id: string; package_id: string; service_type: Database["public"]["Enums"]["service_type"]; description: string; supplier_id: string | null; hotel_id: string | null; room_type_id: string | null; qty: number; nights: number | null; cost_currency: string; cost_price: number; sell_currency: string; sell_price: number; sort_order: number; created_at: string }; Insert: any; Update: any; Relationships: [] };
      bookings: { Row: { id: string; company_id: string; branch_id: string | null; booking_no: string; customer_id: string; package_id: string | null; travel_date: string | null; return_date: string | null; pax_count: number; status: Database["public"]["Enums"]["booking_status"]; sell_currency: string; fx_rate: number; total_cost: number; total_sell: number; notes: string | null; created_by: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      booking_pax: { Row: { id: string; booking_id: string; full_name: string; passport_no: string | null; passport_expiry: string | null; nationality: string | null; dob: string | null; gender: string | null; visa_no: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      booking_items: { Row: { id: string; booking_id: string; service_type: Database["public"]["Enums"]["service_type"]; description: string; supplier_id: string | null; hotel_id: string | null; allotment_id: string | null; qty: number; nights: number | null; cost_currency: string; cost_price: number; sell_currency: string; sell_price: number; created_at: string }; Insert: any; Update: any; Relationships: [] };
      invoices: { Row: { id: string; company_id: string; invoice_no: string; booking_id: string | null; customer_id: string; invoice_date: string; due_date: string | null; currency: string; fx_rate: number; subtotal: number; tax_rate: number; tax_amount: number; total: number; amount_paid: number; status: Database["public"]["Enums"]["invoice_status"]; einvoice_uuid: string | null; einvoice_qr: string | null; notes: string | null; created_at: string }; Insert: any; Update: any; Relationships: [] };
      invoice_lines: { Row: { id: string; invoice_id: string; description: string; qty: number; unit_price: number; line_total: number; created_at: string }; Insert: any; Update: any; Relationships: [] };
    };
    Views: { [_ in never]: never };
    Functions: {
      auth_company_id: { Args: Record<string, never>; Returns: string };
      auth_party_id: { Args: Record<string, never>; Returns: string };
      has_role: { Args: { p_role: Database["public"]["Enums"]["app_role"] }; Returns: boolean };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      next_doc_number: { Args: { p_company: string; p_doc_type: string }; Returns: string };
    };
    Enums: {
      allotment_status: "active" | "released" | "expired";
      app_role: "admin" | "accounting" | "hr" | "sales" | "purchase" | "inventory" | "hotel_ops" | "b2b_agent";
      booking_status: "held" | "confirmed" | "traveled" | "closed" | "cancelled";
      city_type: "makkah" | "madinah" | "jeddah" | "other";
      invoice_status: "draft" | "issued" | "partially_paid" | "paid" | "void";
      package_status: "draft" | "active" | "archived";
      party_type: "customer" | "supplier" | "b2b_agent";
      service_type: "hotel" | "transport" | "visa" | "air_ticket" | "other";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
