"use client";

import { useEffect, useMemo, useState } from "react";
import { drawCards, GameState, resetGame, useCard } from "../src/lib/deck";

const STORAGE_KEY = "neon-pool-cards:v1";

function Card({ card, used, onUse, fresh }: { card: GameState["hand"][number]; used?: boolean; onUse?: () => void; fresh?: boolean }) {
  return (
    <article className={`game-card ${used ? "is-used" : ""} ${fresh ? "is-fresh" : ""}`}>
      <div className="card-topline"><span>{used ? "已使用" : "未使用"}</span><small>NO. {card.definitionId.slice(-3)}</small></div>
      <div className="orb" aria-hidden="true" />
      <h3>{card.title}</h3>
      <p>{card.effect}</p>
      {onUse && <button className="use-button" onClick={onUse}>使用此卡</button>}
    </article>
  );
}

export default function GameApp() {
  const [state, setState] = useState<GameState>(resetGame);
  const [amount, setAmount] = useState("1");
  const [ready, setReady] = useState(false);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const value = Number(amount);
  const invalid = !Number.isInteger(value) || value < 1 || value > state.remaining.length;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState(JSON.parse(saved) as GameState);
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, ready]);

  const hint = useMemo(() => {
    if (state.remaining.length === 0) return "本局卡牌已全部抽完";
    if (invalid) return `请输入 1 到 ${state.remaining.length} 之间的整数`;
    return `本次将从剩余 ${state.remaining.length} 张中随机抽取`;
  }, [invalid, state.remaining.length]);

  const draw = () => {
    if (invalid) return;
    const next = drawCards(state, value);
    setFreshIds(next.hand.slice(0, value).map((item) => item.instanceId));
    setState(next);
    window.setTimeout(() => setFreshIds([]), 700);
  };

  const restart = () => {
    if (window.confirm("确定开始新一局吗？当前手牌和已使用记录将被清空。")) {
      setState(resetGame()); setAmount("1"); setFreshIds([]);
    }
  };

  if (!ready) return <main className="loading">正在整理牌库…</main>;
  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow"><span /> 8-BALL CARD DECK</p>
          <h1>台球<span>奇招</span>卡牌</h1>
          <p className="subtitle">抽一张，让这一杆变得不一样。</p>
        </div>
        <button className="reset-button" onClick={restart}>↻ 开始新一局</button>
      </header>

      <section className="stats" aria-label="本局牌况">
        <div><b>{state.remaining.length}</b><span>未抽卡池</span></div>
        <div><b>{state.hand.length}</b><span>当前手牌</span></div>
        <div><b>{state.used.length}</b><span>已使用</span></div>
      </section>

      <section className="draw-panel">
        <div><p className="section-kicker">DRAW CARDS</p><h2>抽取新卡牌</h2><p className={invalid ? "error" : ""}>{hint}</p></div>
        <div className="draw-controls">
          <label><span>抽取数量</span><input aria-label="抽取数量" type="number" min="1" max={state.remaining.length} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <button className="draw-button" disabled={invalid || state.remaining.length === 0} onClick={draw}>抽取卡牌 <span>→</span></button>
        </div>
      </section>

      <section className="card-section">
        <div className="section-heading"><div><p className="section-kicker">YOUR HAND</p><h2>当前手牌 <em>{state.hand.length}</em></h2></div><p>卡牌使用后将移入已使用区</p></div>
        {state.hand.length ? <div className="card-grid">{state.hand.map((item) => <Card key={item.instanceId} card={item} fresh={freshIds.includes(item.instanceId)} onUse={() => setState(useCard(state, item.instanceId))} />)}</div> : <div className="empty">还没有手牌，先抽几张试试</div>}
      </section>

      <section className="card-section used-section">
        <div className="section-heading"><div><p className="section-kicker">PLAYED</p><h2>已使用卡牌 <em>{state.used.length}</em></h2></div></div>
        {state.used.length ? <div className="card-grid">{state.used.map((item) => <Card key={item.instanceId} card={item} used />)}</div> : <div className="empty small">已使用的卡牌会留在这里</div>}
      </section>
      <footer>本局共 51 张实体卡 · 不放回抽取 · 进度自动保存在此设备</footer>
    </main>
  );
}
