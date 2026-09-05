import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const gh = async (path: string, init: RequestInit = {}) => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN is not configured in Supabase secrets");
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
};

const cleanPath = (value: string) => {
  const path = String(value || "").replace(/^\/+/, "");
  if (!path || path.includes("..")) throw new Error("Invalid repository path");
  return path;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Invalid Supabase session" }, 401);

    const body = await request.json();
    const owner = String(body.owner || "").trim();
    const repo = String(body.repo || "").trim();
    const action = String(body.action || "");
    const branch = String(body.branch || "main").trim();
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error("Invalid owner or repo");

    if (action === "read_file") {
      const result = await gh(`/repos/${owner}/${repo}/contents/${cleanPath(body.path)}?ref=${encodeURIComponent(branch)}`) as { content?: string; encoding?: string; path?: string; sha?: string };
      const content = result.encoding === "base64" && result.content ? atob(result.content.replaceAll("\n", "")) : result.content || "";
      return json({ ok: true, action, path: result.path, sha: result.sha, content });
    }

    if (action === "list_files") {
      const result = await gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`) as { tree?: Array<{ path: string; type: string; size?: number }> };
      return json({ ok: true, action, files: (result.tree || []).filter(item => item.type === "blob") });
    }

    if (action === "search_code") {
      const query = encodeURIComponent(`${String(body.query || "")} repo:${owner}/${repo}`);
      const result = await gh(`/search/code?q=${query}`);
      return json({ ok: true, action, result });
    }

    if (action === "write_file") {
      const path = cleanPath(body.path);
      const content = String(body.content ?? "");
      const message = String(body.message || `Update ${path}`);
      const existing = await gh(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`).catch(() => null) as { sha?: string } | null;
      const payload = { message, content: btoa(unescape(encodeURIComponent(content))), branch, ...(existing?.sha ? { sha: existing.sha } : {}) };
      const result = await gh(`/repos/${owner}/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify(payload) });
      return json({ ok: true, action, result });
    }

    if (action === "run_workflow") {
      const workflow = cleanPath(body.workflow);
      await gh(`/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref: branch, inputs: body.inputs || {} }),
      });
      return json({ ok: true, action, message: "Workflow dispatched" });
    }

    if (action === "runs") {
      const result = await gh(`/repos/${owner}/${repo}/actions/runs?per_page=10`);
      return json({ ok: true, action, result });
    }

    const codespaceName = String(body.codespaceName || "").trim();
    if (["codespace_status", "codespace_start", "codespace_stop"].includes(action) && !codespaceName) {
      throw new Error("codespaceName is required");
    }
    if (action === "codespace_status") {
      const result = await gh(`/user/codespaces/${encodeURIComponent(codespaceName)}`);
      return json({ ok: true, action, result });
    }
    if (action === "codespace_start" || action === "codespace_stop") {
      const operation = action === "codespace_start" ? "start" : "stop";
      const result = await gh(`/user/codespaces/${encodeURIComponent(codespaceName)}/${operation}`, { method: "POST" });
      return json({ ok: true, action, result });
    }

    return json({ error: "Unsupported action", supported: ["read_file", "list_files", "search_code", "write_file", "run_workflow", "runs", "codespace_status", "codespace_start", "codespace_stop"] }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
