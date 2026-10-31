"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { storeApiUrl } from "./store-api";
import "./agent-workbench.css";

type Agent = { id: string; name: string; referralCode: string };
type AgentOrder = { code: string; title: string; status: string; createdAt: number; commissionCents: number; ruleVersion: number };
const statusNames: Record<string, string> = { pending: "待付款", reported: "待核款", processing: "处理中", complete: "已完成", expired: "已过期" };

class AgentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function errorMessage(cause: unknown): string {
  return cause instanceof TypeError ? "无法连接工作台，请检查网络后重试。" : cause instanceof Error ? cause.message : "操作失败，请稍后重试";
}
async function agentRequest(path: string, body?: object): Promise<unknown> {
  const response = await fetch(storeApiUrl(path), {
    method: body ? "POST" : "GET", credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : "请求失败，请稍后重试";
    throw new AgentRequestError(message, response.status);
  }
  return result;
}

function readAgent(value: unknown): Agent {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !("name" in value) || typeof value.name !== "string" || !("referralCode" in value) || typeof value.referralCode !== "string" || !/^[a-f0-9]{32}$/.test(value.referralCode)) throw new Error("代理资料读取失败，请稍后重试");
  return { id: value.id, name: value.name, referralCode: value.referralCode };
}
function readOrders(value: unknown, agentId: string): AgentOrder[] {
  if (!value || typeof value !== "object" || !("agentId" in value) || value.agentId !== agentId || !("orders" in value) || !Array.isArray(value.orders)) throw new Error("代理账号状态已变化，请重新登录");
  if (!value.orders.every(order => order && typeof order.code === "string" && typeof order.title === "string" && typeof order.status === "string" && Number.isFinite(order.createdAt) && Number.isSafeInteger(order.commissionCents) && order.commissionCents >= 0 && Number.isSafeInteger(order.ruleVersion) && order.ruleVersion >= 0)) throw new Error("订单数据异常，请联系店主");
  return value.orders as AgentOrder[];
}

export function AgentWorkbench() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [agentResult, ordersResult] = await Promise.all([agentRequest("/api/agent/me"), agentRequest("/api/agent/orders")]);
      const current = readAgent(agentResult), nextOrders = readOrders(ordersResult, current.id);
      setAgent(current);
      setOrders(nextOrders);
    } catch (cause) { setAgent(null); setOrders([]); throw cause; }
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [agentResult, ordersResult] = await Promise.all([agentRequest("/api/agent/me"), agentRequest("/api/agent/orders")]);
        const current = readAgent(agentResult), nextOrders = readOrders(ordersResult, current.id);
        if (active) { setAgent(current); setOrders(nextOrders); }
      } catch (cause) {
        if (active && !(cause instanceof AgentRequestError && cause.status === 401)) setError(errorMessage(cause));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await agentRequest("/api/agent/login", { code: code.trim(), password });
      setPassword("");
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { await agentRequest("/api/agent/logout", {}); setAgent(null); setOrders([]); setPassword(""); setNotice(""); }
    catch (cause) {
      if (cause instanceof AgentRequestError && cause.status === 401) { setAgent(null); setOrders([]); setPassword(""); setNotice(""); }
      else setError(errorMessage(cause));
    }
    finally { setBusy(false); }
  }
  async function copyLink() {
    if (!agent) return;
    try { await navigator.clipboard.writeText(`https://musetoken.store/?ref=${agent.referralCode}`); setNotice("推广链接已复制"); }
    catch { setNotice("复制失败，请手动选择上方链接复制"); }
  }
  async function refreshOrders() {
    if (busy) return;
    setBusy(true); setError("");
    try { await refresh(); setNotice("订单已更新"); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <main className="agent-page">
    <div className="agent-shell">
      <header className="agent-header"><div><span className="agent-brand">卡密大王</span><h1>代理工作台</h1><p>推广链接与订单记录</p></div>{agent && <button type="button" className="agent-text-button" disabled={busy} onClick={() => void logout()}>退出登录</button>}</header>
      {loading ? <section className="agent-card"><p className="agent-muted">正在加载…</p></section> : !agent ? <section className="agent-card agent-login">
        <h2>登录代理工作台</h2><p className="agent-muted">请输入店主提供的代理编号和密码。</p>
        <form onSubmit={login}><label htmlFor="agent-code">代理编号</label><input id="agent-code" autoComplete="username" required value={code} onChange={event => setCode(event.target.value)} placeholder="输入代理编号" maxLength={32} />
          <label htmlFor="agent-password">登录密码</label><input id="agent-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="输入登录密码" maxLength={256} />
          {error && <p className="agent-error" role="alert">{error}</p>}<button type="submit" className="agent-primary" disabled={busy}>{busy ? "正在登录…" : "登录"}</button>
        </form>
      </section> : <>
        <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">推广中心</span><h2>你好，{agent.name}</h2></div></div>
          <p className="agent-muted">将专属链接分享给客户，通过链接进入并下单的订单会记录在这里。</p>
          <label className="agent-link-label" htmlFor="agent-link">你的推广链接</label><div className="agent-link-row"><input id="agent-link" readOnly value={`https://musetoken.store/?ref=${agent.referralCode}`} onFocus={event => event.currentTarget.select()} /><button className="agent-primary" type="button" onClick={() => void copyLink()}>复制链接</button></div>
          <p className="agent-hint">客户以后自行直接访问商店下单，订单将按自然流量处理。</p>
        </section>
        <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">订单记录</span><h2>最近订单</h2></div><button type="button" className="agent-secondary" disabled={busy} onClick={() => void refreshOrders()}>{busy ? "刷新中…" : "刷新"}</button></div>
          <p className="agent-hint">显示最近 100 笔订单；金额为下单时的佣金规则记录，当前尚未结算，实际结算以店主确认收款和完成交付为准。</p>
          {error && <p className="agent-error" role="alert">{error}</p>}{notice && <p className="agent-notice" role="status">{notice}</p>}
          {!orders.length ? <div className="agent-empty">暂无推广订单</div> : <div className="agent-orders">{orders.map((order, index) => <article className="agent-order" key={`${order.code}-${order.createdAt}-${index}`}><div><strong>{order.title}</strong><p>订单码 {order.code} · {new Date(order.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p></div><div className="agent-order-end"><span>{statusNames[order.status] || "状态待确认"}</span><b>{order.ruleVersion === 0 ? "未配置佣金" : `规则佣金 ¥${(order.commissionCents / 100).toFixed(2)}`}</b></div></article>)}</div>}
        </section>
      </>}
    </div>
  </main>;
}
