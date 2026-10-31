"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "./catalog";

type Agent = { id: string; name: string; referralCode: string; status: "active" | "disabled"; orderCount: number; completedOrderCount: number };
type Rule = { productKey: string; amountCents: number; updatedAt: number };
type Product = { productKey: string; name: string; priceCents: number; category: string };
type AgentData = { agents: Agent[]; rules: Rule[]; products: Product[] };
type Api = (path: string, input?: unknown) => Promise<unknown>;

function moneyCents(input: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

function RuleEditor({ product, rule, disabled, save }: { product: Product; rule?: Rule; disabled: boolean; save: (productKey: string, cents: number) => Promise<void> }) {
  const [value, setValue] = useState(rule ? formatMoney(rule.amountCents) : "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = moneyCents(value.trim());
    if (cents === null || cents > product.priceCents) { setError("请输入不超过商品售价的金额，最多两位小数。"); return; }
    setError("");
    await save(product.productKey, cents);
  }
  return <form className="wb-agent-rule" onSubmit={submit}>
    <div><strong>{product.name}</strong><span>售价 ¥{formatMoney(product.priceCents)} · {rule ? `当前佣金 ¥${formatMoney(rule.amountCents)}` : "未配置（订单暂按 0 元记录）"}</span>{rule && rule.amountCents > product.priceCents && <p className="wb-error" role="alert">当前佣金高于商品售价，请及时调整。</p>}</div>
    <div className="wb-agent-rule-input"><label htmlFor={`rule-${product.productKey}`}>每单佣金（元）</label><input id={`rule-${product.productKey}`} inputMode="decimal" value={value} placeholder="0.00" onChange={e => setValue(e.target.value)} disabled={disabled}/><button className="wb-action" disabled={disabled}>保存</button></div>
    {error && <p className="wb-error" role="alert">{error}</p>}
  </form>;
}

export function AgentManagement({ api }: { api: Api }) {
  const [data, setData] = useState<AgentData | null>(null);
  const [name, setName] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api("agents") as AgentData); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取代理信息失败"); }
  }, [api]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || password.length < 12 || password.length > 256) { setError("请输入代理名称和至少 12 位密码。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await api("agent-create", { name: name.trim(), password }) as { name: string; referralCode: string };
      setPassword(""); setName(""); setCreateOpen(false);
      setNotice(`已创建 ${created.name}。请在下方复制推广链接；代理登录账号为推广码，密码由你安全告知代理。`);
      await load();
    } catch { await load(); setError("创建结果未确认，请先检查上方代理列表，再决定是否重试。"); }
    finally { setBusy(false); }
  }
  async function toggle(agent: Agent) {
    if (busy || !window.confirm(agent.status === "active" ? `确定停用“${agent.name}”？停用后其推广链接和登录将无法使用。` : `确定启用“${agent.name}”？`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api("agent-status", { id: agent.id, status: agent.status === "active" ? "disabled" : "active" }); setNotice("代理状态已更新。"); await load(); }
    catch { await load(); setError("状态更新结果未确认，请刷新后核对。"); }
    finally { setBusy(false); }
  }
  async function saveRule(productKey: string, amountCents: number) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await api("agent-rule", { productKey, amountCents }); setNotice("佣金规则已保存，只影响之后创建的订单。"); await load(); }
    catch { await load(); setError("保存结果未确认，请核对当前佣金后再试。"); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("推广链接已复制。"); }
    catch { setError("复制失败，请手动选择并复制下方链接。"); }
  }
  const agents = data?.agents || [];
  return <section className="wb-visitors wb-agents" id="agent-management" aria-labelledby="agent-heading">
    <div className="wb-visitor-heading"><div><h2 id="agent-heading">代理管理</h2><p>管理代理、推广链接与每个商品的佣金规则。</p></div><button className="wb-action" type="button" onClick={() => void load()} disabled={busy}>刷新</button></div>
    <div className="wb-agent-explainer">佣金仅在订单创建时按规则记录；结算与提现尚未启用。拥有工作台管理权限的人均可修改这些设置。</div>
    {error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-agent-success" role="status">{notice}</p>}
    {!data && !error && <p>正在加载代理信息…</p>}
    {data && <>
      <div className="wb-agent-summary"><div><span>显示代理数</span><strong>{agents.length}</strong></div><div><span>显示启用数</span><strong>{agents.filter(a => a.status === "active").length}</strong></div><div><span>显示代理订单</span><strong>{agents.reduce((sum,a) => sum + (a.orderCount || 0), 0)}</strong></div><div><span>显示已完成</span><strong>{agents.reduce((sum,a) => sum + (a.completedOrderCount || 0), 0)}</strong></div></div>
      <p className="wb-agent-help">统计只包含当前列表中的代理，最多显示 200 位；订单数量不代表可提现金额。</p>
      <div className="wb-agent-section-title"><h3>代理列表</h3><button className="wb-primary" type="button" onClick={() => { setCreateOpen(!createOpen); setError(""); }} disabled={busy}>{createOpen ? "取消创建" : "创建代理"}</button></div>
      {createOpen && <form className="wb-agent-create" onSubmit={create}>
        <label>代理名称<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off"/></label>
        <label>设置登录密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={256} required autoComplete="new-password"/></label>
        <p>密码至少 12 位。代理登录账号为创建后显示的推广码；密码不会再次显示，请安全交给代理。</p>
        <button className="wb-primary" disabled={busy}>{busy ? "处理中…" : "确认创建"}</button>
      </form>}
      {!agents.length ? <p className="wb-agent-help">还没有代理，点击“创建代理”开始。</p> : <div className="wb-agent-list">{agents.map(agent => {
        const link = `https://musetoken.store/?ref=${encodeURIComponent(agent.referralCode)}`;
        return <article className="wb-agent-card" key={agent.id}><div className="wb-agent-card-heading"><div><strong>{agent.name}</strong><span className={agent.status === "active" ? "wb-agent-active" : "wb-agent-disabled"}>{agent.status === "active" ? "启用中" : "已停用"}</span></div><button className="wb-action" type="button" disabled={busy} onClick={() => void toggle(agent)}>{agent.status === "active" ? "停用" : "启用"}</button></div>
          <p>归属订单 {agent.orderCount || 0} 笔 · 已完成 {agent.completedOrderCount || 0} 笔</p><label>推广链接<input readOnly value={link} onFocus={e => e.currentTarget.select()}/></label><div className="wb-agent-card-actions"><button className="wb-action" type="button" onClick={() => void copy(link)}>复制推广链接</button><details><summary>查看代理登录账号</summary><code>{agent.referralCode}</code></details></div></article>;
      })}</div>}
      <div className="wb-agent-section-title"><h3>商品佣金设置</h3><span>统一规则 · 每笔订单</span></div>
      <p className="wb-agent-help">未配置的商品暂按 0 元记录；修改只影响之后的新订单，不会更改历史订单。</p>
      {!data.products?.length && <p className="wb-error" role="alert">无法获取商品列表，请刷新后重试。</p>}
      {Array.from(new Set((data.products || []).map(p => p.category))).map(category => <div className="wb-agent-category" key={category}><h4>{category}</h4>{data.products.filter(p => p.category === category).map(product => {
        const rule = data.rules.find(r => r.productKey === product.productKey);
        return <RuleEditor key={`${product.productKey}:${rule?.updatedAt ?? "new"}`} product={product} rule={rule} disabled={busy} save={saveRule}/>;
      })}</div>)}
    </>}
  </section>;
}
