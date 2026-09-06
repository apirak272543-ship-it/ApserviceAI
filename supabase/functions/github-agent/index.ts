import { withSupabase } from "npm:@supabase/server";
import { createClient } from "npm:@supabase/supabase-js@2";

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const API = "https://api.github.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
class AgentError extends Error { constructor(message: string, public status = 400, public details: Record<string, unknown> = {}) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });
const req = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new AgentError(`${name} is required`); return v.trim(); };
const optional = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
async function gh(path: string, method = "GET", body?: unknown) {
  if (!GITHUB_TOKEN) throw new AgentError("GITHUB_TOKEN is not configured", 500);
  const r = await fetch(`${API}${path}`, { method, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "NOVA-github-agent", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const code = [401, 403, 404, 409, 422, 429].includes(r.status) ? `github_${r.status}` : r.status >= 500 ? "github_5xx" : "github_error";
    throw new AgentError(data?.message || `GitHub request failed (${r.status})`, r.status >= 500 ? 502 : r.status, {code, github_status: r.status, documentation_url: data?.documentation_url});
  }
  return data;
}
const admin = () => { if (!SERVICE_KEY) throw new AgentError("SUPABASE_SERVICE_ROLE_KEY is not configured", 500); return createClient(SUPABASE_URL, SERVICE_KEY); };
const validPart = (value: string) => /^[\w.-]+$/.test(value);
async function githubConnectionTest(owner?: string, repo?: string) {
  const checks: Record<string, unknown>[] = [];
  try { const user = await gh("/user"); checks.push({name: "token", status: "PASS", login: user.login}); }
  catch (error) { checks.push({name: "token", status: "FAIL", error: String(error)}); return {ok: false, checks}; }
  if (!owner || !repo) return {ok: true, checks: [...checks, {name: "repository_access", status: "SKIP", detail: "ไม่ได้ระบุ repository"}, {name: "contents_permission", status: "SKIP"}, {name: "actions_permission", status: "SKIP"}, {name: "repository_dispatch", status: "SKIP", detail: "ยืนยันจริงเมื่อ enqueue_task"}]};
  if (!validPart(owner) || !validPart(repo)) throw new AgentError("Invalid owner or repo", 422, {code: "invalid_repository"});
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let repository: any;
  try { repository = await gh(base); checks.push({name: "repository_access", status: "PASS", repository: repository.full_name, default_branch: repository.default_branch}); }
  catch (error) { checks.push({name: "repository_access", status: "FAIL", error: String(error)}); return {ok: false, checks}; }
  const permissions = repository.permissions || {};
  checks.push({name: "contents_permission", status: permissions.push ? "PASS" : permissions.pull ? "READ_ONLY" : "FAIL", permissions});
  checks.push({name: "actions_permission", status: permissions.push ? "PASS" : "UNKNOWN", detail: "GitHub does not expose a separate Actions write flag in this response"});
  checks.push({name: "repository_dispatch", status: permissions.push ? "READY" : "FAIL", detail: "enqueue_task will provide the definitive dispatch response"});
  return {ok: checks.every((check: any) => check.status !== "FAIL"), checks};
}
async function action(b: Record<string, unknown>, userId: string) {
  const a = req(b.action, "action");
  const requestedOwner = optional(b.owner), requestedRepo = optional(b.repo);
  if ((requestedOwner && !validPart(requestedOwner)) || (requestedRepo && !validPart(requestedRepo))) throw new AgentError("Invalid owner or repo", 422, {code: "invalid_repository"});
  if (a === "github_connection_test") return {ok: true, action: a, ...(await githubConnectionTest(requestedOwner, requestedRepo))};
  if (a === "enqueue_task") {
    const prompt = req(b.prompt, "prompt");
    const owner = requestedOwner, repo = requestedRepo, branch = optional(b.branch) || "main";
    const { data: task, error } = await admin().from("tasks").insert({ user_id: userId, title: String(b.title || "งานใหม่").slice(0, 160), prompt, repo_owner: owner || null, repo_name: repo || null, repo_branch: branch, status: "queued" }).select("id").single();
    if (error || !task) throw new AgentError(error?.message || "Could not create task", 500);
    const dispatchOwner = Deno.env.get("AGENT_REPO_OWNER") || "apirak272543-ship-it";
    const dispatchRepo = Deno.env.get("AGENT_REPO_NAME") || "ApserviceAI";
    try { await gh(`/repos/${dispatchOwner}/${dispatchRepo}/dispatches`, "POST", { event_type: "nova_task", client_payload: { task_id: task.id } }); }
    catch (error) { await admin().from("tasks").update({status: "failed", error: String(error)}).eq("id", task.id); throw error; }
    return { ok: true, action: a, task_id: task.id, dispatched: true };
  }
  const owner = req(requestedOwner, "owner"), repo = req(requestedRepo, "repo"), branch = optional(b.branch) || "main", base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (a === "read_file") { const path = req(b.path, "path"); return await gh(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}${optional(b.branch) ? `?ref=${encodeURIComponent(String(b.branch))}` : ""}`); }
  if (a === "list_files") return await gh(`${base}/git/trees/${encodeURIComponent(optional(b.branch) || "main")}?recursive=1`);
  if (a === "search_code") { const query = req(b.query, "query"); return await gh(`/search/code?q=${encodeURIComponent(`${query} repo:${owner}/${repo}`)}`); }
  if (a === "write_file") {
    const path = req(b.path, "path"), content = req(b.content, "content"), message = req(b.message, "message");
    let sha: string | undefined;
    try { sha = (await gh(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`)).sha; }
    catch (error) { if (!(error instanceof AgentError) || error.status !== 404) throw error; }
    const encoded = btoa(unescape(encodeURIComponent(content)));
    return await gh(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, "PUT", {message, content: encoded, branch, ...(sha ? {sha} : {})});
  }
  if (a === "runs") return await gh(`${base}/actions/runs?per_page=10`);
  if (a === "run_workflow") { await gh(`${base}/actions/workflows/${encodeURIComponent(req(b.workflow, "workflow"))}/dispatches`, "POST", { ref: req(b.branch, "branch"), inputs: b.inputs || {} }); return { dispatched: true }; }
  throw new AgentError(`Unsupported action: ${a}`);
}
const authenticated = withSupabase({ auth: "user" }, async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try { const body = await request.json(); const auth = request.headers.get("Authorization") || ""; const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } }); const { data: { user } } = await userClient.auth.getUser(); if (!user) throw new AgentError("Authenticated user is required", 401); return json({ data: await action(body, user.id) }); }
  catch (e) { const error = e as AgentError; const status = e instanceof AgentError ? e.status : 500; return json({ error: e instanceof Error ? e.message : String(e), code: error.details?.code, details: error.details }, status); }
});
Deno.serve((request: Request) => request.method === "OPTIONS" ? Promise.resolve(new Response("ok", { headers: CORS })) : authenticated(request));
