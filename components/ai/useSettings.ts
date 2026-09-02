"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VoiceLang } from "@/lib/ai/voice";

// Per-user assistant preferences, stored in ai_settings. RLS is own-row, so
// this reads and writes straight through the browser client like the rest of
// the ERP's client screens do.
//
// The defaults matter: voice OUTPUT is off until the user turns it on. An ERP
// that starts talking the first time you open a screen is a bad neighbour in
// an open office.

export interface AiSettings {
  voice_input: boolean;
  voice_output: boolean;
  hands_free: boolean;
  language: VoiceLang;
}

export const DEFAULT_SETTINGS: AiSettings = {
  voice_input: true,
  voice_output: false,
  hands_free: false,
  language: "en-US",
};

export function useSettings() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const { data } = await sb
          .from("ai_settings")
          .select("voice_input, voice_output, hands_free, language")
          .eq("user_id", user.id)
          .maybeSingle();
        if (alive && data) setSettings({ ...DEFAULT_SETTINGS, ...(data as any) });
      } catch {
        // No row, or the table isn't there yet — the defaults are fine.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Optimistic: the toggle moves now, the write catches up. A failed write
  // must not leave a switch that looks on and behaves off, so it rolls back.
  const update = useCallback(async (patch: Partial<AiSettings>) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { error } = await sb
        .from("ai_settings")
        .upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() });
      if (error) throw error;
    } catch (e) {
      console.error("[vista-ai] could not save settings", e);
      setSettings(previous);
    }
  }, [settings]);

  return { settings, update, loaded };
}
