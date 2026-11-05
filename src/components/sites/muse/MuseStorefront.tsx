"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Mail, MessageCircle, ShoppingBag, Ticket, X } from "lucide-react";
import { OrderPayment, PurchaseNotice, RecentOrders, orderLink, type StoreOrder } from "./OrderFlow";
import { accountPriceCents, accountTitle, formatMoney, storeName, supportQQ, tokenPlans, tokenTerms } from "./catalog";
import { createStoreOrder, lookupStoreOrder, findStoreOrder, storeApiUrl, type OrderSummary } from "./store-api";
import { importSavedOrders, readSavedOrders, saveOrder, type SavedOrder } from "./saved-orders";
import { isDirectVisit, rememberReferral, storedReferralCode } from "./referral";
import "./muse.css";

type Product = "muse" | "muse-token" | "gpt" | "mail" | "gmail";
type Dialog = "terms" | "orders" | "support" | "request" | null;
type Step = "details" | "notice" | "payment";
type PaymentMethod = "alipay" | "wechat";

const terms = [
  { title: "7 天质保", body: "7 天内封号，可以免费换号；请在 8 小时内首次登录验证。有问题请保留订单号和截图联系支持。" },
  { title: "商品内容", body: `${formatMoney(accountPriceCents)} 元包含 1 个 Muse AI 成品账号及该账号的 10 亿 Token，无需另购此额度。` },
  { title: "邮箱交付", body: "店主确认收款后准备成品账号卡密，发送到你填写的邮箱，请核对邮箱地址。" },
  { title: "登录后立即更换邮箱", body: "登录需使用美国 IP；首次登录成功后，请立即在 Muse 内更换为自己的邮箱，并删除旧邮箱。" },
];
const assetBase = process.env.NEXT_PUBLIC_BASE_PATH || "";
const canonicalStore = "https://musetoken.store/";
const gptPlans = [
  { id: "halfPriceAccountOneMonth", label: "1个月半价资格账号", amountCents: 1500, type: "资格", details: ["资格期限：1个月，不是45天", "不含 Plus 订阅", "可换绑邮箱", "1 小时内首次登录质保"] },
  { id: "halfPriceTopup", label: "一个月半价代充", amountCents: 7500, type: "代充", details: ["需已有半价资格，账号须为 Free", "菲律宾渠道 · 一个月 Plus", "订阅 30 天质保（不保封号）"] },
  { id: "philippinesTopup", label: "GPT Plus 代充", amountCents: 12800, type: "代充", details: ["正规代充", "订阅质保按货源规则处理", "账号须为 Free 状态"] },
  { id: "plusAccount", label: "Plus 成品账号", amountCents: 4000, type: "成品", details: ["账号、密码及 2FA", "购买后 20 分钟内兑换并检查", "仅保首次登录，售后时限请核对"] },
  { id: "vietnamPlus30", label: "越南实卡 Plus · 30 天质保", amountCents: 9500, type: "成品", details: ["个人独享 · 已开通 Plus", "越南实卡 · 30 天质保", "一次性邮箱无法找回", "货源采购后 1 小时内修改 2FA"] },
  { id: "plus15Day", label: "Plus 老号 · 15 天质保", amountCents: 6900, type: "成品", details: ["标称带 2 张重置卡，数量以实际为准", "剩余有效期约 20–26 天", "供货商提供 15 天质保", "勿换绑、改密码或 2FA"] },
  { id: "freeAccount", label: "GPT 白号 · 可换绑", amountCents: 500, type: "白号", details: ["Free 空账号，不含 Plus", "没有半价资格", "可换绑邮箱", "1 小时内首次登录质保"] },
] as const;

