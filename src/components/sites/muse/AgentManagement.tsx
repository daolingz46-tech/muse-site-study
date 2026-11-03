"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { formatMoney } from "./catalog";
import { storeApiUrl } from "./store-api";

type Agent = { id: string; name: string; referralCode: string; status: "active" | "disabled"; orderCount: number; completedOrderCount: number };
type Rule = { productKey: string; amountCents: number; updatedAt: number };
type Product = { productKey: string; name: string; priceCents: number; category: string };
type AgentData = { agents: Agent[]; rules: Rule[]; products: Product[] };
type Api = (path: string, input?: unknown) => Promise<unknown>;
type Withdrawal = { id: string; agentId: string; agentName: string; amountCents: number; status: string; requestedAt: number; approvedAt: number | null; dueAt: number | null; paidAt: number | null; payoutMethod: "alipay" | "wechat" | null; payoutCodeId:string|null };
type Commission = { orderId: string; code: string; agentName: string; amountCents: number; payoutInFlight: boolean; state: "active" | "held" | "refunded" | "unconfigured" };
type AgentOrderDetail = { code:string; title:string; status:string; amountCents:number; target:string; contactEmail:string|null; createdAt:number; paidAt:number|null; completedAt:number|null; commissionCents:number; settlement:string; availableAt:number|null };
function agentActionError(cause: unknown, fallback: string) {
  return cause instanceof Error && "status" in cause && cause.status === 401 ? "请先完成下方店主认证，再操作代理或佣金设置。" : fallback;
}

