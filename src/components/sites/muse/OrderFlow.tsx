"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Clock3, Copy, Download, Mail, QrCode, RefreshCw, ShoppingBag } from "lucide-react";
import { formatMoney, type OrderDetails } from "./catalog";

export type DemoOrder = OrderDetails & {
  id: string;
  token: string;
  method: "alipay" | "wechat";
  expiresAt: number;
  status: DemoStatus;
};
export type DemoStatus = "pending" | "processing" | "complete" | "expired";
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function PurchaseNotice({ onBack, onContinue, terms, title }: {
  onBack: () => void;
  onContinue: () => void;
  terms: ReadonlyArray<{ title: string; body: string }>;
  title: string;
}) {
  const [seconds, setSeconds] = useState(5);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.max(0, 5 - Math.floor((Date.now() - startedAt) / 1000))), 200);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="muse-notice muse-step">
    <button className="muse-back" type="button" onClick={onBack}><ArrowLeft size={15}/> 返回修改</button>
    <h1>购买须知</h1>
    <p className="muse-subtitle">{title}</p>
    <ul className="muse-terms-list">{terms.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
    <div className="muse-notice-agreement muse-agreement">
      <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span className="muse-checkbox-art">{accepted && <Check size={11} strokeWidth={3}/>}</span><span>我已阅读并同意以上购买须知</span></label>
    </div>
    <button className="muse-primary muse-notice-continue" type="button" disabled={seconds > 0 || !accepted} onClick={onContinue}>继续下单{seconds > 0 ? ` · ${seconds}s` : ""} <ArrowRight size={16}/></button>
  </div>;
}

