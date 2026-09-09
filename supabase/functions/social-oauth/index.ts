// Supabase Edge Function: social-oauth
// Deploy: supabase functions deploy social-oauth
// Required secrets: META_APP_ID, META_APP_SECRET, TIKTOK_CLIENT_KEY,
// TIKTOK_CLIENT_SECRET, SOCIAL_TOKEN_ENCRYPTION_KEY (base64 32-byte key),
// SOCIAL_APP_URL (the public URL of index.html).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey);
const appUrl = Deno.env.get("SOCIAL_APP_URL") || "http://localhost:3000/index.html";
const enc = new TextEncoder();
const META_GRAPH_URL = "https://graph.facebook.com/v26.0";
const TIKTOK_API_URL = "https://open.tiktokapis.com/v2";

async function userFromRequest(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data } = await client.auth.getUser(token);
  return data.user || null;
}

function base64(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
function fromBase64(value: string) { const s = atob(value); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function key() { return crypto.subtle.importKey("raw", fromBase64(Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") || ""), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encrypt(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(value)); return `${base64(iv)}.${base64(new Uint8Array(data))}`; }
async function decrypt(value: string) { const [ivText, dataText] = value.split("."); const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivText) }, await key(), fromBase64(dataText)); return new TextDecoder().decode(data); }
async function sha(value: string) { const digest = await crypto.subtle.digest("SHA-256", enc.encode(value)); return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function redirectUri(provider: string) { return `${supabaseUrl}/functions/v1/social-oauth?action=callback&provider=${provider}`; }
function scopes(provider: string) { return provider === "facebook" ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement"] : ["user.info.basic", "video.publish"]; }

async function start(provider: string, userId: string) {
  if (!["facebook", "tiktok"].includes(provider)) throw new Error("Unsupported provider");
  const state = crypto.randomUUID();
  const uri = redirectUri(provider);
  const { error } = await admin.from("social_oauth_states").insert({ user_id: userId, provider, state_hash: await sha(state), redirect_uri: uri, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (error) throw error;
  const params = new URLSearchParams({ response_type: "code", state, redirect_uri: uri, scope: scopes(provider).join(",") });
  if (provider === "facebook") { params.set("client_id", Deno.env.get("META_APP_ID") || ""); return { auth_url: `https://www.facebook.com/v26.0/dialog/oauth?${params}` }; }
  params.set("client_key", Deno.env.get("TIKTOK_CLIENT_KEY") || ""); params.set("scope", scopes(provider).join(","));
  return { auth_url: `https://www.tiktok.com/v2/auth/authorize/?${params}` };
}

async function exchange(provider: string, code: string, uri: string) {
  if (provider === "facebook") {
    const p = new URLSearchParams({ client_id: Deno.env.get("META_APP_ID") || "", client_secret: Deno.env.get("META_APP_SECRET") || "", redirect_uri: uri, code });
    const token = await fetch(`${META_GRAPH_URL}/oauth/access_token?${p}`).then(r => r.json());
    if (token.error) throw new Error(token.error.message || "Meta token exchange failed");
    const pages = await fetch(`${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(token.access_token)}`).then(r => r.json());
    if (pages.error) throw new Error(pages.error.message || "Unable to list Facebook Pages");
    return (pages.data || []).map((page: any) => ({ id: page.id, name: page.name, access: page.access_token, refresh: null, expires: null, scopes: scopes(provider), metadata: { tasks: page.tasks || [] } }));
  }
  const body = new URLSearchParams({ client_key: Deno.env.get("TIKTOK_CLIENT_KEY") || "", client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET") || "", code, grant_type: "authorization_code", redirect_uri: uri });
  const token = await fetch(`${TIKTOK_API_URL}/oauth/token/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).then(r => r.json());
  if (token.error) throw new Error(token.error_description || "TikTok token exchange failed");
  return [{ id: token.open_id, name: "TikTok account", access: token.access_token, refresh: token.refresh_token, expires: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null, scopes: (token.scope || "").split(",").filter(Boolean), metadata: { refresh_expires_in: token.refresh_expires_in || null } }];
}

async function publish(provider: string, userId: string, payload: any) {
  const connectionId = String(payload.connection_id || "");
  const { data: connection, error } = await admin.from("social_connections").select("id,provider,provider_account_id,access_token_encrypted").eq("id", connectionId).eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (error || !connection) throw new Error("ไม่พบบัญชีโซเชียลที่เชื่อมต่อ");
  const token = await decrypt(connection.access_token_encrypted);
  const body = String(payload.body || "").trim();
  if (!body) throw new Error("ข้อความโพสต์ว่าง");
  if (provider === "facebook") {
    if (payload.image_base64) {
      const raw = String(payload.image_base64).replace(/^data:[^;]+;base64,/, "");
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const form = new FormData();
      form.append("source", new Blob([bytes], { type: String(payload.image_mime_type || "image/png") }), "ai-generated.png");
      form.append("message", body);
      form.append("access_token", token);
      const response = await fetch(`${META_GRAPH_URL}/${connection.provider_account_id}/photos`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || "Facebook image publish failed");
      return { provider, published: true, generated: true, external_url_required: false, id: result.id || result.post_id };
    }
    const form = new URLSearchParams({ message: body, access_token: token });
    const response = await fetch(`${META_GRAPH_URL}/${connection.provider_account_id}/feed`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error?.message || "Facebook publish failed");
    return { provider, published: true, id: result.id };
  }
  const mediaUrl = String(payload.media_url || "").trim();
  if (!mediaUrl) throw new Error("TikTok Direct Post ต้องมี Media URL ที่เข้าถึงได้จากอินเทอร์เน็ต");
  const init = await fetch(`${TIKTOK_API_URL}/post/publish/video/init/`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ post_info: { title: body, privacy_level: String(payload.privacy_level || "PUBLIC_TO_EVERYONE"), disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: mediaUrl } }) });
  const result = await init.json();
  if (!init.ok || result.error?.code !== "ok") throw new Error(result.error?.message || "TikTok publish failed");
  return { provider, published: true, publish_id: result.data?.publish_id, status: "processing" };
}

async function callback(req: Request, provider: string) {
  const url = new URL(req.url); const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
  if (!code || !state) return redirect(`${appUrl}?social_oauth=error&message=${encodeURIComponent("OAuth ไม่สมบูรณ์")}`);
  const { data: row } = await admin.from("social_oauth_states").select("id,user_id,provider,redirect_uri,expires_at").eq("state_hash", await sha(state)).eq("provider", provider).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return redirect(`${appUrl}?social_oauth=error&message=${encodeURIComponent("OAuth state หมดอายุ")}`);
  try {
    const accounts = await exchange(provider, code, row.redirect_uri);
    for (const account of accounts) await admin.from("social_connections").upsert({ user_id: row.user_id, provider, provider_account_id: account.id, display_name: account.name, access_token_encrypted: await encrypt(account.access), refresh_token_encrypted: account.refresh ? await encrypt(account.refresh) : null, token_expires_at: account.expires, scopes: account.scopes, metadata: account.metadata }, { onConflict: "user_id,provider,provider_account_id" });
    await admin.from("social_oauth_states").delete().eq("id", row.id);
    return redirect(`${appUrl}?social_oauth=success&provider=${provider}`);
  } catch (e) { return redirect(`${appUrl}?social_oauth=error&message=${encodeURIComponent(e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ")}`); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url); const action = url.searchParams.get("action") || "list"; const provider = url.searchParams.get("provider") || "";
  if (action === "callback") return callback(req, provider);
  const user = await userFromRequest(req); if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    if (action === "start") return json(await start(provider, user.id));
    if (action === "publish") return json(await publish(provider, user.id, await req.json()));
    if (action === "list") { const { data, error } = await admin.from("social_connections").select("id,provider,provider_account_id,display_name,token_expires_at,scopes,metadata,created_at,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }); if (error) throw error; return json({ data }); }
    if (action === "disconnect") { const id = url.searchParams.get("id"); const { error } = await admin.from("social_connections").delete().eq("id", id).eq("user_id", user.id); if (error) throw error; return json({ ok: true }); }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Request failed" }, 400); }
});