class OwnerApiError extends Error { constructor(public status: number, message: string) { super(message); } }
async function ownerApi(path: string, input?: unknown): Promise<unknown> {
  const response = await fetch(storeApiUrl(`/api/admin/owner-${path}`), { method: input === undefined ? "GET" : "POST", headers: input === undefined ? {} : { "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input), credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new OwnerApiError(response.status, data?.message || "操作暂时不可用，请稍后重试");
  return data;
}
function ownerDate(value: number | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(value) : "—"; }
const withdrawalStatus: Record<string, string> = { pending: "待审核", approved: "已批准，待人工打款", paying: "打款处理中", paid: "已标记打款", rejected: "已拒绝", unknown: "结果待核查" };

function AgentOrders({ agent, api }: { agent:Agent; api:Api }) {
  const [rows,setRows]=useState<AgentOrderDetail[]|null>(null), [page,setPage]=useState(0), [more,setMore]=useState(false), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  async function load(next:number) { setBusy(true); setError(""); try { const result=await api(`agent-orders?agentId=${encodeURIComponent(agent.id)}&page=${next}`) as {orders:AgentOrderDetail[];hasMore:boolean}; setRows(result.orders);setMore(result.hasMore);setPage(next); } catch(e) { setError(e instanceof Error?e.message:"读取订单失败"); } finally { setBusy(false); } }
  const states:Record<string,string>={pending:"待付款",reported:"待核款",processing:"待交付",complete:"已完成",expired:"已过期"};
  const settlement:Record<string,string>={unconfigured:"下单时未设置佣金，需店主核查",review:"佣金需核查",awaiting:"等待核款及交付",pending:"待结算（T+1）",matured:"已到结算日",hold:"佣金已冻结",refunded:"佣金已冲正"};
  return <details className="wb-agent-orders" onToggle={e=>{if(e.currentTarget.open && rows===null && !busy) void load(0);}}><summary>查看该代理的订单</summary>
    {error && <p className="wb-error" role="alert">{error}</p>}{busy && <p>正在读取订单…</p>}{rows && !rows.length && <p>暂无订单</p>}
    {rows?.map(row=><article className="wb-agent-order-detail" key={row.code}><strong>订单 {row.code} · {row.title}</strong><p>订单金额 ¥{formatMoney(row.amountCents)} · {states[row.status] || row.status}</p><p>客户：{row.contactEmail || row.target}</p><p>下单：{ownerDate(row.createdAt)} · 核款：{ownerDate(row.paidAt)} · 交付：{ownerDate(row.completedAt)}</p><p>佣金 ¥{formatMoney(row.commissionCents)} · {settlement[row.settlement] || "待核查"}{row.settlement === "pending" && row.availableAt ? ` · 预计 ${ownerDate(row.availableAt)} 可结算` : ""}</p></article>)}
    {rows && <div className="wb-withdrawal-actions"><button type="button" className="wb-action" disabled={busy||page===0} onClick={()=>void load(page-1)}>上一页</button><span>第 {page+1} 页</span><button type="button" className="wb-action" disabled={busy||!more} onClick={()=>void load(page+1)}>下一页</button><button type="button" className="wb-action" disabled={busy} onClick={()=>void load(page)}>刷新订单</button></div>}
  </details>;
}

function CommissionControls() {
  const [code, setCode] = useState(""), [reason, setReason] = useState("");
  const [commission, setCommission] = useState<Commission | null>(null), [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const states: Record<Commission["state"], string> = { active: "正常", held: "已冻结", refunded: "已退款冲正", unconfigured: "未配置，需核查" };
  async function lookup(orderCode: string) {
    const data = await ownerApi(`commission?code=${encodeURIComponent(orderCode)}`) as { commission: Commission | null };
    setCommission(data.commission); setSearched(true);
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4}$/.test(code)) { setError("请输入 4 位订单码，包括前导零。"); return; }
    setBusy(true); setError(""); setNotice(""); setCommission(null); setSearched(false);
    try { await lookup(code); } catch (cause) { setError(cause instanceof Error ? cause.message : "查询失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  async function action(operation: "hold" | "release" | "refund") {
    if (busy || !commission) return;
    if (commission.payoutInFlight) { setError("该代理有提现正在打款或待核查，请先核对并处理完提现，再进行佣金操作。"); return; }
    const note = reason.trim();
    if (note.length < 10 || note.length > 500) { setError("请填写 10 至 500 字的操作原因。"); return; }
    const actionText = operation === "hold" ? "冻结" : operation === "release" ? "解除冻结" : "确认退款冲正";
    const warning = operation === "refund" ? "退款冲正后不可在此直接恢复，请确认客户退款已核实。" : operation === "hold" ? "冻结后，该订单佣金将暂停结算。" : "解除冻结后，佣金将按规则重新参与结算。";
    if (!window.confirm(`确认对订单 ${commission.code} 执行“${actionText}”？${warning}`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await ownerApi("commission-action", { orderId: commission.orderId, action: operation, reason: note, requestId: crypto.randomUUID() });
      await lookup(commission.code); setReason(""); setNotice("佣金状态已更新。");
    } catch { setCommission(null); setSearched(false); setError("操作结果未确认。请先重新查询订单状态核对，确认后再决定是否继续，系统不会自动重试。"); }
    finally { setBusy(false); }
  }
  return <div className="wb-commission-controls"><h3>订单佣金风险管理</h3><p className="wb-agent-help">按平台订单码查询。退款冲正不能直接恢复，请核实后操作。</p>
    <form className="wb-commission-search" onSubmit={search}><label>4 位订单码<input value={code} onChange={event => { setCode(event.target.value); setCommission(null); setSearched(false); }} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="例如 0123" required/></label><button className="wb-action" disabled={busy}>查询</button></form>
    {error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-agent-success" role="status">{notice}</p>}
    {searched && !commission && <p className="wb-agent-help">未找到该订单对应的代理佣金。</p>}
    {commission && <div className="wb-commission-result"><p><strong>订单 {commission.code} · 代理 {commission.agentName}</strong></p><p>订单佣金 ¥{formatMoney(commission.amountCents)} · 状态：{states[commission.state] || "未知，请核查"}</p>
      {commission.payoutInFlight && <p className="wb-error" role="alert"><strong>该代理有提现正在打款或等待核查，暂不能冻结、解冻或退款冲正。</strong> 这些操作不能撤回外部转账，请先核对流水并处理完相关提现，再重新查询。</p>}
      {commission.state === "unconfigured" && <p className="wb-error">佣金未配置，暂不可操作，请联系店主核查。</p>}
      {commission.state === "refunded" && <p className="wb-agent-help">此佣金已退款冲正，不可直接恢复。</p>}
      {(commission.state === "active" || commission.state === "held") && <><label>操作原因（10 至 500 字）<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500}/></label><div className="wb-withdrawal-actions">{commission.state === "active" ? <button className="wb-action" type="button" disabled={busy || commission.payoutInFlight} onClick={() => void action("hold")}>冻结佣金</button> : <button className="wb-action" type="button" disabled={busy || commission.payoutInFlight} onClick={() => void action("release")}>解除冻结</button>}<button className="wb-action" type="button" disabled={busy || commission.payoutInFlight} onClick={() => void action("refund")}>确认退款冲正</button></div></>}
    </div>}
  </div>;
}

function WithdrawalManagement() {
  const [auth, setAuth] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState(""), [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Withdrawal[]>([]), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (requestedPage: number) => {
    try { const value = await ownerApi(`withdrawals?page=${requestedPage}`) as { withdrawals: Withdrawal[]; page: number; hasMore: boolean }; setRows(value.withdrawals); setPage(value.page); setHasMore(value.hasMore); setAuth("ready"); setError(""); }
    catch (cause) { if (cause instanceof OwnerApiError && cause.status === 401) { setAuth("login"); setRows([]); } else { setError(cause instanceof Error ? cause.message : "读取失败"); setAuth("login"); } }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(0), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const first = window.setTimeout(() => setClock(Date.now()), 0); const timer = window.setInterval(() => setClock(Date.now()), 30000); return () => { window.clearTimeout(first); window.clearInterval(timer); }; }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); if (busy || !password) return; setBusy(true); setError(""); setNotice("");
    try { await ownerApi("login", { password }); setPassword(""); await load(0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "认证失败"); }
    finally { setPassword(""); setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true); setNotice(""); setError("");
    try { await ownerApi("logout", {}); setRows([]); setAuth("login"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "退出失败，请重试"); }
    finally { setBusy(false); }
  }
  async function action(row: Withdrawal, operation: "approve" | "reject" | "begin_payout" | "mark_paid" | "mark_unknown" | "release_unpaid") {
    if (busy) return;
    const paymentReference = (references[row.id] || "").trim();
    const verificationNote = (verificationNotes[row.id] || "").trim();
    if (operation === "mark_paid" && (paymentReference.length < 6 || paymentReference.length > 100)) { setError("请输入实际转账流水号，长度为 6 至 100 个字符。"); return; }
    if (operation === "release_unpaid" && (verificationNote.length < 10 || verificationNote.length > 500)) { setError("请填写 10 至 500 字的核查说明，说明如何确认没有转账。"); return; }
    const prompt = operation === "approve" ? `批准 ${row.agentName} 的 ¥${formatMoney(row.amountCents)} 提现？批准后次日安排人工打款。` : operation === "reject" ? `拒绝 ${row.agentName} 的 ¥${formatMoney(row.amountCents)} 提现？` : operation === "begin_payout" ? `确认锁定 ${row.agentName} 的 ¥${formatMoney(row.amountCents)} 提现并开始人工打款？系统不会自动转账。` : operation === "mark_unknown" ? "确认标记打款结果待核查？请先在线下查清转账状态，避免重复打款。" : operation === "release_unpaid" ? `你已核对收款记录和转账流水，确认没有向 ${row.agentName} 转账 ¥${formatMoney(row.amountCents)}？确认后将释放这笔提现。` : `请确认你已人工向 ${row.agentName} 支付 ¥${formatMoney(row.amountCents)}，并且输入的流水号来自这笔转账。此操作不会自动转账。`;
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(""); setNotice("");
    try { await ownerApi("withdrawal-action", { id: row.id, action: operation, ...(operation === "mark_paid" ? { paymentReference } : {}), ...(operation === "release_unpaid" ? { confirmedNoTransfer: true, verificationNote } : {}) }); setReferences(current => ({ ...current, [row.id]: "" })); setVerificationNotes(current => ({ ...current, [row.id]: "" })); await load(page); setNotice(operation === "mark_paid" ? "已记录人工打款状态。" : operation === "begin_payout" ? "提现已锁定，请线下核对收款资料后人工转账。" : operation === "mark_unknown" ? "已标记待核查，请勿重复打款。" : operation === "release_unpaid" ? "已记录核查并释放未转账提现。" : "审核结果已保存。"); }
    catch (cause) { await load(page); setError(operation === "begin_payout" && cause instanceof OwnerApiError && cause.status === 409 ? `${cause.message} 请先核对提现状态和转账记录，勿再次转账。` : "操作结果未确认，请先核对提现状态和转账记录，再决定是否重试。"); }
    finally { setBusy(false); }
  }
  async function changePage(next: number) { if (busy || next < 0) return; setBusy(true); setNotice(""); try { await load(next); } finally { setBusy(false); } }
  return <div className="wb-withdrawals"><div className="wb-agent-section-title"><h3>代理提现审核</h3>{auth === "ready" && <div className="wb-withdrawal-actions"><button className="wb-action" type="button" disabled={busy} onClick={() => void changePage(page)}>刷新</button><button className="wb-action" type="button" disabled={busy} onClick={() => void logout()}>退出店主认证</button></div>}</div>
    <p className="wb-agent-help">批准后的北京时间次日，先锁定提现，再线下人工转账；确认成功后填写真实转账流水号。系统不会自动转账。</p>
    {error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-agent-success" role="status">{notice}</p>}
    {auth === "loading" && <p>正在检查店主认证…</p>}
    {auth === "login" && <form className="wb-owner-login" onSubmit={login}><label>店主审核密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/></label><button className="wb-primary" disabled={busy}>{busy ? "认证中…" : "认证店主身份"}</button><p>提现审核需使用单独的店主密码。</p></form>}
    {auth === "ready" && <CommissionControls/>}
    {auth === "ready" && (rows.length ? <div className="wb-withdrawal-list">{rows.map(row => <article className="wb-withdrawal-card" key={row.id}>
      <div className="wb-agent-card-heading"><strong>{row.agentName}</strong><strong>¥{formatMoney(row.amountCents)}</strong></div>
      <p>收款方式：{row.payoutMethod === "alipay" ? "支付宝" : row.payoutMethod === "wechat" ? "微信" : "旧申请未提供，请联系代理"}</p>{row.payoutCodeId && <details><summary>查看收款码</summary><img src={storeApiUrl(`/api/admin/owner-payout-code?withdrawalId=${encodeURIComponent(row.id)}`)} alt={`${row.agentName}的收款码`} style={{display:"block",maxWidth:240,maxHeight:300,marginTop:8}}/></details>}<p>状态：{withdrawalStatus[row.status] || row.status}</p><p>申请：{ownerDate(row.requestedAt)} · 批准：{ownerDate(row.approvedAt)} · 可安排打款：{ownerDate(row.dueAt)}（北京时间）</p>{row.paidAt && <p>打款记录：{ownerDate(row.paidAt)}</p>}
      {row.status === "unknown" && <p className="wb-error">打款结果待核查。请先查明转账状态，切勿重复打款；确认成功后填写真实流水号。</p>}
      <div className="wb-withdrawal-actions">
        {row.status === "pending" && <button className="wb-primary" type="button" disabled={busy} onClick={() => void action(row, "approve")}>批准提现</button>}
        {(row.status === "pending" || row.status === "approved") && <button className="wb-action" type="button" disabled={busy} onClick={() => void action(row, "reject")}>拒绝</button>}
        {row.status === "approved" && <button className="wb-action" type="button" disabled={busy || !row.dueAt || clock < row.dueAt} onClick={() => void action(row, "begin_payout")}>锁定并开始人工打款</button>}
        {row.status === "paying" && <button className="wb-action" type="button" disabled={busy} onClick={() => void action(row, "mark_unknown")}>标记结果待核查</button>}
      </div>
      {(row.status === "paying" || row.status === "unknown") && <form className="wb-payment-reference" onSubmit={event => { event.preventDefault(); void action(row, "mark_paid"); }}><label>实际转账流水号<input value={references[row.id] || ""} onChange={event => setReferences(current => ({ ...current, [row.id]: event.target.value }))} minLength={6} maxLength={100} autoComplete="off" required/></label><button className="wb-primary" disabled={busy}>确认已人工打款</button></form>}
      {row.status === "unknown" && <form className="wb-payment-reference" onSubmit={event => { event.preventDefault(); void action(row, "release_unpaid"); }}><label>确认没有转账的核查说明（10 至 500 字）<textarea value={verificationNotes[row.id] || ""} onChange={event => setVerificationNotes(current => ({ ...current, [row.id]: event.target.value }))} minLength={10} maxLength={500} required/></label><p>只在核对后确认没有转账时使用，提交前将再次要求确认。</p><button className="wb-action" disabled={busy}>确认未转账并释放</button></form>}
    </article>)}</div> : <p className="wb-agent-help">当前页暂无提现申请。</p>)}
    {auth === "ready" && <div className="wb-withdrawal-pagination"><p className="wb-agent-help">待处理申请优先，每页最多 50 条。处理后列表顺序可能变化，请返回第一页复查。</p><div className="wb-withdrawal-actions"><button className="wb-action" type="button" disabled={busy || page === 0} onClick={() => void changePage(page - 1)}>上一页</button><span>第 {page + 1} 页</span><button className="wb-action" type="button" disabled={busy || !hasMore} onClick={() => void changePage(page + 1)}>下一页</button></div></div>}
  </div>;
}

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
  const [showPassword, setShowPassword] = useState(false);
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
      setPassword(""); setShowPassword(false); setName(""); setCreateOpen(false);
      setNotice(`已创建 ${created.name}。请在下方复制推广链接；代理登录账号为推广码，密码由你安全告知代理。`);
      await load();
    } catch (cause) { await load(); setError(agentActionError(cause, "创建结果未确认，请先检查上方代理列表，再决定是否重试。")); }
    finally { setBusy(false); }
  }
  async function toggle(agent: Agent) {
    if (busy || !window.confirm(agent.status === "active" ? `确定停用“${agent.name}”？停用后其推广链接和登录将无法使用。` : `确定启用“${agent.name}”？`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api("agent-status", { id: agent.id, status: agent.status === "active" ? "disabled" : "active" }); setNotice("代理状态已更新。"); await load(); }
    catch (cause) { await load(); setError(agentActionError(cause, "状态更新结果未确认，请刷新后核对。")); }
    finally { setBusy(false); }
  }
  async function saveRule(productKey: string, amountCents: number) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await api("agent-rule", { productKey, amountCents }); setNotice("佣金规则已保存，只影响之后创建的订单。"); await load(); }
    catch (cause) { await load(); setError(agentActionError(cause, "保存结果未确认，请核对当前佣金后再试。")); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("推广链接已复制。"); }
    catch { setError("复制失败，请手动选择并复制下方链接。"); }
  }
  const agents = data?.agents || [];
  return <section className="wb-visitors wb-agents" id="agent-management" aria-labelledby="agent-heading">
    <div className="wb-visitor-heading"><div><h2 id="agent-heading">代理管理</h2><p>管理代理、推广链接与每个商品的佣金规则。</p></div><button className="wb-action" type="button" onClick={() => void load()} disabled={busy}>刷新</button></div>
    <div className="wb-agent-explainer"><strong>创建或停用代理、修改佣金之前，请先在下方“代理提现审核”完成店主认证。</strong> 佣金按订单规则记录，提现审核同样需要店主认证。</div>
    {error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-agent-success" role="status">{notice}</p>}
    {!data && !error && <p>正在加载代理信息…</p>}
    {data && <>
      <div className="wb-agent-summary"><div><span>显示代理数</span><strong>{agents.length}</strong></div><div><span>显示启用数</span><strong>{agents.filter(a => a.status === "active").length}</strong></div><div><span>显示代理订单</span><strong>{agents.reduce((sum,a) => sum + (a.orderCount || 0), 0)}</strong></div><div><span>显示已完成</span><strong>{agents.reduce((sum,a) => sum + (a.completedOrderCount || 0), 0)}</strong></div></div>
      <p className="wb-agent-help">统计只包含当前列表中的代理，最多显示 200 位；订单数量不代表可提现金额。</p>
      <div className="wb-agent-section-title"><h3>代理列表</h3><button className="wb-primary" type="button" onClick={() => { setCreateOpen(!createOpen); setShowPassword(false); setError(""); }} disabled={busy}>{createOpen ? "取消创建" : "创建代理"}</button></div>
      {createOpen && <form className="wb-agent-create" onSubmit={create}>
        <label>代理名称<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off"/></label>
        <div><label htmlFor="new-agent-password">设置登录密码</label><div className="wb-agent-password"><input id="new-agent-password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={256} required autoComplete="new-password"/><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
        <p>密码至少 12 位。代理登录账号为创建后显示的推广码；密码不会再次显示，请安全交给代理。</p>
        <button className="wb-primary" disabled={busy}>{busy ? "处理中…" : "确认创建"}</button>
      </form>}
      {!agents.length ? <p className="wb-agent-help">还没有代理，点击“创建代理”开始。</p> : <div className="wb-agent-list">{agents.map(agent => {
        const link = `https://musetoken.store/?ref=${encodeURIComponent(agent.referralCode)}`;
        return <article className="wb-agent-card" key={agent.id}><div className="wb-agent-card-heading"><div><strong>{agent.name}</strong><span className={agent.status === "active" ? "wb-agent-active" : "wb-agent-disabled"}>{agent.status === "active" ? "启用中" : "已停用"}</span></div><button className="wb-action" type="button" disabled={busy} onClick={() => void toggle(agent)}>{agent.status === "active" ? "停用" : "启用"}</button></div>
          <p>归属订单 {agent.orderCount || 0} 笔 · 已完成 {agent.completedOrderCount || 0} 笔</p><label>推广链接<input readOnly value={link} onFocus={e => e.currentTarget.select()}/></label><div className="wb-agent-card-actions"><button className="wb-action" type="button" onClick={() => void copy(link)}>复制推广链接</button><details><summary>查看代理登录账号</summary><code>{agent.referralCode}</code></details></div><AgentOrders agent={agent} api={api}/></article>;
      })}</div>}
      <WithdrawalManagement/>
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
