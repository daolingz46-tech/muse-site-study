"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Mail, MessageCircle, ShoppingBag, Ticket, X } from "lucide-react";
import { OrderPayment, PurchaseNotice, RecentOrders, type DemoOrder, type DemoStatus } from "./OrderFlow";
import { accountPriceCents, formatMoney, storeName, supportQQ, tokenPlans, tokenTerms, type OrderDetails } from "./catalog";
import { createStoreOrder, lookupStoreOrder } from "./store-api";
import "./muse.css";

type Product = "muse" | "muse-token";
type Dialog = "terms" | "orders" | "support" | null;
type Step = "details" | "notice" | "payment";
type PaymentMethod = "alipay" | "wechat";

const terms = [
  { title: "仅质保首次登录", body: "不提供后续使用质保。首次登录有问题，请保留订单号和截图联系支持。" },
  { title: "交付邮箱与接码链接", body: "账号发送至收件邮箱，通过接码链接获取登录验证码或者密码登录。" },
  { title: "登录后立即更换邮箱", body: "首次登录成功后，请立即在 Muse 内更换为自己的邮箱，并删除旧邮箱。" },
];
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH || "";
const isPublicDemo = process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true";

export function MuseStorefront() {
  const [product, setProduct] = useState<Product>("muse");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [tokenPlanId, setTokenPlanId] = useState<string>(tokenPlans[0].id);
  const selectedTokenPlan = tokenPlans.find(plan => plan.id === tokenPlanId) || tokenPlans[0];
  const isToken = product === "muse-token";
  const productTitle = isToken ? `Muse Token · ${selectedTokenPlan.label}` : "Muse AI · 成品账号";
  const purchaseTerms = isToken ? tokenTerms : terms;
  const amountCents = isToken ? selectedTokenPlan.amountCents : accountPriceCents;
  const feeCents = 0;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("alipay");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderToken, setOrderToken] = useState("");
  const [orderError, setOrderError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const [checkoutHeight, setCheckoutHeight] = useState<number>();
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [activeOrder, setActiveOrder] = useState<DemoOrder | null>(null);
  const [notification, setNotification] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [queryingOrder, setQueryingOrder] = useState(false);
  const orderRequestRef = useRef("");
  const notify = useCallback((message: string) => setNotification(message), []);
  const updateOrder = useCallback((order: DemoOrder) => {
    setActiveOrder(current => current?.id === order.id ? order : current);
    setOrders(previous => previous.map(item => item.id === order.id ? order : item));
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    const content = checkoutRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      setCheckoutHeight(Math.round(content.getBoundingClientRect().height));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.showModal();
  }, [dialog]);

  function selectProduct(next: Product) {
    setProduct(next);
    setStep("details");
    setAccepted(false);
    setError("");
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isToken && !inviteCode.trim()) {
      setError("请填写需要充值的账号邀请码");
      document.getElementById("muse-invite-code")?.focus();
      return;
    }
    if (!isToken && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请输入有效的收件邮箱");
      return;
    }
    if (!accepted) {
      setError("请先阅读并同意购买须知");
      return;
    }
    setError("");
    orderRequestRef.current = "";
    setStep("notice");
  }

  async function createOrder() {
    if (creatingOrder) return;
    if (!isPublicDemo) {
      setCreatingOrder(true);
      setError("");
      orderRequestRef.current ||= crypto.randomUUID();
      try {
        const order = await createStoreOrder({ product, planId: isToken ? tokenPlanId : undefined,
          email: isToken ? undefined : email.trim(), inviteCode: isToken ? inviteCode.trim() : undefined,
          method: paymentMethod, acceptedTerms: true }, orderRequestRef.current);
        setOrders(previous => [order, ...previous.filter(item => item.id !== order.id)]);
        setActiveOrder(order);
        setStep("payment");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "创建订单失败，请联系支持。"); }
      finally { setCreatingOrder(false); }
      return;
    }
    const details: OrderDetails = isToken
      ? { product: "muse-token", title: productTitle, amountCents, feeCents, inviteCode: inviteCode.trim() }
      : { product: "muse", title: productTitle, amountCents, feeCents, email: email.trim() };
    const order: DemoOrder = { ...details, id: `DEMO-${crypto.randomUUID()}`, token: crypto.randomUUID(), method: paymentMethod, expiresAt: Date.now() + 15 * 60 * 1000, status: "pending" };
    setOrders(previous => [order, ...previous]);
    setActiveOrder(order);
    setStep("payment");
  }

  function openOrder(order: DemoOrder) {
    setActiveOrder(order);
    setProduct(order.product);
    setPaymentMethod(order.method);
    if (order.product === "muse-token") {
      setInviteCode(order.inviteCode);
      setTokenPlanId(tokenPlans.find(plan => plan.amountCents === order.amountCents)?.id || tokenPlans[0].id);
    } else {
      setEmail(order.email);
    }
    setStep("payment");
    setDialog(null);
    setOrderError("");
  }

  function changeOrderStatus(status: DemoStatus) {
    if (!isPublicDemo || !activeOrder) return;
    const updated = { ...activeOrder, status };
    setActiveOrder(updated);
    setOrders(previous => previous.map(order => order.id === updated.id ? updated : order));
  }

  async function queryOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPublicDemo) {
      if (!orderNumber.trim() || !orderToken.trim()) { setOrderError("请填写订单号和查询口令"); return; }
      if (queryingOrder) return;
      setQueryingOrder(true);
      setOrderError("");
      try { openOrder(await lookupStoreOrder(orderNumber.trim(), orderToken.trim())); }
      catch (cause) { setOrderError(cause instanceof Error ? cause.message : "订单查询失败，请联系支持。"); }
      finally { setQueryingOrder(false); }
      return;
    }
    const found = orders.find(order => order.id === orderNumber.trim() && order.token === orderToken.trim());
    if (found) { openOrder(found); return; }
    setOrderError(
      orderNumber.trim() && orderToken.trim()
        ? "未找到匹配的演示订单。请检查查询凭据；仅支持当前页面创建的订单。"
        : "请填写订单号和查询口令",
    );
  }

  return (
    <div className="muse-storefront">
      {isPublicDemo && <div className="muse-demo-banner" role="note">非 GPTibo 官方网站，仅供学习。请使用测试信息；输入仅在当前页面演示，不上传、不保存，不支持真实付款。</div>}
      <header className="muse-header">
        <Link className="muse-wordmark" href="/" aria-label={isPublicDemo ? "GPTibo 首页" : `${storeName}首页`}>
          <Image src={assetBase + "/sites/muse/favicon.svg"} width={29} height={29} alt="" />
          <span>{isPublicDemo ? <>GPTibo<span className="muse-wordmark-dot">.</span></> : storeName}</span>
        </Link>
        <div className="muse-switch" role="tablist" aria-label="商品">
          <span className={`muse-switch-indicator ${product === "muse-token" ? "is-token" : ""}`} />
          {([["muse", "Muse AI"], ["muse-token", "Muse Token"]] as const).map(([id, label]) => (
            <button key={id} id={`tab-${id}`} type="button" role="tab"
              aria-selected={product === id} aria-controls="muse-product-panel"
              tabIndex={product === id ? 0 : -1}
              onKeyDown={event => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const next = event.key === "Home" ? "muse" : event.key === "End" ? "muse-token" : product === "muse" ? "muse-token" : "muse";
                  selectProduct(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              onClick={() => selectProduct(id)}>
              <Image src={assetBase + "/sites/muse/muse-logo.svg"} width={20} height={20} alt="" />
              {label}
            </button>
          ))}
        </div>
        <button className="muse-orders-link" type="button" onClick={() => { setOrderError(""); setDialog("orders"); }}>
          <ShoppingBag size={16} /> <span>我的订单</span>
        </button>
      </header>

      <main className="muse-product-layout" id="muse-product-panel" role="tabpanel" aria-labelledby={`tab-${product}`}>
        <section className="muse-product-stage" aria-label={product === "muse" ? "Muse AI" : "Muse Token"}>
          <div className="muse-stage-halo" />
          <div className="muse-logo-composition">
            <span className="muse-logo-inner"><Image src={assetBase + "/sites/muse/muse-logo.svg"} fill sizes="(max-width: 650px) 158px, 354px" alt="" loading="eager" /></span>
          </div>
          <div className="muse-stage-caption" key={product}>
            <strong>{product === "muse" ? "Muse AI" : "Muse Token"}</strong>
          </div>
          <div className="muse-pagination" aria-hidden="true"><i className={product === "muse" ? "active" : ""}/><i className={product === "muse-token" ? "active" : ""}/></div>
        </section>

        <section className="muse-checkout-card" aria-label="下单信息">
          <div className="muse-checkout-viewport" style={{ height: checkoutHeight }}>
          <div ref={checkoutRef} className="muse-checkout-content">
          {step === "details" ? (
            <form onSubmit={submitDetails} noValidate>
              <h1>{isToken ? "Muse Token" : "Muse AI"}</h1>
              <p className="muse-subtitle">{isToken ? "Token 充值 · 不含账号" : "成品账号"}</p>
              {isToken ? <>
                <fieldset className="muse-token-plans">
                  <legend className="sr-only">充值档次</legend>
                  {tokenPlans.map(plan => <label key={plan.id} className={tokenPlanId === plan.id ? "is-selected" : ""}>
                    <input type="radio" name="token-plan" value={plan.id} checked={tokenPlanId === plan.id} onChange={() => { setTokenPlanId(plan.id); setError(""); }}/>
                    <span className="muse-token-plan-name">{plan.label}</span>
                    <strong><span>¥</span>{plan.amountCents / 100}</strong>
                    <span className="muse-token-plan-check" aria-hidden="true">{tokenPlanId === plan.id && <Check size={11}/>}</span>
                  </label>)}
                </fieldset>
                <div className="muse-token-notice"><strong>需已有 Muse 账号</strong><p>填写账号邀请码即可充值，不包含账号。支付后 10 分钟内到账，拥挤时可能需要 30 分钟。</p></div>
                <div className="muse-email-field muse-invite-field">
                  <label htmlFor="muse-invite-code">账号邀请码 <span className="muse-required-badge">* 必填</span></label>
                  <div className={`muse-input-wrap ${error.includes("邀请码") ? "has-error" : ""}`}><Ticket size={17}/><input id="muse-invite-code" placeholder="必填：请输入需要充值的账号邀请码" required aria-invalid={error.includes("邀请码")} aria-describedby="muse-invite-hint" autoComplete="off" maxLength={128} spellCheck={false} value={inviteCode} onChange={event => { setInviteCode(event.target.value); setError(""); }}/></div>
                  <p className="muse-field-hint" id="muse-invite-hint">请务必填写并核对邀请码，Token 将充值到对应账号</p>
                </div>
              </> : <><div className="muse-selected-plan">
                <div className="muse-plan-description">
                  <span className="muse-selected-circle"><Check size={12} strokeWidth={3}/></span>
                  <div><strong>成品账号</strong><span>1 Billion</span></div>
                </div>
                <div className="muse-plan-price"><span>¥</span>{formatMoney(accountPriceCents)}<small>一次购买</small></div>
              </div>
              <div className="muse-email-field">
                <label htmlFor="muse-email">收件邮箱</label>
                <div className={`muse-input-wrap ${error.includes("邮箱") ? "has-error" : ""}`}>
                  <Mail size={17}/>
                  <input id="muse-email" type="email" placeholder="you@example.com" autoComplete="off" maxLength={254}
                    value={email} onChange={event => { setEmail(event.target.value); setError(""); }} />
                </div>
                <p className="muse-field-hint">账号资料发送至邮箱</p>
              </div></>}
              <div className="muse-payment-row">
                <label htmlFor="muse-payment-method">支付方式</label>
                <div className="muse-payment-select">
                  {paymentMethod === "alipay" ? <span className="muse-alipay" aria-hidden="true">支</span> : <span className="muse-wechat" aria-hidden="true"><MessageCircle size={14}/></span>}
                  <select id="muse-payment-method" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>
                    <option value="alipay">支付宝</option>
                    <option value="wechat">微信支付</option>
                  </select>
                  <ChevronDown size={15} aria-hidden="true"/>
                </div>
              </div>
              <div className="muse-agreement">
                <label><input type="checkbox" checked={accepted} onChange={event => { setAccepted(event.target.checked); setError(""); }} />
                  <span className="muse-checkbox-art">{accepted && <Check size={11} strokeWidth={3}/>}</span><span>我已阅读并同意</span></label>
                <button type="button" onClick={() => setDialog("terms")}>购买须知</button>
              </div>
              {error && <p className="muse-error" role="alert">{error}</p>}
              <div className="muse-order-total">
                <div><span>合计</span><small>{isToken ? "仅充值 Token，不含账号" : "成品账号，一次购买"}</small></div>
                <strong><span>¥</span>{formatMoney(amountCents + feeCents)}</strong>
              </div>
              <button className="muse-primary" type="submit">确认订单 <ArrowRight size={17}/></button>
            </form>
          ) : step === "notice" ? <PurchaseNotice title={productTitle} terms={purchaseTerms} busy={creatingOrder} error={error} onBack={() => setStep("details")} onContinue={createOrder}/> : activeOrder ? <OrderPayment key={activeOrder.id} order={activeOrder} onBack={() => setStep("details")} onNotify={notify} onStatusChange={changeOrderStatus} onOrderUpdate={updateOrder}/> : null}
          </div>
          </div>
        </section>
      </main>

      <footer className="muse-footer"><span>© 2026 {isPublicDemo ? "GPTibo" : storeName}</span><button className="muse-support-link" type="button" onClick={() => setDialog("support")}>联系支持 · QQ：{supportQQ} <ArrowUpRight size={12}/></button></footer>

      {dialog && <dialog ref={dialogRef} className="muse-dialog" aria-labelledby="muse-dialog-title" onCancel={() => setDialog(null)} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDialog(null);
      }}>
          <button className="muse-dialog-x" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button>
          {dialog === "terms" ? <>
            <h2 id="muse-dialog-title">购买须知</h2>
            <p className="muse-dialog-subtitle">{productTitle}</p>
            <ul className="muse-terms-list">{purchaseTerms.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
            <button className="muse-primary" type="button" onClick={() => setDialog(null)}>关闭</button>
          </> : dialog === "support" ? <>
            <h2 id="muse-dialog-title">联系支持</h2>
            <p className="muse-dialog-subtitle">复制 QQ 号，在 QQ 中搜索添加</p>
            <p className="muse-support-number">QQ：{supportQQ}</p>
            <button className="muse-primary" type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(supportQQ); setDialog(null); notify("QQ 号已复制"); }
              catch { notify("请选中 QQ 号手动复制"); }
            }}>复制 QQ 号</button>
          </> : <>
            <h2 id="muse-dialog-title">我的订单</h2>
            <form className="muse-order-lookup" onSubmit={queryOrder}>
              <label htmlFor="muse-order-number">订单号</label>
              <input id="muse-order-number" placeholder="填写订单号" maxLength={64} autoComplete="off" value={orderNumber} onChange={event => setOrderNumber(event.target.value)}/>
              <label htmlFor="muse-order-token">查询口令</label>
              <input id="muse-order-token" type="password" placeholder="查询凭据中的口令" maxLength={64} autoComplete="off" value={orderToken} onChange={event => setOrderToken(event.target.value)}/>
              <p>查询口令见已下载的查询凭据。</p>
              {orderError && <p className="muse-error" role="alert">{orderError}</p>}
              <button className="muse-primary" type="submit" disabled={queryingOrder}>{queryingOrder ? "查询中…" : "查询订单"} <ArrowRight size={16}/></button>
            </form>
            <RecentOrders orders={orders} onOpen={openOrder}/>
          </>}
      </dialog>}
      {notification && <div className="muse-toast" role="status">{notification}</div>}
    </div>
  );
}
