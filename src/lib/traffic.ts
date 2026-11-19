export const reportedSources = [
  ["xiaohongshu", "小红书"],
  ["douyin", "抖音"],
  ["wechat", "微信群 / 朋友圈"],
  ["wechat_channels", "微信视频号"],
  ["wechat_official", "微信公众号"],
  ["bilibili", "B 站"],
  ["twitter", "推特（X）"],
  ["search", "搜索引擎"],
  ["ai", "AI 推荐"],
  ["friend", "朋友推荐"],
  ["other", "其他渠道"],
  ["unsure", "记不清了"],
] as const;

export type ReportedSource = (typeof reportedSources)[number][0];

export function isReportedSource(value: unknown): value is ReportedSource {
  return reportedSources.some(([source]) => source === value);
}

export const trafficId = /^[a-f0-9-]{36}$/i;
export function campaignLabel(value: unknown): string {
  return typeof value === "string" && /^[\p{L}\p{N}_.-]{1,64}$/u.test(value) ? value.toLowerCase() : "";
}
const domains: [string,string,string][] = [
  ["x.com","推特（X）","social"],["twitter.com","推特（X）","social"],["t.co","推特（X）","social"],
  ["google.com","Google","search"],["google.com.hk","Google","search"],["baidu.com","百度","search"],["bing.com","Bing","search"],["sogou.com","搜狗","search"],["so.com","360 搜索","search"],
  ["chatgpt.com","ChatGPT","ai"],["chat.openai.com","ChatGPT","ai"],["perplexity.ai","Perplexity","ai"],["gemini.google.com","Gemini","ai"],["claude.ai","Claude","ai"],["deepseek.com","DeepSeek","ai"],["doubao.com","豆包","ai"],
  ["xiaohongshu.com","小红书","social"],["xhslink.com","小红书","social"],["douyin.com","抖音","social"],["weibo.com","微博","social"],["zhihu.com","知乎","social"],["bilibili.com","哔哩哔哩","social"],["mp.weixin.qq.com","微信公众号","wechat"],
];
export function classifyTraffic(input: Record<string,unknown>) {
  let host="";
  try { const url=new URL(String(input.referrer || "")); if (["https:","http:"].includes(url.protocol) && !url.username && !url.password && url.hostname.length<=253) host=url.hostname.toLowerCase(); } catch { /* Missing referrer is unknown. */ }
  if (host === "musetoken.store" || host === "api.musetoken.store") host="";
  const source=campaignLabel(input.utmSource),medium=campaignLabel(input.utmMedium),campaign=campaignLabel(input.utmCampaign),content=campaignLabel(input.utmContent);
  const match=domains.slice().sort((a,b)=>b[0].length-a[0].length).find(([domain])=>host===domain || host.endsWith(`.${domain}`));
  const channel=source ? "campaign" : match?.[2] || (host ? "external" : "unknown");
  const platform=source || match?.[1] || host || "来源未知";
  const page=typeof input.page==="string" && /^\/(?:muse|account|gpt|gmail|mail|token|guides\/muse-(?:account|token))?\/?$/.test(input.page) ? input.page : "/";
  return {channel,platform,host,medium,campaign,content,page,evidence:source ? "tag" : host ? "referrer" : "unknown",device:["mobile","tablet","desktop"].includes(String(input.device)) ? String(input.device) : "desktop",wechat:input.wechat===true ? 1 : 0};
}
