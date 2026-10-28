"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Clock3, Copy, Download, RefreshCw, ShoppingBag, X } from "lucide-react";
import { formatMoney, supportQQ, type OrderDetails } from "./catalog";
import { lookupStoreOrder, reportStorePayment } from "./store-api";

export type StoreOrder = OrderDetails & {
  id: string; token: string; code: string; createdAt: number;
  method: "alipay" | "wechat"; expiresAt: number; status: OrderStatus;
  reportedAt?: number | null; qrImageUrl?: string;
  delivery?: { email: string; password: string; codeUrl: string } | { method: "email"; sentAt: number };
};
export type OrderStatus = "pending" | "reported" | "processing" | "complete" | "expired";
export function orderLink(order: Pick<StoreOrder, "id" | "token">) {
  return `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/#order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.token)}`;
}
export function PurchaseNotice({ onBack, onContinue, terms, title, busy = false, error = "" }: {
  onBack: () => void; onContinue: () => void; terms: ReadonlyArray<{ title: string; body: string }>;
  title: string; busy?: boolean; error?: string;
}) {
  const [seconds, setSeconds] = useState(5), [accepted, setAccepted] = useState(false);
  useEffect(() => { const start = Date.now(); const timer = window.setInterval(() => setSeconds(Math.max(0, 5 - Math.floor((Date.now() - start) / 1000))), 200); return () => window.clearInterval(timer); }, []);
  return <div className="muse-notice muse-step">
    <button className="muse-back" type="button" disabled={busy} onClick={onBack}><ArrowLeft size={15}/> 返回修改</button>
    <h1>购买须知</h1><p className="muse-subtitle">{title}</p>
    <ul className="muse-terms-list">{terms.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
    <div className="muse-notice-agreement muse-agreement"><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/><span className="muse-checkbox-art">{accepted && <Check size={11}/>}</span><span>我已阅读并同意以上购买须知</span></label></div>
    {error && <p className="muse-error" role="alert">{error}</p>}
    <button className="muse-primary muse-notice-continue" type="button" disabled={busy || seconds > 0 || !accepted} onClick={onContinue}>{busy ? "正在创建订单…" : <>继续下单{seconds > 0 ? ` · ${seconds}s` : ""} <ArrowRight size={16}/></>}</button>
  </div>;
}
export function OrderPayment({ order, onBack, onNotify, onOrderUpdate }: {
  order: StoreOrder; onBack: () => void; onNotify: (message: string) => void; onOrderUpdate: (order: StoreOrder) => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 1000)));
  const [refreshing, setRefreshing] = useState(false), [paymentError, setPaymentError] = useState("");
  const [copied, setCopied] = useState(false), [remark, setRemark] = useState(false), [qrOpen, setQrOpen] = useState(false), [reporting, setReporting] = useState(false);
  const inFlight = useRef(false), qrDialog = useRef<HTMLDialogElement>(null);
  const label = order.method === "wechat" ? "微信" : "支付宝", total = formatMoney(order.amountCents + order.feeCents);
  const expired = order.status === "expired" || (order.status === "pending" && remaining === 0);
  const canPay = order.status === "pending" && !expired;
  const countdown = `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  useEffect(() => { const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 1000))), 1000); return () => window.clearInterval(timer); }, [order.expiresAt]);
  useEffect(() => { if (qrOpen && canPay) qrDialog.current?.showModal(); else qrDialog.current?.close(); }, [qrOpen, canPay]);
  const refresh = useCallback(async () => {
    if (inFlight.current) return; inFlight.current = true; setRefreshing(true);
    try { onOrderUpdate(await lookupStoreOrder(order.id, order.token)); setPaymentError(""); }
    catch (e) { setPaymentError(e instanceof Error ? e.message : "查询失败，请稍后重试"); }
    finally { inFlight.current = false; setRefreshing(false); }
  }, [order.id, order.token, onOrderUpdate]);
  useEffect(() => {
    if (order.status === "complete") return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const visible = () => { if (!document.hidden) void refresh(); }; document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, order.status]);
  async function copy(value: string, code = false) {
    try { await navigator.clipboard.writeText(value); if (code) setCopied(true); onNotify(code ? "订单码已复制，付款时请粘贴到备注" : "已复制"); }
    catch { onNotify("请选中下面的订单码，长按或 Ctrl+C 复制"); }
  }
  async function report() {
    if (reporting) return; setReporting(true);
    try { onOrderUpdate(await reportStorePayment(order.id, order.token)); setQrOpen(false); setPaymentError(""); onNotify("已通知店主核对收款，请勿重复付款"); }
    catch (e) { setPaymentError(e instanceof Error ? e.message : "提交失败，请重试"); }
    finally { setReporting(false); }
  }
  function download() {
    const text = ["Muse 商店订单凭据", `订单链接：${orderLink(order)}`, `订单码（付款备注）：${order.code}`, `订单号：${order.id}`, `商品：${order.title}`, `金额：¥${total}`, order.product === "muse-token" ? `邀请码：${order.inviteCode}` : `邮箱：${order.email}`, `支持 QQ：${supportQQ}`, "订单链接包含查询口令，请勿公开。"].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `订单-${order.code}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="muse-order-stage muse-step">
    <button className="muse-back" type="button" onClick={onBack}><ArrowLeft size={15}/> 返回商品</button>
    <div className="muse-payment-summary"><h1>{canPay ? "支付订单" : order.status === "reported" ? "等待核实到账" : order.status === "processing" ? "已收款，处理中" : order.status === "complete" ? "订单已完成" : "订单已超时"}</h1><p>{order.title}</p><div className="muse-payment-amount"><span>¥</span><strong>{total}</strong></div></div>
    {(canPay || expired) && <div className="muse-remark-box">
      <strong className="muse-remark-title">付款备注必须填写 4 位订单码</strong>
      <div className="muse-code-row"><input aria-label="4 位订单码" readOnly value={order.code} onCopy={e => { const input = e.currentTarget; if (input.selectionStart === 0 && input.selectionEnd === 4) setCopied(true); }} onFocus={e => e.target.select()}/><button type="button" onClick={() => void copy(order.code, true)}><Copy size={16}/>{copied ? "已复制 ✓" : "复制订单码"}</button></div>
      <p>在{label}付款界面的<strong>「添加备注 / 付款说明」</strong>中粘贴 <b>{order.code}</b>，方便店主核对到账。不要填写邀请码代替订单码。</p>
      <label className="muse-remark-agree"><input type="checkbox" disabled={!copied} checked={remark} onChange={e => setRemark(e.target.checked)}/>我会在付款备注中填写 {order.code}</label>
      {!copied && <small>第 1 步：先复制订单码，再勾选确认。</small>}
    </div>}
    {canPay && <><button className="muse-primary" type="button" disabled={!copied || !remark} onClick={() => setQrOpen(true)}>第 2 步：打开{label}收款码 <ArrowRight size={16}/></button><p className="muse-payment-countdown"><Clock3 size={15}/> 请在 <strong>{countdown}</strong> 内付款</p></>}
    {!canPay && <div className="muse-status-message">{order.status === "reported" ? <><Clock3/><p>你已反馈付款，店主正在核对收款记录。确认后会更新此订单，请勿重复付款。</p></> : order.status === "processing" ? <><RefreshCw/><p>{order.product === "muse-token" ? "正在为填写的邀请码充值，通常 10 分钟内到账，拥挤时可能需要 30 分钟。" : order.product === "gpt" ? "店主正在处理订单，发货后卡密将发送到下单邮箱。" : "店主正在准备成品账号，完成后会发到下单邮箱。"}</p></> : order.status === "complete" ? <><CircleCheck/><p>{order.product === "muse-token" ? "充值已完成，请登录你的账号查看余额。" : order.delivery && "method" in order.delivery ? "卡密和使用教程已发到下单邮箱，请检查收件箱及垃圾邮件。" : "交付资料如下，请妥善保存。"}</p></> : <><Clock3/><p>付款时间已结束。若已付款，请反馈给店主核查；尚未付款请重新下单。</p></>}</div>}
    {order.status === "complete" && order.delivery && "email" in order.delivery && <div className="muse-delivery-fields">{[["账号邮箱", order.delivery.email], ["密码", order.delivery.password], ["接码链接", order.delivery.codeUrl]].map(([name, value]) => <div key={name}><span>{name}</span><div><code>{value}</code><button type="button" aria-label={`复制${name}`} onClick={() => void copy(value)}><Copy size={14}/></button></div></div>)}</div>}
    <dl className="muse-payment-details"><div><dt>4 位订单码</dt><dd><b>{order.code}</b></dd></div><div><dt>订单号</dt><dd>{order.id}</dd></div><div><dt>{order.product === "muse-token" ? "账号邀请码" : "收件邮箱"}</dt><dd>{order.product === "muse-token" ? order.inviteCode : order.email}</dd></div><div><dt>支付方式</dt><dd>{label}</dd></div><div><dt>金额</dt><dd>¥{total}</dd></div></dl>
    <div className="muse-order-actions"><button type="button" onClick={() => void copy(orderLink(order))}><Copy size={15}/>复制订单链接</button><button type="button" onClick={download}><Download size={15}/>保存订单凭据</button></div>
    <div className="muse-order-tools"><button type="button" onClick={() => void copy(order.id)}><Copy size={15}/>复制订单编号（单独可查）</button></div>
    <div className="muse-order-tools"><button type="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14}/>{refreshing ? "查询中…" : "刷新订单状态"}</button></div>
    {paymentError && <p className="muse-error" role="alert">{paymentError}</p>}
    {expired && <><button className="muse-primary" type="button" onClick={onBack}>重新下单</button><button className="muse-report-button" type="button" disabled={!copied || !remark || reporting} onClick={() => void report()}>我已付款，请店主核查</button></>}
    <p className="muse-order-footnote">保存订单链接，可随时查看进度。个人收款由店主核对，遇到问题联系 QQ：{supportQQ}。</p>
    {qrOpen && canPay && <dialog ref={qrDialog} className="muse-dialog muse-payment-dialog" aria-labelledby="qr-title" onCancel={() => setQrOpen(false)}>
      <button className="muse-dialog-x" type="button" aria-label="关闭收款码" onClick={() => setQrOpen(false)}><X size={18}/></button>
      <h2 id="qr-title">{label}扫码付款</h2><p className="muse-qr-total">请支付 <strong>¥{total}</strong></p>
      <div className="muse-qr-remark">付款备注必填：<b>{order.code}</b><button type="button" onClick={() => void copy(order.code, true)}>复制</button></div>
      {order.qrImageUrl && <Image unoptimized className="muse-collection-image" src={order.qrImageUrl} width={280} height={280} alt={`${label}收款码`}/>}
      <p>请在付款页面手动填写金额，并将 <strong>{order.code}</strong> 粘贴到「备注 / 付款说明」。</p>
      <p>同一部手机可长按保存收款码，再使用{label}扫一扫从相册识别。</p>
      {order.qrImageUrl && <a className="muse-save-qr" href={order.qrImageUrl} download={`${label}收款码.png`}>保存收款码</a>}
      <button className="muse-primary" type="button" disabled={reporting} onClick={() => void report()}>{reporting ? "提交中…" : "我已付款，通知店主核对"}</button>
      {paymentError && <p className="muse-error" role="alert">{paymentError}</p>}
      <small>点击后进入待核实状态，实际到账以店主核查为准。</small>
    </dialog>}
  </div>;
}
export function RecentOrders({ orders, onOpen }: { orders: StoreOrder[]; onOpen: (order: StoreOrder) => void }) {
  if (!orders.length) return null;
  return <div className="muse-saved-orders"><h3>本次访问的订单</h3>{orders.map(order => <button key={order.id} type="button" onClick={() => onOpen(order)}><ShoppingBag size={14}/><span>{order.code} · {order.title}</span><ArrowRight size={15}/></button>)}</div>;
}