export function OrderPayment({ order, onBack, onNotify, onStatusChange }: {
  order: DemoOrder;
  onBack: () => void;
  onNotify: (message: string) => void;
  onStatusChange: (status: DemoStatus) => void;
}) {
  const [remaining, setRemaining] = useState(900);
  const status = order.status;
  const [refreshing, setRefreshing] = useState(false);
  const label = order.method === "alipay" ? "支付宝" : "微信";
  const isToken = order.product === "muse-token";
  const total = formatMoney(order.amountCents + order.feeCents);
  const expired = status === "expired" || (status === "pending" && remaining === 0);
  const countdown = `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [order.expiresAt]);

  useEffect(() => {
    if (!refreshing) return;
    const timer = window.setTimeout(() => {
      setRefreshing(false);
      onNotify("演示订单状态已刷新；未连接真实支付服务");
    }, 400);
    return () => window.clearTimeout(timer);
  }, [refreshing, onNotify]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      onNotify("已复制");
    } catch {
      onNotify("浏览器未允许复制，请选中文字手动复制");
    }
  }

  function downloadCredentials() {
    const target = order.product === "muse-token" ? `账号邀请码：${order.inviteCode}` : `收件邮箱：${order.email}`;
    const text = ["Muse 页面学习项目 · 演示查询凭据", "不是真实订单，不可用于原站查询或付款。", `订单号：${order.id}`, `查询口令：${order.token}`, `商品：${order.title}`, target, `合计：¥${total}`, "仅当前页面保留演示订单，刷新页面后清空。"].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `muse-demo-${order.id}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify("查询凭据已下载");
  }

  return <div className="muse-order-stage muse-step">
    <button className="muse-back" type="button" onClick={onBack}><ArrowLeft size={15}/> 返回修改</button>
    {status === "pending" && !expired ? <>
      <div className="muse-payment-summary"><h1>支付订单</h1><p>{order.title}</p><div className="muse-payment-amount"><span>¥</span><strong>{total}</strong></div></div>
      <div className="muse-scan-panel">
        <div className="muse-demo-qr"><Image src={assetBase + "/sites/muse/demo-qr.svg"} width={240} height={240} alt="演示二维码，不可付款"/><span>DEMO</span></div>
        <p className="muse-scan-hint"><span className={order.method === "alipay" ? "muse-alipay" : "muse-wechat"}>{order.method === "alipay" ? "支" : "微"}</span> 使用{label}扫码支付</p>
        <p className="muse-qr-disclosure">示例码，仅展示界面，无法付款</p>
        <div className="muse-payment-countdown" data-tone={remaining < 60 ? "urgent" : remaining < 180 ? "warning" : "normal"}><Clock3 size={15}/> 剩余支付时间 <strong>{countdown}</strong></div>
      </div>
    </> : <div className="muse-order-status">
      <div className={`muse-status-icon ${expired ? "is-expired" : status === "processing" ? "is-processing" : "is-success"}`}>{expired ? <Clock3/> : status === "processing" ? <RefreshCw/> : <CircleCheck/>}</div>
      <h1>{expired ? "订单已超时" : status === "processing" ? (isToken ? "支付成功，充值处理中" : "支付成功，正在交付") : (isToken ? "充值完成" : "交付完成")}</h1>
      <p>{expired ? "支付时间已结束，请返回重新下单。" : isToken ? (status === "processing" ? "10 分钟内到账，拥挤时可能需要 30 分钟。" : "请前往对应账号查看 Token 余额。") : status === "processing" ? "正在准备账号资料，请稍后刷新查看。" : "账号资料已准备就绪。"}</p>
      <p className="muse-state-disclosure">演示状态，不代表真实收款或发货</p>
    </div>}

    {status === "complete" && !expired && order.product === "muse" && <>
      <div className="muse-delivery-email"><Mail size={19}/><div><span>收件邮箱（演示，未发送邮件）</span><strong>{order.email}</strong></div></div>
      <div className="muse-delivery-fields">{[["账号邮箱", "demo-account@example.invalid"], ["密码", "DEMO-NOT-A-REAL-ACCOUNT"], ["接码链接", "https://example.invalid/demo"]].map(([name, value]) => <div key={name}><span>{name}</span><div><code>{value}</code><button type="button" aria-label={`复制${name}`} onClick={() => void copy(value)}><Copy size={14}/></button></div></div>)}</div>
    </>}

    <dl className="muse-payment-details">
      <div><dt>订单号</dt><dd>{order.id}</dd></div>
      <div><dt>商品</dt><dd>{order.title}</dd></div>
      {order.product === "muse-token" ? <><div><dt>账号邀请码</dt><dd>{order.inviteCode}</dd></div><div><dt>到账时间</dt><dd>10 分钟内，拥挤时可能需 30 分钟</dd></div><div><dt>账号</dt><dd>不包含，需自备账号</dd></div></> : <div><dt>收件邮箱</dt><dd>{order.email}</dd></div>}
      <div><dt>支付方式</dt><dd>{order.method === "alipay" ? "支付宝" : "微信支付"}</dd></div>
      {order.feeCents > 0 && <div><dt>手续费</dt><dd>¥{formatMoney(order.feeCents)}</dd></div>}
      <div><dt>合计</dt><dd>¥{total}</dd></div>
    </dl>
    <div className="muse-order-actions"><button type="button" onClick={downloadCredentials}><Download size={15}/> 下载查询凭据</button><button type="button" onClick={() => void copy(order.id)}><Copy size={15}/> 复制订单号</button></div>
    <div className="muse-order-tools"><button type="button" disabled={refreshing} onClick={() => setRefreshing(true)}><RefreshCw size={14} className={refreshing ? "muse-spin" : undefined}/> {refreshing ? "刷新中…" : "刷新状态"}</button></div>
    {expired && <button className="muse-primary" type="button" onClick={onBack}>重新下单 <ArrowRight size={16}/></button>}
    <p className="muse-order-footnote">请保存查询凭据，便于重新打开本次演示订单。</p>
    <details className="muse-demo-states"><summary><QrCode size={13}/> 演示其他订单状态</summary><div>{([ ["pending", "待付款"], ["processing", "交付中"], ["complete", "交付完成"], ["expired", "已超时"] ] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => onStatusChange(value)}>{text}</button>)}</div></details>
  </div>;
}

export function RecentOrders({ orders, onOpen }: { orders: DemoOrder[]; onOpen: (order: DemoOrder) => void }) {
  if (!orders.length) return null;
  return <div className="muse-saved-orders"><h3>本机订单（本次演示）</h3>{orders.map(order => <button key={order.id} type="button" onClick={() => onOpen(order)}><ShoppingBag size={14}/><span>{order.id}</span><ArrowRight size={15}/></button>)}</div>;
}
