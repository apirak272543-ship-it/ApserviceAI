import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import requests
from openai import OpenAI

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
WORKSPACE = Path(os.environ.get("WORKSPACE", ".")).resolve()
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "3"))
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
AUTO_STOP_CODESPACE = os.environ.get("AUTO_STOP_CODESPACE", "false").lower() == "true"
CODESPACE_NAME = os.environ.get("CODESPACE_NAME", "")
GITHUB_TOKEN = os.environ.get("GH_PAT") or os.environ.get("GITHUB_TOKEN", "")
TARGET_REPO = ""
GIT_ASKPASS = ""

headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}
client = OpenAI(api_key=GEMINI_API_KEY, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")


def db(method: str, path: str, payload: Any = None, params: str = ""):
    response = requests.request(method, f"{SUPABASE_URL}{path}{params}", headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    return response.json() if response.text else None


def github_api(path: str):
    response = requests.get(f"https://api.github.com{path}", headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {GITHUB_TOKEN}", "X-GitHub-Api-Version": "2022-11-28"}, timeout=30)
    response.raise_for_status()
    return response.json()


def list_repositories():
    if not GITHUB_TOKEN:
        raise RuntimeError("GH_PAT or GITHUB_TOKEN is required for repository discovery")
    repos = github_api("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")
    return {"repositories": [{"full_name": r["full_name"], "description": r.get("description"), "language": r.get("language"), "default_branch": r.get("default_branch")} for r in repos]}


def select_repository(owner: str, repo: str, branch: str = "main", task_id: str = "workspace"):
    global WORKSPACE, TARGET_REPO, GIT_ASKPASS
    if not GITHUB_TOKEN or not owner or not repo:
        raise RuntimeError("A GitHub token and repository owner/name are required")
    if not all(__import__("re").match(r"^[\w.-]+$", value) for value in (owner, repo, branch)):
        raise ValueError("Invalid repository or branch")
    root = Path("/tmp/nova-workspaces") / task_id
    if root.exists():
        shutil.rmtree(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    askpass = root.parent / f"askpass-{task_id}.sh"
    askpass.write_text("#!/bin/sh\ncase \"$1\" in *Username*) echo x-access-token;; *) echo \"$GITHUB_TOKEN\";; esac\n")
    askpass.chmod(0o700)
    GIT_ASKPASS = str(askpass)
    clone_url = f"https://github.com/{owner}/{repo}.git"
    clone_env = os.environ.copy()
    clone_env["GIT_ASKPASS"] = GIT_ASKPASS
    clone_env["GIT_TERMINAL_PROMPT"] = "0"
    result = subprocess.run(["git", "clone", "--branch", branch, "--single-branch", clone_url, str(root)], capture_output=True, text=True, timeout=180, env=clone_env)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    WORKSPACE = root.resolve()
    TARGET_REPO = f"{owner}/{repo}@{branch}"
    return {"selected_repository": TARGET_REPO, "workspace": str(WORKSPACE)}


def stop_codespace_if_idle():
    if not (AUTO_STOP_CODESPACE and CODESPACE_NAME and GITHUB_TOKEN):
        return
    queued = db("GET", "/rest/v1/tasks", params="?status=eq.queued&select=id&limit=1")
    if queued:
        return
    response = requests.post(
        f"https://api.github.com/user/codespaces/{CODESPACE_NAME}/stop",
        headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {GITHUB_TOKEN}", "X-GitHub-Api-Version": "2022-11-28"},
        timeout=30,
    )
    response.raise_for_status()


def safe_path(value: str) -> Path:
    path = (WORKSPACE / value).resolve()
    if path != WORKSPACE and WORKSPACE not in path.parents:
        raise ValueError("path escapes workspace")
    return path


def read_file(path: str):
    target = safe_path(path)
    return {"path": path, "content": target.read_text(errors="replace")}


def write_file(path: str, content: str):
    target = safe_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return {"path": path, "bytes": target.stat().st_size}


def delete_file(path: str):
    target = safe_path(path)
    target.unlink()
    return {"path": path, "deleted": True}


def search_code(query: str):
    result = subprocess.run(["rg", "-n", "--hidden", "--glob", "!.git", query, str(WORKSPACE)], capture_output=True, text=True, timeout=30)
    return {"matches": result.stdout[:30000], "exit_code": result.returncode}


def run_command(command: str, timeout: int = 120):
    env = os.environ.copy()
    if GIT_ASKPASS:
        env["GIT_ASKPASS"] = GIT_ASKPASS
        env["GIT_TERMINAL_PROMPT"] = "0"
    result = subprocess.run(command, cwd=WORKSPACE, shell=True, capture_output=True, text=True, timeout=min(int(timeout), 600), env=env)
    return {"command": command, "exit_code": result.returncode, "stdout": result.stdout[-30000:], "stderr": result.stderr[-30000:]}


def git_command(args: list[str]):
    env = os.environ.copy()
    if GIT_ASKPASS:
        env["GIT_ASKPASS"] = GIT_ASKPASS
        env["GIT_TERMINAL_PROMPT"] = "0"
    result = subprocess.run(["git", *args], cwd=WORKSPACE, capture_output=True, text=True, timeout=120, env=env)
    return {"args": args, "exit_code": result.returncode, "stdout": result.stdout[-30000:], "stderr": result.stderr[-30000:]}


TOOLS = [
    {"type": "function", "function": {"name": "list_repositories", "description": "List GitHub repositories the configured token can access. Use this when the task does not name a repository.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "select_repository", "description": "Clone and select the repository where this task should run. Do this before reading or editing project files.", "parameters": {"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "branch": {"type": "string"}, "task_id": {"type": "string"}}, "required": ["owner", "repo"]}}},
    {"type": "function", "function": {"name": "read_file", "description": "Read a text file in the workspace", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "write_file", "description": "Create or replace a text file in the workspace", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
    {"type": "function", "function": {"name": "delete_file", "description": "Delete a file in the workspace", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "search_code", "description": "Search code with ripgrep", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "run_command", "description": "Run a shell command in the workspace", "parameters": {"type": "object", "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}}, "required": ["command"]}}},
    {"type": "function", "function": {"name": "git_status", "description": "Show git status", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "git_diff", "description": "Show git diff", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "git_commit", "description": "Commit current changes", "parameters": {"type": "object", "properties": {"message": {"type": "string"}}, "required": ["message"]}}},
    {"type": "function", "function": {"name": "git_push", "description": "Push current branch to origin", "parameters": {"type": "object", "properties": {}}}},
]


def call_tool(name: str, args: dict):
    if name == "list_repositories": return list_repositories()
    if name == "select_repository": return select_repository(args["owner"], args["repo"], args.get("branch", "main"), args.get("task_id", "workspace"))
    if name == "read_file": return read_file(args["path"])
    if name == "write_file": return write_file(args["path"], args["content"])
    if name == "delete_file": return delete_file(args["path"])
    if name == "search_code": return search_code(args["query"])
    if name == "run_command": return run_command(args["command"], args.get("timeout", 120))
    if name == "git_status": return git_command(["status", "--short"])
    if name == "git_diff": return git_command(["diff"])
    if name == "git_commit":
        added = git_command(["add", "-A"])
        if added["exit_code"] != 0:
            return added
        return git_command(["commit", "-m", args["message"]])
    if name == "git_push": return git_command(["push"])
    raise ValueError(f"unknown tool: {name}")


def run_task(task: dict):
    task_id = task["id"]
    db("PATCH", f"/rest/v1/tasks?id=eq.{task_id}", {"status": "running", "started_at": "now()"}, "")
    skill_rows = db("GET", "/rest/v1/skills", params=f"?user_id=eq.{task['user_id']}&enabled=eq.true&order=created_at.asc")
    skill_text = "\n\n".join(f"SKILL: {row['name']}\n{row.get('description','')}\n{row['instructions']}" for row in (skill_rows or []))
    system_prompt = "You are an autonomous multi-repository coding agent. If the task names a repository, select it first. Otherwise list accessible repositories, infer the best match from the task, and select exactly one. Never edit the central runner repository unless it is explicitly selected. Inspect before editing, make requested changes, run relevant tests, and report the selected repository, changes, tests, and commit. Use tools when needed."
    if skill_text:
        system_prompt += "\n\nFollow these user skills when relevant:\n" + skill_text
    target_hint = ""
    if task.get("repo_owner") and task.get("repo_name"):
        target_hint = f"\nRepository requested by the task: {task['repo_owner']}/{task['repo_name']} (branch {task.get('repo_branch') or 'main'}). Select it before inspecting files."
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": task["prompt"] + target_hint}]
    try:
        for _ in range(24):
            response = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, tool_choice="auto", temperature=0.1)
            message = response.choices[0].message
            assistant_message = {"role": "assistant"}
            if message.content is not None:
                assistant_message["content"] = message.content
            if message.tool_calls:
                assistant_message["tool_calls"] = [call.model_dump(exclude_none=True) for call in message.tool_calls]
            messages.append(assistant_message)
            if not message.tool_calls:
                result = {"answer": message.content or "", "workspace": str(WORKSPACE)}
                db("PATCH", f"/rest/v1/tasks?id=eq.{task_id}", {"status": "completed", "result": result, "completed_at": "now()"})
                stop_codespace_if_idle()
                return
            for call in message.tool_calls:
                args = json.loads(call.function.arguments or "{}")
                started = time.time()
                try:
                    output = call_tool(call.function.name, args)
                    status, error = "completed", None
                except Exception as exc:
                    output, status, error = {"error": str(exc)}, "failed", str(exc)
                db("POST", "/rest/v1/tool_calls", {"task_id": task_id, "user_id": task["user_id"], "tool_name": call.function.name, "arguments": args, "result": output, "status": status, "error": error, "completed_at": "now()"})
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(output, ensure_ascii=False)})
        raise RuntimeError("agent reached tool-call limit")
    except Exception as exc:
        db("PATCH", f"/rest/v1/tasks?id=eq.{task_id}", {"status": "failed", "error": str(exc), "completed_at": "now()"})
        stop_codespace_if_idle()


def main():
    print(f"NOVA Agent Runner workspace={WORKSPACE} model={MODEL}", flush=True)
    if os.environ.get("RUN_ONCE", "false").lower() == "true":
        tasks = db("GET", "/rest/v1/tasks", params="?status=eq.queued&order=created_at.asc&limit=1")
        if tasks:
            run_task(tasks[0])
        else:
            print("No queued NOVA tasks", flush=True)
        return
    while True:
        tasks = db("GET", "/rest/v1/tasks", params="?status=eq.queued&order=created_at.asc&limit=1")
        if tasks:
            run_task(tasks[0])
        else:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
