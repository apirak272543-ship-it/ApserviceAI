import json
import os
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
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

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
    result = subprocess.run(command, cwd=WORKSPACE, shell=True, capture_output=True, text=True, timeout=min(int(timeout), 600))
    return {"command": command, "exit_code": result.returncode, "stdout": result.stdout[-30000:], "stderr": result.stderr[-30000:]}


def git_command(args: list[str]):
    result = subprocess.run(["git", *args], cwd=WORKSPACE, capture_output=True, text=True, timeout=120)
    return {"args": args, "exit_code": result.returncode, "stdout": result.stdout[-30000:], "stderr": result.stderr[-30000:]}


TOOLS = [
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
    if name == "read_file": return read_file(args["path"])
    if name == "write_file": return write_file(args["path"], args["content"])
    if name == "delete_file": return delete_file(args["path"])
    if name == "search_code": return search_code(args["query"])
    if name == "run_command": return run_command(args["command"], args.get("timeout", 120))
    if name == "git_status": return git_command(["status", "--short"])
    if name == "git_diff": return git_command(["diff"])
    if name == "git_commit": return git_command(["add", "-A"]) | git_command(["commit", "-m", args["message"]])
    if name == "git_push": return git_command(["push"])
    raise ValueError(f"unknown tool: {name}")


def run_task(task: dict):
    task_id = task["id"]
    db("PATCH", f"/rest/v1/tasks?id=eq.{task_id}", {"status": "running", "started_at": "now()"}, "")
    skill_rows = db("GET", "/rest/v1/skills", params=f"?user_id=eq.{task['user_id']}&enabled=eq.true&order=created_at.asc")
    skill_text = "\n\n".join(f"SKILL: {row['name']}\n{row.get('description','')}\n{row['instructions']}" for row in (skill_rows or []))
    system_prompt = "You are a coding agent. Work directly in the workspace. Inspect before editing, make the requested changes, run relevant tests, and report what changed. Use tools when needed."
    if skill_text:
        system_prompt += "\n\nFollow these user skills when relevant:\n" + skill_text
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": task["prompt"]}]
    try:
        for _ in range(24):
            response = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, tool_choice="auto", temperature=0.1)
            message = response.choices[0].message
            messages.append(message.model_dump())
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
                db("POST", "/rest/v1/tool_calls", {"task_id": task_id, "tool_name": call.function.name, "arguments": args, "result": output, "status": status, "error": error, "completed_at": "now()"})
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(output, ensure_ascii=False)})
        raise RuntimeError("agent reached tool-call limit")
    except Exception as exc:
        db("PATCH", f"/rest/v1/tasks?id=eq.{task_id}", {"status": "failed", "error": str(exc), "completed_at": "now()"})
        stop_codespace_if_idle()


def main():
    print(f"NOVA Agent Runner workspace={WORKSPACE} model={MODEL}", flush=True)
    while True:
        tasks = db("GET", "/rest/v1/tasks", params="?status=eq.queued&order=created_at.asc&limit=1")
        if tasks:
            run_task(tasks[0])
        else:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
