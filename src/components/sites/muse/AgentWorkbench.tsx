"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Eye, EyeOff, MessageCircle, Plus } from "lucide-react";
import { storeApiUrl } from "./store-api";
import "./agent-workbench.css";

type Agent = { id: string; name: string; referralCode: string };
type AgentOrder = { code: string; title: string; status: string; createdAt: number; commissionCents: number; ruleVersion: number; commissionState: string };
type Balance = { availableCents: number; pendingCents: number; reservedCents: number; paidCents: number; debtCents:number; reserveShortfallCents:number; hasHold:boolean };
type Withdrawal = { id: string; amountCents: number; status: string; requestedAt: number; dueAt: number | null };
type PendingWithdrawal = { requestId: string; amountCents: number; uncertain: boolean; payoutCodeId: string };
const statusNames: Record<string, string> = { pending: "待付款", reported: "待核款", processing: "处理中", complete: "已完成", expired: "已过期" };

class AgentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function errorMessage(cause: unknown): string {
  return cause instanceof AgentRequestError && cause.status === 429 ? "暂时无法处理，请稍后再试。" : cause instanceof TypeError ? "无法连接工作台，请检查网络后重试。" : cause instanceof Error ? cause.message : "操作失败，请稍后重试";
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
  if (!value.orders.every(order => order && typeof order.code === "string" && typeof order.title === "string" && typeof order.status === "string" && Number.isFinite(order.createdAt) && Number.isSafeInteger(order.commissionCents) && order.commissionCents >= 0 && Number.isSafeInteger(order.ruleVersion) && order.ruleVersion >= 0 && typeof order.commissionState === "string")) throw new Error("订单数据异常，请联系店主");
  return value.orders as AgentOrder[];
}
function readBalance(value: unknown, agentId: string): Balance {
  if (!value || typeof value !== "object" || !("agentId" in value) || value.agentId !== agentId) throw new Error("余额读取失败，请重新登录");
  const data = value as Record<string, unknown>;
  if (typeof data.hasHold !== "boolean" || !["availableCents", "pendingCents", "reservedCents", "paidCents", "debtCents", "reserveShortfallCents"].every(key => Number.isSafeInteger(data[key]) && Number(data[key]) >= 0)) throw new Error("余额数据异常，请联系店主");
  return data as Balance;
}
function readWithdrawals(value: unknown, agentId: string): Withdrawal[] {
  if (!value || typeof value !== "object" || !("agentId" in value) || value.agentId !== agentId || !("withdrawals" in value) || !Array.isArray(value.withdrawals)) throw new Error("提现记录读取失败，请重新登录");
  if (!value.withdrawals.every(w => w && typeof w.id === "string" && Number.isSafeInteger(w.amountCents) && w.amountCents > 0 && typeof w.status === "string" && Number.isFinite(w.requestedAt) && (w.dueAt == null || Number.isFinite(w.dueAt)))) throw new Error("提现记录异常，请联系店主");
  return value.withdrawals as Withdrawal[];
}
function money(cents: number) { return `¥${(cents / 100).toFixed(2)}`; }
function displayDate(value: number) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
function withdrawalKey(agentId: string) { return `agent-withdrawal-${agentId}`; }
function recoverWithdrawal(agentId: string): PendingWithdrawal | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(withdrawalKey(agentId)) || "null");
    if (!value || typeof value !== "object" || !("requestId" in value) || typeof value.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.requestId) || !("amountCents" in value) || !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) <= 0 || !("uncertain" in value) || typeof value.uncertain !== "boolean" || !("payoutCodeId" in value) || typeof value.payoutCodeId !== "string") return null;
    return value as PendingWithdrawal;
  } catch { return null; }
}
const withdrawalStatus: Record<string, string> = { pending: "待店主审核", approved: "已批准，等待人工打款", paying: "打款处理中", paid: "已打款", rejected: "已拒绝", unknown: "待店主核实" };

