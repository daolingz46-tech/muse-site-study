"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Mail, MessageCircle, ShoppingBag, X } from "lucide-react";
import { OrderPayment, PurchaseNotice, RecentOrders, type DemoOrder, type DemoStatus } from "./OrderFlow";
import "./muse.css";

type Product = "muse" | "muse-token";
type Dialog = "terms" | "orders" | null;
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
  const notify = useCallback((message: string) => setNotification(message), []);

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
    setError("");
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请输入有效的收件邮箱");
      return;
    }
    if (!accepted) {
      setError("请先阅读并同意购买须知");
      return;
    }
    setError("");
    setStep("notice");
  }

  function createDemoOrder() {
    const order: DemoOrder = { id: `DEMO-${crypto.randomUUID()}`, token: crypto.randomUUID(), email: email.trim(), method: paymentMethod, expiresAt: Date.now() + 15 * 60 * 1000, status: "pending" };
    setOrders(previous => [order, ...previous]);
    setActiveOrder(order);
    setStep("payment");
  }

  function openOrder(order: DemoOrder) {
    setActiveOrder(order);
    setProduct("muse");
    setStep("payment");
    setDialog(null);
    setOrderError("");
  }

  function changeOrderStatus(status: DemoStatus) {
    if (!activeOrder) return;
    const updated = { ...activeOrder, status };
    setActiveOrder(updated);
    setOrders(previous => previous.map(order => order.id === updated.id ? updated : order));
  }

  function queryOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <Link className="muse-wordmark" href="/" aria-label="GPTibo 首页">
          <Image src={assetBase + "/sites/muse/favicon.svg"} width={29} height={29} alt="" />
          <span>GPTibo<span className="muse-wordmark-dot">.</span></span>
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
          {product === "muse-token" ? (
            <div className="muse-token-card">
              <h1>Muse Token</h1>
              <dl><div><dt>规格</dt><dd>待定</dd></div><div><dt>售价</dt><dd>待定</dd></div></dl>
              <button className="muse-primary" type="button" disabled>暂未开售</button>
            </div>
          ) : step === "details" ? (
            <form onSubmit={submitDetails} noValidate>
              <h1>Muse AI</h1>
              <p className="muse-subtitle">成品账号</p>
              <div className="muse-selected-plan">
                <div className="muse-plan-description">
                  <span className="muse-selected-circle"><Check size={12} strokeWidth={3}/></span>
                  <div><strong>成品账号</strong><span>1 Billion</span></div>
                </div>
                <div className="muse-plan-price"><span>¥</span>12.00<small>一次购买</small></div>
              </div>
              <div className="muse-email-field">
                <label htmlFor="muse-email">收件邮箱</label>
                <div className={`muse-input-wrap ${error.includes("邮箱") ? "has-error" : ""}`}>
                  <Mail size={17}/>
                  <input id="muse-email" type="email" placeholder="you@example.com" autoComplete="off" maxLength={254}
                    value={email} onChange={event => { setEmail(event.target.value); setError(""); }} />
                </div>
                <p className="muse-field-hint">账号资料发送至邮箱</p>
              </div>
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
                <div><span>合计</span><small>含 ¥0.18 手续费</small></div>
                <strong><span>¥</span>12.18</strong>
              </div>
              <button className="muse-primary" type="submit">确认订单 <ArrowRight size={17}/></button>
            </form>
          ) : step === "notice" ? <PurchaseNotice terms={terms} onBack={() => setStep("details")} onContinue={createDemoOrder}/> : activeOrder ? <OrderPayment key={activeOrder.id} order={activeOrder} onBack={() => setStep("details")} onNotify={notify} onStatusChange={changeOrderStatus}/> : null}
          </div>
          </div>
        </section>
      </main>

      <footer className="muse-footer"><span>© 2026 GPTibo</span><a href="https://t.me/coolkhz" target="_blank" rel="noopener noreferrer">联系支持 <ArrowUpRight size={12}/></a></footer>

      {dialog && <dialog ref={dialogRef} className="muse-dialog" aria-labelledby="muse-dialog-title" onCancel={() => setDialog(null)} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDialog(null);
      }}>
          <button className="muse-dialog-x" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button>
          {dialog === "terms" ? <>
            <h2 id="muse-dialog-title">购买须知</h2>
            <p className="muse-dialog-subtitle">Muse AI · 成品账号</p>
            <ul className="muse-terms-list">{terms.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
            <button className="muse-primary" type="button" onClick={() => setDialog(null)}>关闭</button>
          </> : <>
            <h2 id="muse-dialog-title">我的订单</h2>
            <form className="muse-order-lookup" onSubmit={queryOrder}>
              <label htmlFor="muse-order-number">订单号</label>
              <input id="muse-order-number" placeholder="填写订单号" maxLength={64} autoComplete="off" value={orderNumber} onChange={event => setOrderNumber(event.target.value)}/>
              <label htmlFor="muse-order-token">查询口令</label>
              <input id="muse-order-token" type="password" placeholder="查询凭据中的口令" maxLength={64} autoComplete="off" value={orderToken} onChange={event => setOrderToken(event.target.value)}/>
              <p>查询口令见已下载的查询凭据。</p>
              {orderError && <p className="muse-error" role="alert">{orderError}</p>}
              <button className="muse-primary" type="submit">查询订单 <ArrowRight size={16}/></button>
            </form>
            <RecentOrders orders={orders} onOpen={openOrder}/>
          </>}
      </dialog>}
      {notification && <div className="muse-toast" role="status">{notification}</div>}
    </div>
  );
}
