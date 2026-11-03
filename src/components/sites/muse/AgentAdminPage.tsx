"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { LockKeyhole, LogOut } from "lucide-react";
import { AgentManagement } from "./AgentManagement";
import { storeApiUrl } from "./store-api";
import "./workbench.css";

class AdminError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function api(path: string, input?: unknown): Promise<unknown> {
  const response = await fetch(storeApiUrl(`/api/admin/${path}`), {
    method: input === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AdminError(response.status, result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : "连接失败，请稍后重试");
  return result;
}

export function AgentAdminPage() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPayouts,setPendingPayouts]=useState(0);
  useEffect(()=>{if(state!=="ready")return;let active=true;const refresh=()=>{void api("withdrawal-count").then(value=>{if(active)setPendingPayouts((value as {count:number}).count)}).catch(()=>{});};refresh();const timer=window.setInterval(refresh,10000);return()=>{active=false;window.clearInterval(timer);};},[state]);
  useEffect(() => { let active = true; void api("agents").then(() => { if (active) setState("ready"); }).catch(cause => { if (active) { setState("login"); if (!(cause instanceof AdminError && cause.status === 401)) setError("无法连接工作台，请检查网络后重试。"); } }); return () => { active = false; }; }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await api("login", { password }); setPassword(""); await api("agents"); setState("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败，请重试"); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true); setError("");
    try { await api("logout", {}); setPassword(""); setState("login"); }
    catch (cause) { if (cause instanceof AdminError && cause.status === 401) setState("login"); else setError("退出失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  if (state !== "ready") return <main className="workbench wb-auth"><form className="wb-login" onSubmit={login}>
    <div className="wb-brand-icon"><LockKeyhole size={28}/></div><p className="wb-eyebrow">卡密大王</p><h1>代理管理</h1><p>使用店主工作台密码登录</p>
    {state === "loading" ? <p>正在连接工作台…</p> : <><label htmlFor="agent-admin-password">管理密码</label><input id="agent-admin-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/><button className="wb-primary" disabled={busy}>{busy ? "登录中…" : "登录工作台"}</button></>}
    {error && <p role="alert" className="wb-error">{error}</p>}<Link href="/admin/">返回订单工作台</Link>
  </form></main>;
  return <main className="workbench"><header className="wb-header"><div><p className="wb-eyebrow">卡密大王 / 管理中心</p><h1>代理管理</h1></div><nav><Link href="/">打开商店</Link><button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={15}/>退出</button></nav></header>
    <nav className="wb-workspace-nav" aria-label="管理工作台"><a href="/admin/">订单工作台</a><Link className="active" aria-current="page" href="/admin/agents/">代理管理{pendingPayouts>0 && <span className="wb-payout-badge">提现 {pendingPayouts}</span>}</Link></nav>
    {error && <p role="alert" className="wb-error">{error}</p>}<AgentManagement api={api}/>
  </main>;
}
