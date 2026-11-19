"use client";

import { useEffect, useState } from "react";
import { reportedSources, type ReportedSource } from "../../../lib/traffic";
import { reportVisitSource } from "./traffic-client";

const storageKey = "muse-visit-source-answered";
let answeredInPage = false;

function hasAnswered() {
  try {
    return answeredInPage || localStorage.getItem(storageKey) === "1";
  } catch {
    return answeredInPage;
  }
}

export function VisitSourceQuestion() {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const check = () => setVisible(location.hostname === "musetoken.store" && !hasAnswered());
    const initial = window.setTimeout(check, 0);
    window.addEventListener("storage", check);
    window.addEventListener("pageshow", check);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("storage", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  async function answer(source: ReportedSource) {
    if (hasAnswered()) { setVisible(false); return; }
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await reportVisitSource(source);
      answeredInPage = true;
      try { localStorage.setItem(storageKey, "1"); } catch { /* Storage can be disabled. */ }
      setVisible(false);
    } catch {
      setError("没能保存你的选择，点一下可以重试。");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;
  return (
    <section className="muse-visit-source" aria-label="首次访问来源">
      <p className="muse-visit-source-reward">下单购买并完成问卷，即可获赠 <strong>10 亿 Muse Token</strong> 额度</p>
      <h2>你是从哪里知道卡密大王的？</h2>
      <div className="muse-visit-source-options">
        {reportedSources.map(([source, label]) => (
          <button key={source} type="button" disabled={saving} onClick={() => void answer(source)}>{label}</button>
        ))}
      </div>
      {error && <p role="status">{error}</p>}
    </section>
  );
}
