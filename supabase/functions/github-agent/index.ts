import { withSupabase } from "npm:@supabase/server";
import { createClient } from "npm:@supabase/supabase-js@2";

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const API = "https://api.github.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
class AgentError extends Error { constructor(message: string, public status = 400) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });
const req = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new AgentError(`${name} is required`); return v.trim(); };
const optional = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
async function gh(path: string, method = "GET", body?: unknown) {
  if (!GITHUB_TOKEN) throw new AgentError("GITHUB_TOKEN is not configured", 500);
  const r = await fetch(`${API}${path}`, { method, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "NOVA-github-agent", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new AgentError(data?.message || `GitHub request failed (${r.status})`, r.status >= 500 ? 502 : r.status);
  return data;
}
const admin = () => { if (!SERVICE_KEY) throw new AgentError("SUPABASE_SERVICE_ROLE_KEY is not configured", 500); return createClient(SUPABASE_URL, SERVICE_KEY); };
async function action(b: Record<string, unknown>, userId: string) {
  const a = req(b.action, "action");
  if (a === "enqueue_task") {
    const prompt = req(b.prompt, "prompt");
    const owner = optional(b.owner), repo = optional(b.repo), branch = optional(b.branch) || "main";
    if (owner && !/^[\w.-]+$/.test(owner) || repo && !/^[\w.-]+$/.test(repo)) throw new AgentError("Invalid owner or repo");
    const { data: task, error } = await admin().from("tasks").insert({ user_id: userId, title: String(b.title || "งานใหม่").slice(0, 160), prompt, repo_owner: owner || null, repo_name: repo || null, repo_branch: branch, status: "queued" }).select("id").single();
    if (error || !task) throw new AgentError(error?.message || "Could not create task", 500);
    const dispatchOwner = Deno.env.get("AGENT_REPO_OWNER") || "apirak272543-ship-it";
    const dispatchRepo = Deno.env.get("AGENT_REPO_NAME") || "ApserviceAI";
    await gh(`/repos/${dispatchOwner}/${dispatchRepo}/dispatches`, "POST", { event_type: "nova_task", client_payload: { task_id: task.id } });
    return { ok: true, action: a, task_id: task.id, dispatched: true };
  }
  const owner = req(b.owner, "owner"), repo = req(b.repo, "repo"), base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (a === "read_file") { const path = req(b.path, "path"); return await gh(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}${optional(b.branch) ? `?ref=${encodeURIComponent(String(b.branch))}` : ""}`); }
  if (a === "list_files") return await gh(`${base}/git/trees/${encodeURIComponent(optional(b.branch) || "main")}?recursive=1`);
  if (a === "runs") return await gh(`${base}/actions/runs?per_page=10`);
  if (a === "run_workflow") { await gh(`${base}/actions/workflows/${encodeURIComponent(req(b.workflow, "workflow"))}/dispatches`, "POST", { ref: req(b.branch, "branch"), inputs: b.inputs || {} }); return { dispatched: true }; }
  throw new AgentError(`Unsupported action: ${a}`);
}
const authenticated = withSupabase({ auth: "user" }, async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try { const body = await request.json(); const auth = request.headers.get("Authorization") || ""; const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } }); const { data: { user } } = await userClient.auth.getUser(); if (!user) throw new AgentError("Authenticated user is required", 401); return json({ data: await action(body, user.id) }); }
  catch (e) { const status = e instanceof AgentError ? e.status : 500; return json({ error: e instanceof Error ? e.message : String(e) }, status); }
});
Deno.serve((request: Request) => request.method === "OPTIONS" ? Promise.resolve(new Response("ok", { headers: CORS })) : authenticated(request));
