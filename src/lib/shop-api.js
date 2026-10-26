// @ts-nocheck
import { supabase } from "./supabase.js";
import { emptyShop, cleanShop } from "./shop.js";
export async function fetchShopping(userId) {
  if (!supabase)
    return {
      content: cleanShop(JSON.parse(localStorage.getItem(`mm.shop.demo:${userId}`) || "null")),
      revision: 0,
    };
  const { data, error } = await supabase
    .from("shopping_state")
    .select("content,revision,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || { content: emptyShop(), revision: 0 };
}
export async function saveShopping(userId, content, revision) {
  if (!supabase) {
    localStorage.setItem(`mm.shop.demo:${userId}`, JSON.stringify(content));
    return { content, revision: 0 };
  }
  const { data, error } = await supabase.rpc("save_shopping_state", {
    p_content: content,
    p_expected_revision: revision,
  });
  if (error) throw error;
  if (!data?.[0]) throw new Error("Shopping changes were not saved.");
  return data[0];
}
