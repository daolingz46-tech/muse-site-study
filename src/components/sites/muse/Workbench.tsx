"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Download, LockKeyhole, LogOut, RefreshCw, Search, X, Bell, Volume2 } from "lucide-react";
import Link from "next/link";
import { formatMoney, storeName } from "./catalog";
import { storeApiUrl } from "./store-api";
import "./workbench.css";

type AdminOrder = {
  id: string; code: string; product: "muse" | "muse-token"; title: string;
  amountCents: number; target: string; method: "wechat" | "alipay";
  status: string; createdAt: number; reportedAt: number | null;
  reference: string | null;
};
type Result = { orders: AdminOrder[]; count: { total: number }; page: number;
  summary: { total: number; awaiting: number; processing: number; completed: number; revenueCents: number; todayCents: number } };
type Visit = { id: string; page: string; source: string; device: string; createdAt: number };
type VisitResult = { summary: { total: number; today: number; last7Days: number }; recent: Visit[] };
const labels: Record<string, string> = { pending: "待付款", reported: "待核实到账", processing: "待交付", complete: "已完成", expired: "已超时" };
const visitSourceLabels: Record<string, string> = { direct: "直接访问", wechat: "微信", search: "搜索引擎", social: "社交平台", external: "其他网站" };
const visitDeviceLabels: Record<string, string> = { mobile: "手机", tablet: "平板", desktop: "电脑" };
function date(value: number | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(value) : "—"; }
function pushKeyBytes(key: string) {
  const decoded = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
async function api(path: string, input?: unknown) {
  const response = await fetch(storeApiUrl(`/api/admin/${path}`), { method: input === undefined ? "GET" : "POST", headers: input === undefined ? {} : { "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input), credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) });
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
  const [alert, setAlert] = useState(""), [desktopAlerts, setDesktopAlerts] = useState(false), [soundEnabled, setSoundEnabled] = useState(false);
  const [visits, setVisits] = useState<VisitResult | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [emailTestBusy, setEmailTestBusy] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0);
  const knownOrders = useRef<Map<string, string> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const playDing = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(1175, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.37);
  }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const data: Result = await api(`orders?q=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${page}`);
      if (current !== sequence.current) return;
      if (!search && !status && page === 0 && knownOrders.current === null) knownOrders.current = new Map(data.orders.map(order => [order.id, order.status]));
      setResult(data); setAuth("ready"); setError("");
    } catch (e) {
      if (current !== sequence.current) return;
      if (e instanceof ApiError && e.status === 401) { setAuth("login"); setResult(null); setSelected(null); }
      else setError(e instanceof Error ? e.message : "连接失败，请稍后重试");
    }
  }, [search, status, page]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void load(); };
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    if (auth !== "ready") return;
    let active = true;
    const checkOrders = async () => {
      try {
        const data: Result = await api("orders?page=0");
        if (!active) return;
        const current = new Map(data.orders.map(order => [order.id, order.status]));
        if (knownOrders.current === null) { knownOrders.current = current; return; }
        const fresh = data.orders.filter(order => !knownOrders.current?.has(order.id));
        const newlyReported = data.orders.filter(order => order.status === "reported" && knownOrders.current?.has(order.id) && knownOrders.current.get(order.id) !== "reported");
        knownOrders.current = current;
        if (fresh.length || newlyReported.length) {
          const message = fresh.length === 1 ? `新订单 ${fresh[0].code}${fresh[0].status === "reported" ? " 已反馈付款，请核实" : "，请留意付款"}`
            : fresh.length > 1 ? `收到 ${fresh.length} 笔新订单，请查看工作台`
            : newlyReported.length === 1 ? `订单 ${newlyReported[0].code} 已反馈付款，请核实`
            : `有 ${newlyReported.length} 笔订单已反馈付款，请核实`;
          setAlert(message);
          playDing();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification("Muse 商店订单提醒", { body: message, tag: (fresh[0] || newlyReported[0]).id }); } catch { /* iPhone uses service worker push notifications. */ }
          }
          void load();
        }
      } catch { /* 主订单列表会显示连接错误；下一轮继续检查。 */ }
    };
    void checkOrders();
    const timer = window.setInterval(() => { if (!document.hidden) void checkOrders(); }, 5000);
    const visible = () => { if (!document.hidden) void checkOrders(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [auth, load, playDing]);
  useEffect(() => {
    if (auth !== "ready") return;
    let active = true;
    const refreshVisits = async () => { try { const data: VisitResult = await api("visits"); if (active) setVisits(data); } catch { /* 下一轮自动重试 */ } };
    void refreshVisits();
    const timer = window.setInterval(() => void refreshVisits(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [auth]);
  useEffect(() => {
    if (auth !== "ready") return;
    let active = true;
    void api("email-status").then((data: { configured: boolean }) => { if (active) setEmailConfigured(data.configured); }).catch(() => {});
    return () => { active = false; };
  }, [auth]);
  useEffect(() => {
    if (auth !== "ready" || window.location.origin !== "https://musetoken.store" || !("serviceWorker" in navigator)) return;
    let active = true;
    void navigator.serviceWorker.getRegistration("/admin/").then(registration => registration?.pushManager.getSubscription()).then(subscription => {
      if (!active || !subscription) return;
      setPushEndpoint(subscription.endpoint);
      void api("push-subscribe", { subscription: subscription.toJSON() }).catch(() => {});
    }).catch(() => {});
    return () => { active = false; };
  }, [auth]);
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
  async function enableDesktopAlerts() {
    if (typeof Notification === "undefined") { setAlert("当前浏览器不支持桌面通知，请保持工作台页面打开"); return; }
    const permission = await Notification.requestPermission();
    setDesktopAlerts(permission === "granted");
    setAlert(permission === "granted" ? "桌面提醒已开启；新付款核实申请会弹出通知" : "浏览器未允许通知；页面内仍会显示新订单提醒");
  }
  async function enableSound() {
    if (typeof AudioContext === "undefined") { setAlert("当前浏览器不支持工作台提示音"); return; }
    try {
      audioContext.current ||= new AudioContext();
      await audioContext.current.resume();
      if (audioContext.current.state !== "running") throw new Error("audio_suspended");
      setSoundEnabled(true);
      playDing();
      setAlert("订单叮声已开启；工作台保持打开时，新订单和付款反馈会响铃");
    } catch { setSoundEnabled(false); setAlert("声音未开启，请检查手机静音设置并再次轻点按钮"); }
  }
  async function enablePhonePush() {
    if (pushBusy) return;
    if (pushEndpoint) {
      setPushBusy(true);
      try { await api("push-test", { endpoint: pushEndpoint }); setAlert("测试推送已发送，请查看手机通知"); }
      catch (cause) { setAlert(cause instanceof Error ? cause.message : "测试推送失败"); }
      finally { setPushBusy(false); }
      return;
    }
    if (window.location.origin !== "https://musetoken.store" || !("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setAlert("iPhone 请用 Safari 打开 musetoken.store/admin/，分享并添加到主屏幕，再从桌面图标开启推送");
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setAlert("请在 iPhone 设置中允许 Muse 工作台发送通知"); return; }
      const { publicKey } = await api("push-key") as { publicKey: string };
      await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(publicKey) });
      await api("push-subscribe", { subscription: subscription.toJSON() });
      setPushEndpoint(subscription.endpoint);
      setAlert("手机推送已开启。锁屏或关闭工作台后，新订单也会发送系统通知；点此按钮可测试。");
    } catch (cause) { setAlert(cause instanceof Error ? cause.message : "手机推送开启失败，请在 Safari 添加到主屏幕后重试"); }
    finally { setPushBusy(false); }
  }
  async function sendTestEmail() {
    if (emailTestBusy) return;
    setEmailTestBusy(true);
    try { await api("email-test", {}); setAlert("测试邮件已提交发送，请检查 daolingz46@gmail.com 收件箱和垃圾邮件"); }
    catch (e) { setAlert(e instanceof Error ? e.message : "测试邮件发送失败"); }
    finally { setEmailTestBusy(false); }
  }
  function open(order: AdminOrder) { setSelected(order); setChecked(false); setReference(""); setDelivery({ email: "", password: "", codeUrl: "" }); setActionError(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selected || busy) return; setBusy(true); setActionError("");
    try { await api("update", { id: selected.id, action: selected.status === "processing" ? "complete" : "confirm", checked: selected.status === "processing" ? checked : true, reference, delivery }); setSelected(null); await load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    const cell = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; };
    const rows = [["订单码", "订单号", "商品", "金额", "邮箱/邀请码", "支付方式", "状态", "下单时间", "支付交易单号"], ...(result?.orders || []).map(o => [o.code, o.id, o.title, formatMoney(o.amountCents), o.target, o.method === "wechat" ? "微信" : "支付宝", labels[o.status], date(o.createdAt), o.reference])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `订单-第${page + 1}页.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (auth !== "ready") return <main className="workbench wb-auth"><form className="wb-login" onSubmit={login}>
    <div className="wb-brand-icon"><LockKeyhole size={28}/></div><p className="wb-eyebrow">{storeName}</p><h1>店主工作台</h1><p>查看订单、核实收款、完成交付</p>
    {auth === "loading" ? <p>正在连接工作台…</p> : <><label htmlFor="admin-password">管理密码</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/><button className="wb-primary" disabled={busy}>{busy ? "登录中…" : "登录工作台"}</button></>}
    {error && <p role="alert" className="wb-error">{error}</p>}<Link href="/">返回商店 <ArrowUpRight size={14}/></Link>
  </form></main>;
  return <main className="workbench">
    <header className="wb-header"><div><p className="wb-eyebrow">{storeName} / 管理中心</p><h1>订单工作台</h1></div><nav><button onClick={() => void enableSound()}><Volume2 size={15}/>{soundEnabled ? "叮声已开启 · 试听" : "开启订单叮声"}</button><button onClick={() => void enablePhonePush()} disabled={pushBusy}><Bell size={15}/>{pushBusy ? "连接中…" : pushEndpoint ? "测试手机推送" : "开启手机推送"}</button><button onClick={() => void enableDesktopAlerts()}><Bell size={15}/>{desktopAlerts ? "桌面提醒已开" : "开启桌面提醒"}</button><a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} target="_blank" rel="noreferrer">打开商店 <ArrowUpRight size={15}/></a><button onClick={() => void logout()}><LogOut size={15}/>退出</button></nav></header>
    <p className="wb-description">以微信、支付宝收款记录核实到账，再处理充值或账号交付。iPhone 请用 Safari 打开此页，分享 → 添加到主屏幕，从桌面图标进入后点“开启手机推送”。工作台打开时可另点“开启订单叮声”。</p>
    {emailConfigured === false && <div className="wb-email-setup" role="status"><strong>订单邮件提醒还未启用</strong><span>邮件服务尚未配置。可用个人 Gmail 的 Apps Script 免域名发信，或配置 Resend API Key；新订单和买家付款反馈会发到 daolingz46@gmail.com。</span></div>}
    {emailConfigured === true && <div className="wb-email-ready"><span>邮件提醒已连接 · 新订单和付款反馈将发送到 daolingz46@gmail.com</span><button onClick={() => void sendTestEmail()} disabled={emailTestBusy}>{emailTestBusy ? "发送中…" : "发送测试邮件"}</button></div>}
    {alert && <div className="wb-alert" role="status"><span>{alert}</span><button aria-label="关闭提醒" onClick={() => setAlert("")}>×</button></div>}
    {!!result?.summary.awaiting && <button className="wb-awaiting" onClick={() => { setStatus("reported"); setSearch(""); setQuery(""); setPage(0); }}><strong>待核实到账：{result.summary.awaiting} 笔</strong><span>买家已提交付款反馈，点击查看并核对收款记录 →</span></button>}
    <section className="wb-metrics" aria-label="经营数据">{[
      ["累计确认收款", `¥${formatMoney(result?.summary.revenueCents || 0)}`, "已核实到账的订单"],
      ["今日确认收款", `¥${formatMoney(result?.summary.todayCents || 0)}`, "北京时间今日"],
      ["待核实到账", result?.summary.awaiting || 0, "买家已反馈付款 · 5 秒自动刷新"],
      ["待交付", result?.summary.processing || 0, `${result?.summary.completed || 0} 笔已完成 · 共 ${result?.summary.total || 0} 笔订单`],
    ].map(([title, value, note]) => <article key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
    <section className="wb-visitors"><div className="wb-visitor-heading"><div><h2>访客数据</h2><p>匿名统计访问次数，不记录访客姓名、联系方式或完整来源网址。</p></div><div className="wb-visitor-stats"><span>今日 <b>{visits?.summary.today ?? "—"}</b></span><span>近 7 天 <b>{visits?.summary.last7Days ?? "—"}</b></span><span>累计 <b>{visits?.summary.total ?? "—"}</b></span></div></div><div className="wb-visit-list"><div className="wb-visit-row wb-visit-head"><span>访问时间</span><span>页面</span><span>来源</span><span>设备</span></div>{visits?.recent.map(visit => <div className="wb-visit-row" key={visit.id}><span>{date(visit.createdAt)}</span><span>{visit.page === "/" ? "商店首页" : visit.page}</span><span>{visitSourceLabels[visit.source] || "其他网站"}</span><span>{visitDeviceLabels[visit.device] || "电脑"}</span></div>)}{visits && visits.recent.length === 0 && <p className="wb-visit-empty">还没有访客记录；访客打开商店后会自动统计。</p>}</div></section>
    <section className="wb-order-section"><div className="wb-toolbar"><h2>订单列表</h2><div><button onClick={() => void load()}><RefreshCw size={15}/>刷新</button><button onClick={exportCsv} disabled={!result?.orders.length}><Download size={15}/>导出当前页</button></div></div>
      <form className="wb-filters" onSubmit={e => { e.preventDefault(); setPage(0); setSearch(query.trim()); }}><div><Search size={17}/><input aria-label="搜索订单" placeholder="订单码、订单号、邮箱或邀请码" value={query} onChange={e => setQuery(e.target.value)} maxLength={128}/></div><select aria-label="订单状态" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">全部状态</option>{Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><button className="wb-primary">查询</button></form>
      {error && <p className="wb-error" role="alert">{error}</p>}
      <div className="wb-table-scroll"><table><thead><tr><th>订单 / 商品</th><th>买家信息</th><th>金额 / 方式</th><th>状态</th><th>下单时间</th><th>操作</th></tr></thead><tbody>{result?.orders.map(order => <tr key={order.id}>
        <td><strong className="wb-code">{order.code}</strong><span>{order.title}</span><small title={order.id}>{order.id}</small></td><td><small>{order.product === "muse-token" ? "账号邀请码" : "收件邮箱"}</small><span className="wb-target">{order.target}</span></td>
        <td><strong>¥{formatMoney(order.amountCents)}</strong><span>{order.method === "wechat" ? "微信" : "支付宝"}</span></td><td><span className={`wb-status is-${order.status}`}>{labels[order.status]}</span>{order.reference && <small title={order.reference}>交易号：{order.reference}</small>}</td><td><span>{date(order.createdAt)}</span></td>
        <td>{order.status === "complete" ? <span className="wb-done">已交付</span> : <button className="wb-action" onClick={() => open(order)}>{order.status === "processing" ? "完成交付" : "核实收款"}</button>}</td>
      </tr>)}</tbody></table></div>
      {!result?.orders.length && <div className="wb-empty"><ShoppingBagIcon/><h3>暂无匹配订单</h3><p>客户下单后，订单会自动出现在这里。</p></div>}
      <footer className="wb-pagination"><span>共 {result?.count.total || 0} 笔 · 每页 50 笔</span><div><button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}</span><button disabled={(page + 1) * 50 >= (result?.count.total || 0)} onClick={() => setPage(page + 1)}>下一页</button></div></footer>
    </section>
    {selected && <dialog ref={dialog} className="wb-dialog" onCancel={e => { if (busy) e.preventDefault(); else setSelected(null); }} aria-labelledby="wb-action-title"><button className="wb-close" aria-label="关闭" disabled={busy} onClick={() => setSelected(null)}><X size={18}/></button>
      <form onSubmit={save}><p className="wb-eyebrow">订单码 {selected.code}</p><h2 id="wb-action-title">{selected.status === "processing" ? "完成交付" : "核实收款"}</h2><p>{selected.title} · ¥{formatMoney(selected.amountCents)} · {selected.method === "wechat" ? "微信" : "支付宝"}</p><p className="wb-target">{selected.product === "muse-token" ? "账号邀请码" : "收件邮箱"}：{selected.target}</p>
        {selected.status === "processing" ? <>{selected.product === "muse" && <><label>交付账号<input required value={delivery.email} maxLength={254} onChange={e => setDelivery({ ...delivery, email: e.target.value })}/></label><label>账号密码<input required value={delivery.password} maxLength={256} onChange={e => setDelivery({ ...delivery, password: e.target.value })}/></label><label>接码链接<input required type="url" pattern="https://.*" value={delivery.codeUrl} maxLength={1000} placeholder="https://…" onChange={e => setDelivery({ ...delivery, codeUrl: e.target.value })}/></label></>}<label className="wb-check"><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)}/>{selected.product === "muse-token" ? "我已为此邀请码完成充值" : "我已核对账号资料，确认交付给买家"}</label></> : <><div className="wb-notice">请确认已收到 ¥{formatMoney(selected.amountCents)}，付款备注包含订单码 <b>{selected.code}</b>。</div><label>支付交易单号（选填）<input minLength={6} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} placeholder="可选：从收款账单中复制交易单号"/></label></>}
        {actionError && <p className="wb-error" role="alert">{actionError}</p>}<button className="wb-primary" disabled={selected.status === "processing" && !checked || busy}>{busy ? "保存中…" : selected.status === "processing" ? "确认已完成交付" : "确定"}</button>
      </form>
    </dialog>}
  </main>;
}
function ShoppingBagIcon() { return <LockKeyhole size={26}/>; }
