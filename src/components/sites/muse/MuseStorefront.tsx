"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Mail, ShoppingBag, X } from "lucide-react";
import "./muse.css";

type Product = "muse" | "muse-token";
type Dialog = "terms" | "orders" | null;
type Step = "details" | "review" | "payment";

const terms = [
  { title: "仅质保首次登录", body: "不提供后续使用质保。首次登录有问题，请保留订单号和截图联系支持。" },
  { title: "交付邮箱与接码链接", body: "账号邮箱和接码链接发送至收件邮箱，通过接码链接获取登录验证码。" },
  { title: "登录后立即更换邮箱", body: "首次登录成功后，请立即在 Muse 内更换为自己的邮箱，并删除旧邮箱。" },
];
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH || "";
const isPublicDemo = process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true";

export function MuseStorefront() {
  const [product, setProduct] = useState<Product>("muse");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderToken, setOrderToken] = useState("");
  const [orderError, setOrderError] = useState("");

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  function selectProduct(next: Product) {
    setProduct(next);
    setStep("details");
    setError("");
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPublicDemo) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请输入有效的收件邮箱");
      return;
    }
    if (!accepted) {
      setError("请先阅读并同意购买须知");
      return;
    }
    setError("");
    setStep("review");
  }

  function queryOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPublicDemo) return;
    setOrderError(
      orderNumber.trim() && orderToken.trim()
        ? "本地预览未连接原站订单系统，请在原站查询订单。"
        : "请填写订单号和查询口令",
    );
  }

  return (
    <div className="muse-storefront">
      {isPublicDemo && <div className="muse-demo-banner" role="note">非 GPTibo 官方网站。此页面仅供学习展示，不收集信息，也无法下单。</div>}
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
              onClick={() => selectProduct(id)}>
              <Image src={assetBase + "/sites/muse/muse-logo.svg"} width={20} height={20} alt="" />
              {label}
            </button>
          ))}
        </div>
        <button className="muse-orders-link" type="button" onClick={() => { setOrderError(""); setDialog("orders"); }}>
          <ShoppingBag size={16} strokeWidth={1.8} /> <span>我的订单</span>
        </button>
      </header>

      <main className="muse-product-layout" id="muse-product-panel" role="tabpanel" aria-labelledby={`tab-${product}`}>
        <section className="muse-product-stage" aria-label={product === "muse" ? "Muse AI" : "Muse Token"}>
          <div className="muse-stage-halo" />
          <div className="muse-logo-composition">
            <span className="muse-logo-inner"><Image src={assetBase + "/sites/muse/muse-logo.svg"} fill sizes="(max-width: 650px) 158px, 354px" alt="" loading="eager" /></span>
          </div>
          <div className="muse-stage-caption">
            <strong>{product === "muse" ? "Muse AI" : "Muse Token"}</strong>
            <div className="muse-pagination" aria-hidden="true"><i className={product === "muse" ? "active" : ""}/><i className={product === "muse-token" ? "active" : ""}/></div>
          </div>
        </section>

        <section className="muse-checkout-card" aria-label="下单信息">
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
                  <span className="muse-selected-circle"><Check size={12} strokeWidth={2.5}/></span>
                  <div><strong>成品账号</strong><span>1 Billion</span></div>
                </div>
                <div className="muse-plan-price"><span>¥</span>12.00<small>一次购买</small></div>
              </div>
              <div className="muse-email-field">
                <label htmlFor="muse-email">收件邮箱</label>
                <div className={`muse-input-wrap ${error.includes("邮箱") ? "has-error" : ""}`}>
                  <Mail size={16} strokeWidth={1.8}/>
                  {isPublicDemo
                    ? <span className="muse-demo-placeholder">公开预览不接收邮箱</span>
                    : <input id="muse-email" type="email" placeholder="you@example.com" autoComplete="email"
                        value={email} onChange={event => { setEmail(event.target.value); setError(""); }} />}
                </div>
                <p className="muse-field-hint">{isPublicDemo ? "演示页面不会发送账号资料" : "账号资料发送至邮箱"}</p>
              </div>
              <div className="muse-payment-row"><strong>支付方式</strong><span><span className="muse-alipay">支</span> 支付宝 <Check size={15}/></span></div>
              <div className="muse-agreement">
                {isPublicDemo
                  ? <span>仅供学习展示</span>
                  : <label><input type="checkbox" checked={accepted} onChange={event => { setAccepted(event.target.checked); setError(""); }} />
                      <span className="muse-checkbox-art">{accepted && <Check size={12}/>}</span><span>我已阅读并同意</span></label>}
                <button type="button" onClick={() => setDialog("terms")}>购买须知</button>
              </div>
              {error && <p className="muse-error" role="alert">{error}</p>}
              <div className="muse-order-total">
                <div><span>合计</span><small>含 ¥0.18 手续费</small></div>
                <strong><span>¥</span>12.18</strong>
              </div>
              <button className="muse-primary" type="submit" disabled={isPublicDemo}>{isPublicDemo ? "演示页面无法下单" : <>确认订单 <ArrowRight size={16}/></>}</button>
            </form>
          ) : step === "review" ? (
            <div className="muse-review">
              <button className="muse-back" type="button" onClick={() => setStep("details")}><ArrowLeft size={15}/> 返回修改</button>
              <h1>确认订单</h1>
              <p className="muse-subtitle">Muse AI · 成品账号</p>
              <dl><div><dt>商品</dt><dd>Muse AI · 1 Billion</dd></div><div><dt>收件邮箱</dt><dd>{email.trim()}</dd></div><div><dt>支付方式</dt><dd>支付宝</dd></div><div><dt>合计</dt><dd>¥12.18</dd></div></dl>
              <p className="muse-preview-note">本地预览不会创建真实订单或收取费用。</p>
              <button className="muse-primary" type="button" onClick={() => setStep("payment")}>继续 <ArrowRight size={16}/></button>
            </div>
          ) : (
            <div className="muse-review">
              <button className="muse-back" type="button" onClick={() => setStep("review")}><ArrowLeft size={15}/> 返回订单</button>
              <h1>本地预览</h1>
              <p className="muse-subtitle">Muse AI · 成品账号</p>
              <div className="muse-payment-preview">暂未连接支付服务</div>
              <p className="muse-preview-note">此页面仅复刻原站界面。真实购买请前往原站。</p>
              <a className="muse-primary" href="https://muse.gptibo.com/" target="_blank" rel="noopener noreferrer">前往原站 <ArrowRight size={16}/></a>
            </div>
          )}
        </section>
      </main>

      <footer className="muse-footer"><span>© 2026 GPTibo</span><a href="https://t.me/coolkhz" target="_blank" rel="noopener noreferrer">联系支持 ↗</a></footer>

      {dialog && <div className="muse-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}>
        <div className="muse-dialog" role="dialog" aria-modal="true" aria-labelledby="muse-dialog-title">
          <button className="muse-dialog-x" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button>
          {dialog === "terms" ? <>
            <h2 id="muse-dialog-title">购买须知</h2>
            <p className="muse-dialog-subtitle">Muse AI · 成品账号</p>
            <ul className="muse-terms-list">{terms.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
            <button className="muse-primary" type="button" onClick={() => setDialog(null)}>关闭</button>
          </> : <>
            <h2 id="muse-dialog-title">我的订单</h2>
            {isPublicDemo ? <p className="muse-preview-note">公开预览不接收订单信息，也无法查询真实订单。</p> : <form className="muse-order-lookup" onSubmit={queryOrder}>
              <label htmlFor="muse-order-number">订单号</label>
              <input id="muse-order-number" placeholder="填写订单号" value={orderNumber} onChange={event => setOrderNumber(event.target.value)}/>
              <label htmlFor="muse-order-token">查询口令</label>
              <input id="muse-order-token" placeholder="查询凭据中的口令" value={orderToken} onChange={event => setOrderToken(event.target.value)}/>
              <p>查询口令见已下载的查询凭据。</p>
              {orderError && <p className="muse-error" role="alert">{orderError}</p>}
              <button className="muse-primary" type="submit">查询订单 <ArrowRight size={16}/></button>
            </form>}
          </>}
        </div>
      </div>}
    </div>
  );
}