export function AgentWorkbench() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [posterStyle,setPosterStyle]=useState<"blue"|"green">("blue"),[poster,setPoster]=useState("");
  useEffect(()=>{if(!agent){setPoster("");return;}let active=true;async function make(){const canvas=document.createElement("canvas");canvas.width=720;canvas.height=900;const ctx=canvas.getContext("2d");if(!ctx)return;ctx.fillStyle=posterStyle==="blue"?"#163d79":"#12674d";ctx.fillRect(0,0,720,900);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="bold 58px sans-serif";ctx.fillText("卡密大王",360,125);ctx.font="30px sans-serif";ctx.fillText("扫码访问专属推广商店",360,190);ctx.fillStyle="#fff";ctx.fillRect(110,245,500,500);const qr=document.createElement("canvas");await QRCode.toCanvas(qr,`https://musetoken.store/?ref=${agent!.referralCode}`,{width:460,margin:3,errorCorrectionLevel:"M"});ctx.drawImage(qr,130,265);ctx.fillStyle="#fff";ctx.font="28px sans-serif";ctx.fillText("长按保存图片 · 扫码进入",360,815);if(active)setPoster(canvas.toDataURL("image/png"));}void make();return()=>{active=false;};},[agent,posterStyle]);
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [prices,setPrices]=useState<{productKey:string;name:string;priceCents:number;category:string;commissionCents:number|null}[]>([]);
  useEffect(()=>{if(!agent)return;let active=true;const load=()=>void agentRequest("/api/agent/prices").then(value=>{if(active)setPrices((value as {items:typeof prices}).items)}).catch(()=>{});load();const timer=window.setInterval(load,10000);return()=>{active=false;window.clearInterval(timer);};},[agent]);
  const [payoutMethod,setPayoutMethod]=useState<"alipay"|"wechat">("alipay"), [payoutImage,setPayoutImage]=useState<File|null>(null);
  const [pushEndpoint,setPushEndpoint]=useState("");
  const [pushBusy,setPushBusy]=useState(false);
  const [pushMessage,setPushMessage]=useState<{text:string;error:boolean}|null>(null);
  useEffect(()=>{if(!agent || !("serviceWorker" in navigator))return;let active=true;void navigator.serviceWorker.getRegistration("/agent/").then(r=>r?.pushManager.getSubscription()).then(sub=>{if(active && sub){setPushEndpoint(sub.endpoint);void agentRequest("/api/agent/push-subscribe",{subscription:sub.toJSON()}).catch(()=>{});}});return()=>{active=false;};},[agent]);
  async function enablePush(){
    if(pushBusy)return;setPushBusy(true);setPushMessage(null);
    try {
      if(pushEndpoint){await agentRequest("/api/agent/push-test",{endpoint:pushEndpoint});setPushMessage({text:"测试推送已提交，请查看手机通知。",error:false});return;}
      if(window.location.origin!=="https://musetoken.store" || !("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification==="undefined")throw new Error("iPhone 请使用 Safari 添加代理工作台到主屏幕，再从桌面打开并开启通知。");
      const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("请在手机设置中允许代理工作台发送通知。");
      const data=await agentRequest("/api/agent/push-key") as {publicKey:string};
      const bytes=Uint8Array.from(atob(data.publicKey.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-data.publicKey.length%4)%4)),c=>c.charCodeAt(0));
      const reg=await navigator.serviceWorker.register("/agent/sw.js",{scope:"/agent/"});const sub=await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      await agentRequest("/api/agent/push-subscribe",{subscription:sub.toJSON()});setPushEndpoint(sub.endpoint);setPushMessage({text:"手机推送已开启，有新代理订单时会提醒。",error:false});
    }catch(cause){setPushMessage({text:errorMessage(cause),error:true});}finally{setPushBusy(false);}
  }
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [pendingWithdrawal, setPendingWithdrawal] = useState<PendingWithdrawal | null>(null);
  const withdrawalInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [agentResult, ordersResult, balanceResult, withdrawalsResult] = await Promise.all([agentRequest("/api/agent/me"), agentRequest("/api/agent/orders"), agentRequest("/api/agent/balance"), agentRequest("/api/agent/withdrawals")]);
      const current = readAgent(agentResult), nextOrders = readOrders(ordersResult, current.id), nextBalance = readBalance(balanceResult, current.id), nextWithdrawals = readWithdrawals(withdrawalsResult, current.id);
      setAgent(current);
      setOrders(nextOrders);
      setBalance(nextBalance); setWithdrawals(nextWithdrawals);
      setPendingWithdrawal(recoverWithdrawal(current.id));
    } catch (cause) { setAgent(null); setOrders([]); setBalance(null); setWithdrawals([]); setPendingWithdrawal(null); throw cause; }
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [agentResult, ordersResult, balanceResult, withdrawalsResult] = await Promise.all([agentRequest("/api/agent/me"), agentRequest("/api/agent/orders"), agentRequest("/api/agent/balance"), agentRequest("/api/agent/withdrawals")]);
        const current = readAgent(agentResult), nextOrders = readOrders(ordersResult, current.id);
        const nextBalance = readBalance(balanceResult, current.id), nextWithdrawals = readWithdrawals(withdrawalsResult, current.id);
        if (active) { setAgent(current); setOrders(nextOrders); setBalance(nextBalance); setWithdrawals(nextWithdrawals); setPendingWithdrawal(recoverWithdrawal(current.id)); }
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
      setShowPassword(false);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { if(pushEndpoint){await agentRequest("/api/agent/push-unsubscribe",{endpoint:pushEndpoint});const reg=await navigator.serviceWorker.getRegistration("/agent/");const sub=await reg?.pushManager.getSubscription();await sub?.unsubscribe();setPushEndpoint("");} await agentRequest("/api/agent/logout", {}); setAgent(null); setOrders([]); setBalance(null); setWithdrawals([]); setPendingWithdrawal(null); setPassword(""); setNotice(""); }
    catch (cause) {
      if (cause instanceof AgentRequestError && cause.status === 401) { setAgent(null); setOrders([]); setBalance(null); setWithdrawals([]); setPendingWithdrawal(null); setPassword(""); setNotice(""); }
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
  async function submitWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent || !balance || busy || withdrawalInFlight.current) return;
    let attempt = pendingWithdrawal;
    if (!attempt) {
      const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(withdrawalAmount.trim());
      if (!match) { setError("请输入有效的提现金额，最多保留两位小数。"); return; }
      const amountCents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > balance.availableCents) { setError("提现金额须大于零且不超过可申请金额。"); return; }
      if (!payoutImage || payoutImage.size > 500000 || !["image/png","image/jpeg"].includes(payoutImage.type)) { setError("请上传 500 KB 以内的 PNG 或 JPG 收款码。"); return; }
      withdrawalInFlight.current=true; setBusy(true); setError("");
      try {
        const form=new FormData();form.set("method",payoutMethod);form.set("image",payoutImage);form.set("expectedAgentId",agent.id);
        const response=await fetch(storeApiUrl("/api/agent/payout-code"),{method:"POST",credentials:"include",cache:"no-store",body:form,signal:AbortSignal.timeout(15000)});
        const result=await response.json() as {id?:string;message?:string};
        if (!response.ok || !result.id) throw new Error(result.message || "收款码上传失败");
        attempt = { requestId: crypto.randomUUID(), amountCents, uncertain: false, payoutCodeId:result.id };
      } catch (cause) { setError(errorMessage(cause));return; } finally { withdrawalInFlight.current=false;setBusy(false); }
    }
    const previous = attempt;
    const pending = { ...attempt, uncertain: true };
    try { sessionStorage.setItem(withdrawalKey(agent.id), JSON.stringify(pending)); }
    catch { setError("无法保存本次申请记录，请检查浏览器设置后重试。"); return; }
    setPendingWithdrawal(pending); withdrawalInFlight.current = true; setBusy(true); setError(""); setNotice("");
    let submitted = false;
    try {
      await agentRequest("/api/agent/withdrawals", { amountCents: pending.amountCents, requestId: pending.requestId, expectedAgentId: agent.id, payoutCodeId:pending.payoutCodeId });
      submitted = true;
      sessionStorage.removeItem(withdrawalKey(agent.id)); setPendingWithdrawal(null); setWithdrawalAmount(""); setPayoutImage(null);
      setNotice("提现申请已提交，等待店主审核。");
      await refresh();
    } catch (cause) {
      if (submitted) { setError("申请已提交，但最新记录未能加载，请刷新查看。"); return; }
      const definitiveRejection = !previous.uncertain && cause instanceof AgentRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 429;
      if (definitiveRejection) { try { sessionStorage.removeItem(withdrawalKey(agent.id)); } catch { /* Ignore storage errors. */ } setPendingWithdrawal(null); setError(errorMessage(cause)); }
      else setError("申请结果暂未确认。请不要重复提交新申请，可使用下方按钮重试同一申请，或联系店主核实。");
    } finally { withdrawalInFlight.current = false; setBusy(false); }
  }

  return <main className="agent-page">
    <div className="agent-shell">
      <header className="agent-header"><div><span className="agent-brand">卡密大王</span><h1>代理工作台</h1><p>推广链接与订单记录</p></div>{agent && <div><button type="button" className="agent-text-button" disabled={pushBusy} onClick={() => void enablePush()}>{pushBusy ? "连接中…" : pushEndpoint ? "测试手机推送" : "开启手机推送"}</button><button type="button" className="agent-text-button" disabled={busy} onClick={() => void logout()}>退出登录</button></div>}</header>
      <details className="agent-push-guide">
        <summary>手机推送设置教程 <span>iPhone / 安卓</span></summary>
        <div className="agent-push-guide-content">
          <section><h2>iPhone / iPad</h2><ol><li>请确认系统为 iOS / iPadOS 16.4 或更高版本。用 Safari 打开代理工作台。</li><li>点击浏览器的“分享”按钮，选择“添加到主屏幕”。</li><li>从主屏幕上的“代理工作台”图标打开，登录代理账号。</li><li>点击页面顶部“开启手机推送”，在系统弹窗中选择允许；再点击“测试手机推送”检查通知。</li></ol><p>如未收到，在手机“设置 → 通知 → 代理工作台”中检查通知权限，并检查专注模式和网络。</p></section>
          <section><h2>安卓手机</h2><ol><li>使用 Chrome 浏览器打开代理工作台并登录。</li><li>点击页面顶部“开启手机推送”，在通知弹窗中选择允许；再点击“测试手机推送”检查通知。</li><li>如需桌面快捷入口，可在 Chrome 右上角菜单选择“添加到主屏幕”或“安装应用”；具体名称可能因手机不同而变化。</li></ol><p>如未收到，请在 Chrome 的“设置 → 网站设置 → 通知”中允许本站通知，同时检查手机的通知权限和网络。</p></section>
          <p>只有通过你的推广链接产生的新订单会提醒。退出代理账号会关闭当前设备的订阅；下次登录后请重新开启。</p>
        </div>
      </details>
      {agent && pushMessage && <p className={pushMessage.error ? "agent-error agent-push-message" : "agent-notice agent-push-message"} role={pushMessage.error ? "alert" : "status"}>{pushMessage.text}</p>}
      {loading ? <section className="agent-card"><p className="agent-muted">正在加载…</p></section> : !agent ? <section className="agent-card agent-login">
        <h2>登录代理工作台</h2><p className="agent-muted">请输入店主提供的代理编号和密码。</p>
        <form onSubmit={login}><label htmlFor="agent-code">代理编号</label><input id="agent-code" autoComplete="username" required value={code} onChange={event => setCode(event.target.value)} placeholder="输入代理编号" maxLength={32} />
          <label htmlFor="agent-password">登录密码</label><div className="agent-password-field"><input id="agent-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="输入登录密码" maxLength={256} /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div>
          {error && <p className="agent-error" role="alert">{error}</p>}<button type="submit" className="agent-primary" disabled={busy}>{busy ? "正在登录…" : "登录"}</button>
        </form>
      </section> : <>
        <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">推广中心</span><h2>你好，{agent.name}</h2></div></div>
          <p className="agent-muted">将专属链接分享给客户，通过链接进入并下单的订单会记录在这里。</p>
          <label className="agent-link-label" htmlFor="agent-link">你的推广链接</label><div className="agent-link-row"><input id="agent-link" readOnly value={`https://musetoken.store/?ref=${agent.referralCode}`} onFocus={event => event.currentTarget.select()} /><button className="agent-primary" type="button" onClick={() => void copyLink()}>复制链接</button></div>
          <p className="agent-hint">客户以后自行直接访问商店下单，订单将按自然流量处理。</p>
        </section>
        <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">推广商品</span><h2>商品价格与佣金</h2></div></div><p className="agent-hint">客户通过你的推广链接下单，每单佣金按下单时的规则计算；页面约每 10 秒更新。</p>{Object.entries(prices.reduce<Record<string,typeof prices>>((groups,item)=>{(groups[item.category] ||= []).push(item);return groups;},{})).map(([category,items])=><div key={category}><h3 className="agent-withdraw-title">{category}</h3><div className="agent-price-grid">{items.map(item=><article className="agent-price-item" key={item.productKey}><strong>{item.name}</strong><p>商品售价 {money(item.priceCents)}</p><p>每单佣金 <b>{item.commissionCents === null ? "店主尚未设置" : money(item.commissionCents)}</b></p></article>)}</div></div>)}</section>
        <section className="agent-card"><h2>我的推广二维码</h2><p className="agent-hint">二维码对应你的专属推广链接，保存后可分享给客户。</p><div className="agent-poster-buttons"><button type="button" className="agent-secondary" aria-pressed={posterStyle==="blue"} onClick={()=>setPosterStyle("blue")}>蓝色款</button><button type="button" className="agent-secondary" aria-pressed={posterStyle==="green"} onClick={()=>setPosterStyle("green")}>绿色款</button></div>{poster && <><img className="agent-poster" src={poster} alt="你的专属推广二维码"/><p className="agent-hint">手机可长按图片保存，电脑可点击下载。</p><a className="agent-primary agent-poster-download" href={poster} download="推广二维码.png">保存推广图片</a></>}</section>
        {balance && <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">佣金与提现</span><h2>结算概览</h2></div><button type="button" className="agent-secondary" disabled={busy} onClick={() => void refreshOrders()}>刷新</button></div>
          <div className="agent-balances"><div><span>可申请提现</span><strong>{money(balance.availableCents)}</strong></div><div><span>待结算</span><strong>{money(balance.pendingCents)}</strong></div><div><span>提现处理中</span><strong>{money(balance.reservedCents)}</strong></div><div><span>已打款</span><strong>{money(balance.paidCents)}</strong></div></div>
          {!balance.hasHold && (balance.debtCents > 0 || balance.reserveShortfallCents > 0) && <p className="agent-error">佣金调整后{balance.debtCents > 0 ? `存在 ${money(balance.debtCents)} 待抵扣金额` : "提现预留款需要核查"}，请联系店主。</p>}
          {balance.hasHold && <p className="agent-error">佣金正在核查，暂不可申请提现，请联系店主。</p>}
          <p className="agent-hint">订单确认收款并完成交付后，次日（北京时间自然日）结算。提现需店主审核，批准后的次日安排人工打款。建议优先使用支付宝，便于店主优先处理。</p>
          {error && <p className="agent-error" role="alert">{error}</p>}{notice && <p className="agent-notice" role="status">{notice}</p>}
          <form className="agent-withdraw" onSubmit={submitWithdrawal}><span className="agent-payout-label">收款方式</span><div className="agent-payout-methods" role="radiogroup" aria-label="收款方式">{(["alipay","wechat"] as const).map(method=><button key={method} type="button" role="radio" aria-checked={payoutMethod===method} className={`agent-payout-method ${payoutMethod===method ? "selected" : ""}`} disabled={busy || !!pendingWithdrawal} onClick={()=>setPayoutMethod(method)}><span className={`agent-payment-logo ${method}`} aria-hidden="true">{method === "alipay" ? "支" : <MessageCircle size={20}/>}</span><span>{method === "alipay" ? "支付宝" : "微信"}{method === "alipay" && <small>推荐</small>}</span></button>)}</div><span className="agent-payout-label">上传本人收款码</span><label className={`agent-upload-box ${busy || pendingWithdrawal ? "disabled" : ""}`} htmlFor="payout-image"><Plus size={28}/><strong>{payoutImage ? "更换收款码" : "点击上传收款码"}</strong><small>{payoutImage ? payoutImage.name : "PNG 或 JPG，最大 500 KB"}</small><input id="payout-image" type="file" accept="image/png,image/jpeg" disabled={busy || !!pendingWithdrawal} onChange={event=>setPayoutImage(event.target.files?.[0] || null)}/></label><p className="agent-hint">请确认收款码与所选方式一致，申请后店主将据此人工转账。</p><label htmlFor="withdraw-amount">提现金额（元）</label><div className="agent-link-row"><input id="withdraw-amount" type="text" inputMode="decimal" value={pendingWithdrawal ? (pendingWithdrawal.amountCents / 100).toFixed(2) : withdrawalAmount} onChange={event => setWithdrawalAmount(event.target.value)} disabled={busy || !!pendingWithdrawal} placeholder="输入提现金额" /><button type="submit" className="agent-primary" disabled={busy || (!pendingWithdrawal && balance.availableCents <= 0)}>{busy ? "处理中…" : pendingWithdrawal ? "重试同一申请" : "申请提现"}</button></div></form>
          {pendingWithdrawal && <p className="agent-error">上一笔 {money(pendingWithdrawal.amountCents)} 申请结果尚未确认，请重试同一申请或联系店主核实，避免重复申请。</p>}
          <h3 className="agent-withdraw-title">提现记录</h3>{!withdrawals.length ? <div className="agent-empty">暂无提现申请</div> : <div className="agent-orders">{withdrawals.map(item => <article className="agent-order" key={item.id}><div><strong>{money(item.amountCents)}</strong><p>申请时间 {displayDate(item.requestedAt)}{item.dueAt ? ` · 计划打款 ${displayDate(item.dueAt)}` : ""}</p></div><div className="agent-order-end"><span>{withdrawalStatus[item.status] || "状态待确认"}</span></div></article>)}</div>}
        </section>}
        <section className="agent-card"><div className="agent-card-heading"><div><span className="agent-eyebrow">订单记录</span><h2>最近订单</h2></div><button type="button" className="agent-secondary" disabled={busy} onClick={() => void refreshOrders()}>{busy ? "刷新中…" : "刷新"}</button></div>
          <p className="agent-hint">显示最近 100 笔订单；金额为下单时的佣金规则记录，到账情况请查看结算概览。</p>
          {!orders.length ? <div className="agent-empty">暂无推广订单</div> : <div className="agent-orders">{orders.map((order, index) => <article className="agent-order" key={`${order.code}-${order.createdAt}-${index}`}><div><strong>{order.title}</strong><p>订单码 {order.code} · {new Date(order.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p></div><div className="agent-order-end"><span>{statusNames[order.status] || "状态待确认"}</span><b>{order.ruleVersion === 0 ? "未配置佣金" : order.commissionState === "review" ? "佣金待店主核查" : order.commissionState === "hold" ? "佣金已冻结" : order.commissionState === "refunded" ? "佣金已冲正" : `${order.commissionState === "pending" ? "待结算（T+1）" : order.commissionState === "matured" ? "已到结算日" : "等待核款及交付"} · 佣金 ¥${(order.commissionCents / 100).toFixed(2)}`}</b></div></article>)}</div>}
        </section>
      </>}
    </div>
  </main>;
}
