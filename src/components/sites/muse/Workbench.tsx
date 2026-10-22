"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Download, LockKeyhole, LogOut, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { formatMoney, storeName } from "./catalog";
import "./workbench.css";

type AdminOrder = {
  id: string; code: string; product: "muse" | "muse-token"; title: string;
  amountCents: number; target: string; method: "wechat" | "alipay";
  status: string; createdAt: number; reportedAt: number | null; paidAt: number | null;
  reference: string | null;
};
type Result = { orders: AdminOrder[]; count: { total: number }; page: number;
  summary: { total: number; awaiting: number; processing: number; completed: number; revenueCents: number; todayCents: number } };
const labels: Record<string, string> = { pending: "待付款", reported: "待核实到账", processing: "待交付", complete: "已完成", expired: "已超时" };
function date(value: number | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(value) : "—"; }
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
async function api(path: string, input?: unknown) {
  const response = await fetch(`/api/admin/${path}`, { method: input === undefined ? "GET" : "POST", headers: input === undefined ? {} : { "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.message || "工作台连接失败，请稍后重试");
  return data;
}
export function Workbench() {
  const [auth, setAuth] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null), [query, setQuery] = useState(""), [search, setSearch] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminOrder | null>(null), [checked, setChecked] = useState(false), [reference, setReference] = useState("");
  const [delivery, setDelivery] = useState({ email: "", password: "", codeUrl: "" }), [actionError, setActionError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const data: Result = await api(`orders?q=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${page}`);
      if (current !== sequence.current) return;
      setResult(data); setAuth("ready"); setError("");
    } catch (e) {
      if (current !== sequence.current) return;
      if (e instanceof ApiError && e.status === 401) { setAuth("login"); setResult(null); setSelected(null); }
      else setError(e instanceof Error ? e.message : "连接失败，请稍后重试");
    }
  }, [search, status, page]);
  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [load]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await api("login", { password }); setPassword(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "登录失败"); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await api("logout", {}); ++sequence.current; setAuth("login"); setResult(null); }
    catch (e) { setError(e instanceof Error ? e.message : "退出失败"); }
  }
  function open(order: AdminOrder) { setSelected(order); setChecked(false); setReference(""); setDelivery({ email: "", password: "", codeUrl: "" }); setActionError(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selected || busy) return; setBusy(true); setActionError("");
    try { await api("update", { id: selected.id, action: selected.status === "processing" ? "complete" : "confirm", checked, reference, delivery }); setSelected(null); await load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    const cell = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; };
    const rows = [["订单码", "订单号", "商品", "金额", "邮箱/邀请码", "支付方式", "状态", "创建时间", "到账确认时间", "支付交易单号"], ...(result?.orders || []).map(o => [o.code, o.id, o.title, formatMoney(o.amountCents), o.target, o.method === "wechat" ? "微信" : "支付宝", labels[o.status], date(o.createdAt), date(o.paidAt), o.reference])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `订单-第${page + 1}页.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (auth !== "ready") return <main className="workbench wb-auth"><form className="wb-login" onSubmit={login}>
    <div className="wb-brand-icon"><LockKeyhole size={28}/></div><p className="wb-eyebrow">{storeName}</p><h1>店主工作台</h1><p>查看订单、核实收款、完成交付</p>
    {auth === "loading" ? <p>正在连接工作台…</p> : <><label htmlFor="admin-password">管理密码</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/><button className="wb-primary" disabled={busy}>{busy ? "登录中…" : "登录工作台"}</button></>}
    {error && <p role="alert" className="wb-error">{error}</p>}<Link href="/">返回商店 <ArrowUpRight size={14}/></Link>
  </form></main>;
  return <main className="workbench">
    <header className="wb-header"><div><p className="wb-eyebrow">{storeName} / 管理中心</p><h1>订单工作台</h1></div><nav><a href="/" target="_blank" rel="noreferrer">打开商店 <ArrowUpRight size={15}/></a><button onClick={() => void logout()}><LogOut size={15}/>退出</button></nav></header>
    <p className="wb-description">以微信、支付宝收款记录核实到账，再处理充值或账号交付。</p>
    <section className="wb-metrics" aria-label="经营数据">{[
      ["累计确认收款", `¥${formatMoney(result?.summary.revenueCents || 0)}`, "已核实到账的订单"],
      ["今日确认收款", `¥${formatMoney(result?.summary.todayCents || 0)}`, "北京时间今日"],
      ["待核实到账", result?.summary.awaiting || 0, "买家已反馈付款"],
      ["待交付", result?.summary.processing || 0, `${result?.summary.completed || 0} 笔已完成 · 共 ${result?.summary.total || 0} 笔订单`],
    ].map(([title, value, note]) => <article key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
    <section className="wb-order-section"><div className="wb-toolbar"><h2>订单列表</h2><div><button onClick={() => void load()}><RefreshCw size={15}/>刷新</button><button onClick={exportCsv} disabled={!result?.orders.length}><Download size={15}/>导出当前页</button></div></div>
      <form className="wb-filters" onSubmit={e => { e.preventDefault(); setPage(0); setSearch(query.trim()); }}><div><Search size={17}/><input aria-label="搜索订单" placeholder="订单码、订单号、邮箱或邀请码" value={query} onChange={e => setQuery(e.target.value)} maxLength={128}/></div><select aria-label="订单状态" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">全部状态</option>{Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><button className="wb-primary">查询</button></form>
      {error && <p className="wb-error" role="alert">{error}</p>}
      <div className="wb-table-scroll"><table><thead><tr><th>订单 / 商品</th><th>买家信息</th><th>金额 / 方式</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>{result?.orders.map(order => <tr key={order.id}>
        <td><strong className="wb-code">{order.code}</strong><span>{order.title}</span><small title={order.id}>{order.id}</small></td><td><small>{order.product === "muse-token" ? "账号邀请码" : "收件邮箱"}</small><span className="wb-target">{order.target}</span></td>
        <td><strong>¥{formatMoney(order.amountCents)}</strong><span>{order.method === "wechat" ? "微信" : "支付宝"}</span></td><td><span className={`wb-status is-${order.status}`}>{labels[order.status]}</span>{order.reference && <small title={order.reference}>交易号：{order.reference}</small>}</td><td><span>{date(order.createdAt)}</span>{order.paidAt && <small>核实：{date(order.paidAt)}</small>}</td>
        <td>{order.status === "complete" ? <span className="wb-done">已交付</span> : <button className="wb-action" onClick={() => open(order)}>{order.status === "processing" ? "完成交付" : "核实收款"}</button>}</td>
      </tr>)}</tbody></table></div>
      {!result?.orders.length && <div className="wb-empty"><ShoppingBagIcon/><h3>暂无匹配订单</h3><p>客户下单后，订单会自动出现在这里。</p></div>}
      <footer className="wb-pagination"><span>共 {result?.count.total || 0} 笔 · 每页 50 笔</span><div><button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}</span><button disabled={(page + 1) * 50 >= (result?.count.total || 0)} onClick={() => setPage(page + 1)}>下一页</button></div></footer>
    </section>
    {selected && <dialog ref={dialog} className="wb-dialog" onCancel={e => { if (busy) e.preventDefault(); else setSelected(null); }} aria-labelledby="wb-action-title"><button className="wb-close" aria-label="关闭" disabled={busy} onClick={() => setSelected(null)}><X size={18}/></button>
      <form onSubmit={save}><p className="wb-eyebrow">订单码 {selected.code}</p><h2 id="wb-action-title">{selected.status === "processing" ? "完成交付" : "核实收款"}</h2><p>{selected.title} · ¥{formatMoney(selected.amountCents)} · {selected.method === "wechat" ? "微信" : "支付宝"}</p><p className="wb-target">{selected.product === "muse-token" ? "账号邀请码" : "收件邮箱"}：{selected.target}</p>
        {selected.status === "processing" ? <>{selected.product === "muse" && <><label>交付账号<input required value={delivery.email} maxLength={254} onChange={e => setDelivery({ ...delivery, email: e.target.value })}/></label><label>账号密码<input required value={delivery.password} maxLength={256} onChange={e => setDelivery({ ...delivery, password: e.target.value })}/></label><label>接码链接<input required type="url" pattern="https://.*" value={delivery.codeUrl} maxLength={1000} placeholder="https://…" onChange={e => setDelivery({ ...delivery, codeUrl: e.target.value })}/></label></>}<label className="wb-check"><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)}/>{selected.product === "muse-token" ? "我已为此邀请码完成充值" : "我已核对账号资料，确认交付给买家"}</label></> : <><div className="wb-notice">打开{selected.method === "wechat" ? "微信" : "支付宝"}账单，核对金额 ¥{formatMoney(selected.amountCents)}、付款时间及备注 <b>{selected.code}</b>。</div><label>支付交易单号<input required minLength={6} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} placeholder="从收款账单中复制交易单号"/></label><label className="wb-check"><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)}/>我已核对实际到账，金额、时间与此订单匹配</label></>}
        {actionError && <p className="wb-error" role="alert">{actionError}</p>}<button className="wb-primary" disabled={!checked || busy}>{busy ? "保存中…" : selected.status === "processing" ? "确认已完成交付" : "确认到账，进入待交付"}</button>
      </form>
    </dialog>}
  </main>;
}
function ShoppingBagIcon() { return <LockKeyhole size={26}/>; }