export function MuseStorefront({ initialProduct = "muse" }: { initialProduct?: Product }) {
  const [product, setProduct] = useState<Product>(initialProduct);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [tokenPlanId, setTokenPlanId] = useState<string>(tokenPlans[0].id);
  const [musePlanId, setMusePlanId] = useState<"basic" | "warranty">("warranty");
  const [gptPlanId, setGptPlanId] = useState<string>(gptPlans[0].id);
  const [customProducts,setCustomProducts]=useState<{id:string;title:string;category:string;description:string;priceCents:number}[]>([]);
  useEffect(()=>{let active=true;const load=()=>fetch(storeApiUrl("/api/catalog/custom"),{cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(active && Array.isArray(data?.items))setCustomProducts(data.items)}).catch(()=>{});void load();const timer=window.setInterval(load,30000);return()=>{active=false;window.clearInterval(timer)};},[]);
  const [eligibleConfirmed, setEligibleConfirmed] = useState(false);
  const [stock, setStock] = useState<Record<string, boolean | null>>({});
  const [requestText, setRequestText] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const requestId = useRef("");
  const customProduct = customProducts.find(item => `custom:${item.id}` === gptPlanId);
  const gptPlan = gptPlans.find(plan => plan.id === gptPlanId) || gptPlans[0];
  const selectedTokenPlan = tokenPlans.find(plan => plan.id === tokenPlanId) || tokenPlans[0];
  const isToken = product === "muse-token";
  const productTitle = product === "gmail" ? "Gmail · 谷歌邮箱成品号" : product === "mail" ? "Mail.com · 邮箱账号" : product === "gpt" ? (customProduct?.title || `GPT · ${gptPlan.label}`) : isToken ? `Muse Token · ${selectedTokenPlan.label}` : accountTitle;
  const purchaseTerms = product === "gpt" && customProduct ? [{title:"商品说明",body:customProduct.description},{title:"交付方式",body:"核实收款后通过邮箱交付，请仔细核对收件邮箱。"}] : product === "gmail" ? [{title:"商品内容",body:"Gmail 邮箱成品号，仅保障邮箱收件正常。注册时间及地区以实际账号为准。"},{title:"首次登录及售后",body:"请收到后尽快检查。部分货源要求采购后 5 分钟内检查，登录后不售后；库存账号交付时该期限可能已经结束。请妥善更新账号安全资料，如有问题及时联系店主。"}] : product === "mail" ? [{title:"商品内容",body:"Mail.com 邮箱账号，交付内容为邮箱与密码；请先确认你会使用 Mail.com 邮箱。"},{title:"交付与售后",body:"核实收款后通过邮件交付；若库存暂时不足，店主将联系你安排人工发货或售后。"}] : product === "gpt" ? gptPlanId === "vietnamPlus30" ? [{title:"商品内容",body:"越南实卡 Plus 个人独享成品号，已开通订阅，供货商提供 30 天质保。账号为一次性邮箱注册，邮箱无法用于后续找回或修改操作。"},{title:"质保与注意事项",body:"质保期间符合规则的掉线或封号按货源规则处理。供货商对免费换号及第 7 天界限的文字存在不同表述，具体以售后核实为准；禁止使用反代。账号不含接码，需自行接码。"},{title:"首次使用",body:"按货源要求在货源采购后 1 小时内修改 2FA，并在账号安全设置中移除其他设备会话。库存账号交付时该时限可能已过，请及时联系店主核实。如遇邮箱验证或无法修改，请不要退出账号，及时联系店主。"}] : gptPlanId === "freeAccount" ? [{title:"商品内容",body:"GPT Free 白号，未开通 Plus，也没有半价资格；支持换绑邮箱。账号、密码及双重验证信息将发至收件邮箱。"},{title:"使用与售后",body:"请在收到后 1 小时内首次登录检查。此商品不含接码服务，如有问题请联系店主。"}] : gptPlanId === "plus15Day" ? [{ title: "账号有效期", body: "Plus 老号，供货商说明剩余有效期约 20–26 天，实际以账号显示为准；标称带 2 张重置卡；供货商说明部分账号的重置次数以实际库存为准，续费不保证。" }, { title: "质保与操作限制", body: "供货商提供 15 天质保，质保期内账号失效按其规则处理；无库存可补时可能按剩余质保天数退款。请勿换绑、修改密码或 2FA，否则不再提供质保。" }, { title: "首次登录与使用", body: "供货商说明：发货后 1 小时内首次登录失效可免费更换；使用 1 天内出现降智可申请更换一次，更换后效果不保证。" }, { title: "售后联系", body: "供货商售后时间 11:00–23:00；请联系 692972690@qq.com 咨询处理。" }] : gptPlanId === "plusAccount" ? [{ title: "成品账号", body: "交付账号、密码和 2FA。订阅剩余时间以账号实际显示为准。" }, { title: "时效与售后", body: "请在购买后 20 分钟内完成兑换并检查首次登录。货源说明仅处理首次无法登录的问题；对 20 分钟与 30 分钟时限的表述不一致，请以更短的 20 分钟为准并及时联系售后确认。" }, { title: "售后联系", body: "如有首次登录问题，请直接联系货源商邮箱 692972690@qq.com，保留北京时间和登录过程录屏。" }] : gptPlanId === "halfPriceAccountOneMonth" ? [{ title: "商品内容", body: "半价资格期限为 1 个月，不是 45 天；账号可更换绑定邮箱。本商品不包含 Plus 订阅，需另行充值。请在 1 小时内首次登录检查；优惠需在电脑端查看。" }, { title: "交付方式", body: "店主核实收款后通过邮箱发送账号资料，请仔细核对收件邮箱。" }] : gptPlanId === "halfPriceTopup" ? [{ title: "使用条件", body: "需先确认账号具有半价资格，账号须为 Free 状态，不能覆盖已有订阅；没有半价资格的账号无法使用。" }, { title: "交付方式", body: "核实收款后通过邮箱发送充值卡密，请按邮件中的货源专属说明操作。供货商提供 30 天订阅质保，不保封号。" }] : [{ title: "商品内容", body: "GPT Plus 正规代充，为自己的账号充值；账号须为 Free 免费版，不能覆盖 Go、Plus 或 Pro 等已有订阅。" }, { title: "交付与售后", body: "核实收款后发送卡密及对应说明；订阅异常掉落或失效可按供货商售后规则处理，账号封禁或风控不在售后范围。" }] : isToken ? tokenTerms : musePlanId === "basic" ? [{ title: "质保说明", body: "本款没有 7 天质保。首次登录保障期限请联系支持确认。" }, ...terms.slice(1).map(item => item.title === "商品内容" ? { ...item, body: "14 元包含 1 个 Muse AI 成品账号及该账号的 10 亿 Token。" } : item)] : terms;
  const amountCents = product === "gmail" ? 1580 : product === "mail" ? 500 : product === "gpt" ? (customProduct?.priceCents ?? gptPlan.amountCents) : isToken ? selectedTokenPlan.amountCents : musePlanId === "basic" ? 1400 : accountPriceCents;
  const feeCents = 0;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("alipay");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
  const [orderError, setOrderError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const [checkoutHeight, setCheckoutHeight] = useState<number>();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [activeOrder, setActiveOrder] = useState<StoreOrder | null>(null);
  const [notification, setNotification] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [queryingOrder, setQueryingOrder] = useState(false);
  const orderRequestRef = useRef("");
  const notify = useCallback((message: string) => setNotification(message), []);
  const referralCheck = useRef<Promise<boolean>>(Promise.resolve(true));
  const retryReferralCheck = useRef<(() => Promise<boolean>) | null>(null);
  const temporaryReferral = useRef<string | undefined>(undefined);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (!code) {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (isDirectVisit(navigation?.type, document.referrer, window.location.origin)) {
        try { sessionStorage.removeItem("store-referral"); } catch { /* Storage may be disabled. */ }
      }
      return;
    }
    if (!/^[a-f0-9]{32}$/.test(code)) return;
    const visitedAt = Date.now();
    const verify = async () => {
      try {
        const response = await fetch(storeApiUrl(`/api/referral?code=${encodeURIComponent(code)}`), { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) return false;
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("valid" in data) || typeof data.valid !== "boolean") return false;
        if (data.valid) {
          try { rememberReferral(sessionStorage, code, visitedAt); }
          catch { temporaryReferral.current = code; }
        }
        return true;
      } catch { return false; }
    };
    retryReferralCheck.current = verify;
    referralCheck.current = verify();
  }, []);
  useEffect(() => {
    if (product === "muse-token") return;
    let active = true;
    const refresh = () => void fetch(storeApiUrl("/api/availability"), { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (active) setStock(data.stock || {}); }).catch(() => { if (active) setStock({}); });
    refresh(); const timer = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [product]);
  const updateOrder = useCallback((order: StoreOrder) => {
    setActiveOrder(current => current?.id === order.id ? order : current);
    setOrders(previous => previous.map(item => item.id === order.id ? order : item));
  }, []);

  useEffect(() => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && window.location.origin !== new URL(canonicalStore).origin) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const saved = readSavedOrders();
      if (saved.length) params.set("receipts", JSON.stringify(saved));
      window.location.replace(canonicalStore + (initialProduct === "muse-token" ? "token/" : "") + window.location.search + (params.size ? `#${params}` : ""));
      return;
    }
    const params = new URLSearchParams(window.location.hash.slice(1));
    const receipts = params.get("receipts");
    if (receipts) {
      try { importSavedOrders(JSON.parse(receipts)); } catch { /* Ignore invalid transfer data. */ }
      params.delete("receipts");
      window.history.replaceState(null, "", window.location.pathname + window.location.search + (params.size ? `#${params}` : ""));
    }
  }, [initialProduct]);

  useEffect(() => {
    if (window.location.origin !== new URL(canonicalStore).origin) return;
    const storageKey = "muse-visit-session";
    let id = sessionStorage.getItem(storageKey);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(storageKey, id); }
    const referrer = document.referrer.toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    const campaign = new URLSearchParams(window.location.search).get("utm_source")?.toLowerCase() || "";
    const source = /micromessenger/.test(ua) || /weixin|wechat/.test(referrer) || /weixin|wechat/.test(campaign) ? "wechat"
      : /baidu|bing|google|sogou|so\.com/.test(referrer) ? "search"
      : /douyin|xiaohongshu|weibo|zhihu/.test(referrer) ? "social"
      : referrer && !/musetoken\.store|github\.io/.test(referrer) ? "external" : "direct";
    const device = /ipad|tablet/.test(ua) ? "tablet" : /mobile|android|iphone/.test(ua) ? "mobile" : "desktop";
    void fetch(storeApiUrl("/api/visit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, page: "/", source, device }), keepalive: true }).catch(() => {});
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
    window.history.replaceState(null, "", `${assetBase}/${next === "muse-token" ? "token/" : ""}`);
    setAccepted(false);
    setError("");
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (product === "gpt" && gptPlanId.startsWith("custom:") && !customProduct) { setError("该商品已下架，请重新选择商品。"); return; }
    if (product === "gpt" && gptPlanId === "halfPriceTopup" && !eligibleConfirmed) { setError("请确认账号具有半价资格"); return; }
    if (isToken && !inviteCode.trim()) {
      setError("请填写需要充值的账号邀请码");
      document.getElementById("muse-invite-code")?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
    {
      setCreatingOrder(true);
      setError("");
      orderRequestRef.current ||= crypto.randomUUID();
      try {
        let referralVerified = await referralCheck.current;
        if (!referralVerified && retryReferralCheck.current) {
          referralCheck.current = retryReferralCheck.current();
          referralVerified = await referralCheck.current;
        }
        if (!referralVerified) throw new Error("推广链接暂时无法验证，请检查网络后重试。");
        let referralCode = temporaryReferral.current;
        if (!referralCode) { try { referralCode = storedReferralCode(sessionStorage); } catch { /* Storage may be disabled. */ } }
        const order = await createStoreOrder({ product: product === "gmail" || product === "mail" ? "gpt" : product, referralCode, planId: product === "gmail" ? "gmailAccount" : product === "mail" ? "mailCom" : isToken ? tokenPlanId : product === "gpt" ? gptPlanId : musePlanId, eligibleConfirmed,
          email: email.trim(), inviteCode: isToken ? inviteCode.trim() : undefined,
          method: paymentMethod, acceptedTerms: true }, orderRequestRef.current);
        setOrders(previous => [order, ...previous.filter(item => item.id !== order.id)]);
        setActiveOrder(order);
        setSavedOrders(saveOrder(order));
        setStep("payment");
        window.history.replaceState(null, "", orderLink(order));
      } catch (cause) { setError(cause instanceof Error ? cause.message : "创建订单失败，请联系支持。"); }
      finally { setCreatingOrder(false); }
      return;
    }
  }

  const openOrder = useCallback((order: StoreOrder) => {
    setSavedOrders(saveOrder(order));
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
    window.history.replaceState(null, "", orderLink(order));
  }, [setOrderError]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) setSavedOrders(readSavedOrders()); });
    const load = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const id = params.get("order"), token = params.get("token");
      if (!id || !token) return;
      void lookupStoreOrder(id, token).then(order => {
        if (disposed) return;
        openOrder(order);
        setOrders(previous => [order, ...previous.filter(item => item.id !== order.id)]);
      }).catch(cause => { if (!disposed) notify(cause instanceof Error ? cause.message : "订单链接无法打开"); });
    };
    load(); window.addEventListener("hashchange", load);
    return () => { disposed = true; window.removeEventListener("hashchange", load); };
  }, [openOrder, notify]);

  async function queryOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    {
      if (!orderNumber.trim()) { setOrderError("请填写 4 位订单码或订单编号，任选一个即可"); return; }
      if (queryingOrder) return;
      setQueryingOrder(true);
      setOrderError("");
      setOrderSummary(null);
      try {
        const identifier = orderNumber.trim();
        const saved = readSavedOrders().find(r => r.code === identifier || r.id === identifier);
        if (saved) { openOrder(await lookupStoreOrder(saved.id, saved.token)); return; }
        const found = await findStoreOrder(identifier);
        if (found.kind === "full") openOrder(found.order);
        else setOrderSummary(found);
      }
      catch (cause) { setOrderError(cause instanceof Error ? cause.message : "订单查询失败，请联系支持。"); }
      finally { setQueryingOrder(false); }
      return;
    }
  }

  return (
    <div className="muse-storefront">
      <header className="muse-header">
        <Link className="muse-wordmark" href="/" aria-label={`${storeName}首页`} draggable={false} onDragStart={event => event.preventDefault()}>
          <Image src={assetBase + "/sites/muse/store-logo.png"} width={34} height={34} alt="" draggable={false} />
          <span>{storeName}</span>
        </Link>
        <div className="muse-switch" role="tablist" aria-label="商品">
          <span className={`muse-switch-indicator ${product === "gmail" ? "is-gmail" : product === "mail" ? "is-mail" : product === "gpt" ? "is-gpt" : product === "muse-token" ? "is-token" : ""}`} />
          {([["muse", "Muse AI"], ["muse-token", "Muse Token"], ["gpt", "GPT"], ["mail", "Mail.com"], ["gmail", "Gmail"]] as const).map(([id, label]) => (
            <a key={id} id={`tab-${id}`} href={`${assetBase}/${id === "muse-token" ? "token/" : ""}`} role="tab"
              aria-selected={product === id} aria-controls="muse-product-panel"
              tabIndex={product === id ? 0 : -1}
              onKeyDown={event => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const items: Product[] = ["muse", "muse-token", "gpt", "mail", "gmail"];
                  const next = event.key === "Home" ? items[0] : event.key === "End" ? items[4] : items[(items.indexOf(product) + (event.key === "ArrowRight" ? 1 : 4)) % 5];
                  selectProduct(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                selectProduct(id);
              }}>
              <Image src={assetBase + (id === "gmail" ? "/sites/muse/google-g.png" : id === "mail" ? "/sites/muse/mail-com.svg" : id === "gpt" ? "/sites/muse/openai-mark.svg" : "/sites/muse/muse-logo.svg")} width={20} height={20} alt="" draggable={false} />
              {label}
            </a>
          ))}
        </div>
        <button className="muse-orders-link" type="button" onClick={() => { setOrderError(""); setDialog("orders"); }}>
          <ShoppingBag size={16} /> <span>我的订单</span>
        </button>
      </header>

      <main className="muse-product-layout" id="muse-product-panel" role="tabpanel" aria-labelledby={`tab-${product}`}>
        <section className={`muse-product-stage ${product === "mail" ? "is-mail" : product === "gmail" ? "is-gmail" : ""}`} aria-label={product === "gmail" ? "Gmail" : product === "mail" ? "Mail.com" : product === "gpt" ? "GPT" : product === "muse" ? "Muse AI" : "Muse Token"} onDragStart={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}>
          <div className="muse-stage-halo" />
          <div className="muse-logo-composition">
            <span className="muse-logo-inner"><Image key={product} src={assetBase + (product === "gmail" ? "/sites/muse/google-g.png" : product === "mail" ? "/sites/muse/mail-com.svg" : product === "gpt" ? "/sites/muse/openai-mark.svg" : "/sites/muse/muse-logo.svg")} fill sizes="(max-width: 650px) 158px, 354px" alt="" loading="eager" draggable={false} /></span>
          </div>
          <div className="muse-stage-caption" key={product}>
            <strong>{product === "gmail" ? "Gmail" : product === "mail" ? "Mail.com" : product === "gpt" ? "GPT" : product === "muse" ? "Muse AI" : "Muse Token"}</strong>
          </div>
          <div className="muse-pagination" aria-hidden="true"><i className={product === "muse" ? "active" : ""}/><i className={product === "muse-token" ? "active" : ""}/></div>
        </section>

        <section className="muse-checkout-card" aria-label="下单信息">
          <div className="muse-checkout-viewport" style={{ height: checkoutHeight }}>
          <div ref={checkoutRef} className="muse-checkout-content">
          {step === "details" ? (
            <form onSubmit={submitDetails} noValidate>
              <h1>{product === "gmail" ? "Gmail 邮箱" : product === "mail" ? "Mail.com 邮箱" : product === "gpt" ? "全部商品" : isToken ? "Muse Token" : "Muse AI"}</h1>
              <p className="muse-subtitle">{product === "gmail" ? "谷歌邮箱成品号 · 邮件交付" : product === "mail" ? "邮箱账号 · 邮件交付" : product === "gpt" ? "选择商品 · 邮箱交付" : isToken ? "Token 充值 · 不含账号" : "成品账号 + 10亿 Token"}</p>
              {product === "gmail" ? <><div className="muse-token-plan-name">Gmail 邮箱成品号 · ¥15.80</div><p className="muse-field-hint">仅保障 Gmail 收件正常；注册地区及时间随机。</p><p className="muse-field-hint">请收到后尽快检查；部分货源的售后期限从采购时起算，详情请阅读购买须知。</p><div className="muse-email-field"><label htmlFor="muse-email">收件邮箱</label><div className="muse-input-wrap"><Mail size={17}/><input id="muse-email" type="email" placeholder="you@example.com" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></div><p className="muse-field-hint">账号资料将发送至此邮箱，请仔细核对</p></div></> : product === "mail" ? <><div className="muse-token-plan-name">Mail.com 邮箱账号 · ¥5.00</div><p className="muse-field-hint">交付邮箱和密码。库存暂不足时，店主将联系你安排人工发货。</p><div className="muse-email-field"><label htmlFor="muse-email">收件邮箱</label><div className="muse-input-wrap"><Mail size={17}/><input id="muse-email" type="email" placeholder="you@example.com" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></div><p className="muse-field-hint">账号资料将发送至此邮箱，请仔细核对</p></div></> : product === "gpt" ? <>
                <fieldset className="muse-token-plans gpt-plan-grid"><legend className="sr-only">选择 GPT 商品</legend>{gptPlans.map(plan => <label key={plan.id} className={gptPlanId === plan.id ? "is-selected" : ""}><input type="radio" name="gpt-plan" checked={gptPlanId === plan.id} onChange={() => { setGptPlanId(plan.id); setEligibleConfirmed(false); }}/><span className="gpt-plan-brand"><Image src={assetBase + "/sites/muse/openai-mark.svg"} width={20} height={20} alt=""/><span>GPT <b>PLUS</b></span><em>{plan.type}</em></span><span className="gpt-plan-title">{plan.label}</span><span className="gpt-plan-details">{plan.details.map(detail => <span key={detail}>{detail}</span>)}</span><span className="gpt-plan-bottom"><strong><span>¥</span>{plan.amountCents / 100}</strong><small>{stock[plan.id] === false ? "可下单 · 人工处理" : "可下单"}</small></span></label>)}</fieldset>
                {Object.entries(customProducts.reduce<Record<string,typeof customProducts>>((groups,item)=>{(groups[item.category] ||= []).push(item);return groups;},{})).map(([category,items])=><div key={category}><h2 className="custom-category-title">{category}</h2><fieldset className="muse-token-plans gpt-plan-grid"><legend className="sr-only">{category}</legend>{items.map(item=><label key={item.id} className={gptPlanId === `custom:${item.id}` ? "is-selected" : ""}><input type="radio" name="gpt-plan" checked={gptPlanId === `custom:${item.id}`} onChange={()=>setGptPlanId(`custom:${item.id}`)}/><span className="gpt-plan-brand">{item.category}</span><span className="gpt-plan-title">{item.title}</span><span className="gpt-plan-details"><span>{item.description}</span></span><span className="gpt-plan-bottom"><strong><span>¥</span>{formatMoney(item.priceCents)}</strong><small>可下单</small></span></label>)}</fieldset></div>)}
                {stock[gptPlanId] === false && <div className="muse-token-notice" role="status">当前货源暂缺，下单后店主将联系你安排处理。</div>}
                {gptPlanId === "freeAccount" && <div className="muse-token-notice"><strong>Free 白号，不含 Plus 和半价资格</strong><p>可换绑邮箱；请在收到后 1 小时内首次登录检查，不含接码服务。</p></div>}
                {gptPlanId === "halfPriceAccountOneMonth" && <div className="muse-token-notice"><strong>半价资格期限：1 个月（不是 45 天）</strong><p>本商品不含 Plus 订阅，可换绑邮箱；请在 1 小时内首次登录检查，优惠需在电脑端查看。</p></div>}
                {gptPlanId === "halfPriceTopup" && <div className="muse-token-notice"><label><input type="checkbox" checked={eligibleConfirmed} onChange={event => setEligibleConfirmed(event.target.checked)}/> 我确认账号已有半价资格</label><p>没有资格无法使用，请先购买资格账号并确认。</p></div>}
                {gptPlanId === "plusAccount" && <div className="muse-token-notice"><strong>请购买后 20 分钟内兑换并检查首次登录</strong><p>仅处理首次无法登录问题；货源对 20 与 30 分钟时限表述不一致，请以 20 分钟为准。售后联系 692972690@qq.com，保留北京时间和登录录屏。</p></div>}
                {gptPlanId === "plus15Day" && <div className="muse-token-notice"><strong>供货商提供 15 天质保，剩余有效期约 20–26 天</strong><p>标称带 2 张重置卡，实际数量以账号为准。请勿换绑、修改密码或 2FA，否则不再提供质保。详情见购买须知。</p></div>}
                <div className="gpt-plan-summary"><h2>商品说明</h2>{purchaseTerms.map(item => <div key={item.title}><strong>{item.title}</strong><p>{item.body}</p></div>)}</div>
                <div className="muse-email-field"><label htmlFor="muse-email">收件邮箱</label><div className="muse-input-wrap"><Mail size={17}/><input id="muse-email" type="email" placeholder="you@example.com" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></div><p className="muse-field-hint">卡密和使用说明将发送到此邮箱</p></div>
              </> : isToken ? <>
                <fieldset className="muse-token-plans">
                  <legend className="sr-only">充值档次</legend>
                  {tokenPlans.map(plan => <label key={plan.id} className={tokenPlanId === plan.id ? "is-selected" : ""}>
                    <input type="radio" name="token-plan" value={plan.id} checked={tokenPlanId === plan.id} onChange={() => { setTokenPlanId(plan.id); setError(""); }}/>
                    <span className="muse-token-plan-name">{plan.label}</span>
                    <strong><span>¥</span>{formatMoney(plan.amountCents)}</strong>
                    <span className="muse-token-plan-check" aria-hidden="true">{tokenPlanId === plan.id && <Check size={11}/>}</span>
                  </label>)}
                </fieldset>
                <div className="muse-token-notice"><strong>需已有 Muse 账号</strong><p>填写账号邀请码即可充值，不包含账号。支付后 10 分钟内到账，拥挤时可能需要 30 分钟。</p></div>
                <div className="muse-email-field muse-invite-field">
                  <label htmlFor="muse-invite-code">账号邀请码 <span className="muse-required-badge">* 必填</span></label>
                  <div className={`muse-input-wrap ${error.includes("邀请码") ? "has-error" : ""}`}><Ticket size={17}/><input id="muse-invite-code" placeholder="必填：请输入需要充值的账号邀请码" required aria-invalid={error.includes("邀请码")} aria-describedby="muse-invite-hint" autoComplete="off" maxLength={128} spellCheck={false} value={inviteCode} onChange={event => { setInviteCode(event.target.value); setError(""); }}/></div>
                  <p className="muse-field-hint" id="muse-invite-hint">请务必填写并核对邀请码，Token 将充值到对应账号</p>
                </div>
                <div className="muse-email-field"><label htmlFor="muse-email">联系邮箱</label><div className="muse-input-wrap"><Mail size={17}/><input id="muse-email" type="email" placeholder="you@example.com" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></div><p className="muse-field-hint">用于订单出现问题时联系你</p></div>
              </> : <><fieldset className="muse-token-plans"><legend>选择账号规格</legend>{([{id: "warranty", label: "7 天质保", description: "7 天内封号免费换号，8 小时内首次登录验证", price: 1800}, {id: "basic", label: "无 7 天质保", description: "首次登录保障期限请联系支持确认", price: 1400}] as const).map(plan => <label key={plan.id} className={musePlanId === plan.id ? "is-selected" : ""}><input type="radio" name="muse-plan" checked={musePlanId === plan.id} onChange={() => { setMusePlanId(plan.id); setAccepted(false); setError(""); }}/><strong>{plan.label} · ¥{formatMoney(plan.price)}</strong><span>{plan.description}</span></label>)}</fieldset>
              {musePlanId === "warranty" && stock.museAccount === false && <div className="muse-token-notice" role="status">当前货源暂缺，下单后店主将联系你安排处理。</div>}
              <div className="muse-email-field">
                <label htmlFor="muse-email">收件邮箱</label>
                <div className={`muse-input-wrap ${error.includes("邮箱") ? "has-error" : ""}`}>
                  <Mail size={17}/>
                  <input id="muse-email" type="email" placeholder="you@example.com" autoComplete="off" maxLength={254}
                    value={email} onChange={event => { setEmail(event.target.value); setError(""); }} />
                </div>
                  <p className="muse-field-hint">卡密和使用教程将发到此邮箱，请仔细核对</p>
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
                <div><span>合计</span><small>{product === "gmail" || product === "mail" || product === "gpt" ? "核款后邮箱交付" : isToken ? "仅充值 Token，不含账号" : "含成品账号与 10亿 Token"}</small></div>
                <strong><span>¥</span>{formatMoney(amountCents + feeCents)}</strong>
              </div>
              <button className="muse-primary" type="submit">确认订单 <ArrowRight size={17}/></button>
            </form>
          ) : step === "notice" ? <PurchaseNotice title={productTitle} terms={purchaseTerms} busy={creatingOrder} error={error} onBack={() => setStep("details")} onContinue={createOrder}/> : activeOrder ? <OrderPayment key={activeOrder.id} order={activeOrder} onBack={() => setStep("details")} onNotify={notify} onOrderUpdate={updateOrder}/> : null}
          </div>
          </div>
        </section>
      </main>

      <footer className="muse-footer"><span>© 2026 {storeName}</span><button className="muse-support-link" type="button" onClick={() => { setRequestText(""); setRequestError(""); requestId.current = ""; setDialog("request"); }}>没有想要的？告诉我们</button><button className="muse-support-link" type="button" onClick={() => setDialog("support")}>联系支持 · QQ：{supportQQ} <ArrowUpRight size={12}/></button></footer>

      {dialog && <dialog ref={dialogRef} className="muse-dialog" aria-labelledby="muse-dialog-title" onCancel={() => setDialog(null)} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDialog(null);
      }}>
          <button className="muse-dialog-x" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button>
          {dialog === "request" ? <>
            <h2 id="muse-dialog-title">没有想要的商品？</h2><p className="muse-dialog-subtitle">告诉我们你想购买什么，无需填写联系方式。</p>
            <form onSubmit={async event => { event.preventDefault(); if (requestBusy || !requestText.trim()) return; setRequestBusy(true); setRequestError(""); requestId.current ||= crypto.randomUUID(); try { const response = await fetch(storeApiUrl("/api/product-request"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: requestId.current, message: requestText.trim() }) }); if (!response.ok) throw new Error("发送失败，请稍后再试"); setDialog(null); notify("已收到你的需求，谢谢！"); } catch { setRequestError("发送失败，请稍后再试"); } finally { setRequestBusy(false); } }}>
              <textarea aria-label="想要的商品" required maxLength={1000} rows={5} placeholder="例如：Grok 订阅" value={requestText} onChange={event => setRequestText(event.target.value)} style={{width:"100%"}}/>{requestError && <p className="muse-error" role="alert">{requestError}</p>}<button className="muse-primary" disabled={requestBusy}>{requestBusy ? "发送中…" : "提交需求"}</button>
            </form>
          </> : dialog === "terms" ? <>
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
              <label htmlFor="muse-order-number">4 位订单码 / 订单编号</label>
              <input id="muse-order-number" placeholder="任选一个填写，例如 0123" maxLength={64} autoComplete="off" autoCapitalize="off" spellCheck={false} value={orderNumber} onChange={event => { setOrderNumber(event.target.value); setOrderSummary(null); }}/>
              <p>只需填写其中一个，无需另外复制查询口令。当前浏览器会自动保存最近的订单入口。</p>
              {orderError && <p className="muse-error" role="alert">{orderError}</p>}
              <button className="muse-primary" type="submit" disabled={queryingOrder}>{queryingOrder ? "查询中…" : "查询订单"} <ArrowRight size={16}/></button>
            </form>
            {orderSummary && <div className="muse-token-notice" role="status"><strong>订单码 {orderSummary.code} · {{ pending: "待付款", reported: "等待核实到账", processing: "已收款，处理中", complete: "订单已完成", expired: "订单已超时", cancelled: "订单已取消" }[orderSummary.status]}</strong><p>{orderSummary.title} · ¥{formatMoney(orderSummary.amountCents)}</p><p>成品账号卡密会发到下单邮箱；订单状态可在原下单浏览器或用完整订单编号查询。需要协助请联系 QQ：{supportQQ}。</p></div>}
            {savedOrders.length > 0 ? <div className="muse-saved-orders"><h3>已保存的订单 · 无需复制</h3>{savedOrders.map(saved => <button key={saved.id} type="button" onClick={async () => { try { openOrder(await lookupStoreOrder(saved.id, saved.token)); } catch { setOrderError("订单暂时无法打开，请稍后重试"); } }}><ShoppingBag size={14}/><span>{saved.code} · {saved.title}</span><ArrowRight size={15}/></button>)}</div> : <RecentOrders orders={orders} onOpen={openOrder}/>}
          </>}
      </dialog>}
      {notification && <div className="muse-toast" role="status">{notification}</div>}
    </div>
  );
}
