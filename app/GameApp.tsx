"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  drawCards,
  GameSettings,
  GameState,
  HandId,
  handLabel,
  loadGameState,
  playCard,
  resetGame,
  setExcludedDefinitions,
  skipCard,
} from "../src/lib/deck";
import { CARD_DEFINITIONS } from "../src/data/cards";

const STORAGE_KEY = "billiards-trick-cards:v2";
const LEGACY_STORAGE_KEY = "neon-pool-cards:v1";

type CardProps = {
  card: GameState["hands"]["shared"][number];
  owner: HandId;
  used?: boolean;
  fresh?: boolean;
  onUse?: () => void;
  onSkip?: () => void;
};

function Card({ card, owner, used, fresh, onUse, onSkip }: CardProps) {
  return (
    <article className={`game-card ${used ? "is-used" : ""} ${fresh ? "is-fresh" : ""}`}>
      <div className="card-topline">
        <span>{used ? "已使用" : handLabel(owner)}</span>
        <small>NO. {card.displayNumber}</small>
      </div>
      <div className="ball-mark" aria-hidden="true"><span>8</span></div>
      <h3>{card.title}</h3>
      <p className="card-effect">{card.effect}</p>
      {card.safetyNote && (
        <aside className="safety-note">
          <b>注意安全</b>
          <span>{card.safetyNote}</span>
        </aside>
      )}
      {onUse && (
        <div className="card-actions">
          <button className="use-button" onClick={onUse}>使用此卡</button>
          {onSkip && <button className="skip-button" onClick={onSkip}>双方同意，跳过并补抽</button>}
        </div>
      )}
    </article>
  );
}

function DeckLibrary({
  excludedIds,
  onChange,
}: {
  excludedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(excludedIds);
  const visibleCards = CARD_DEFINITIONS.filter((card) =>
    `${card.id} ${card.title} ${card.effect}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const excludedCount = CARD_DEFINITIONS
    .filter((card) => selected.has(card.id))
    .reduce((sum, card) => sum + card.count, 0);

  const toggle = (definitionId: string) => {
    const next = new Set(selected);
    if (next.has(definitionId)) next.delete(definitionId);
    else next.add(definitionId);
    onChange(Array.from(next));
  };

  return (
    <div className="deck-library">
      <div className="library-tools">
        <label>
          <span className="sr-only">搜索卡牌</span>
          <input
            type="search"
            placeholder="搜索名称或效果"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>本局纳入 <b>{51 - excludedCount}</b> 张</span>
        {excludedIds.length > 0 && <button onClick={() => onChange([])}>恢复全部</button>}
      </div>
      <div className="library-list" aria-label="完整卡牌清单">
        {visibleCards.map((card) => {
          const isExcluded = selected.has(card.id);
          return (
            <label key={card.id} className={isExcluded ? "excluded" : ""}>
              <input
                type="checkbox"
                checked={isExcluded}
                onChange={() => toggle(card.id)}
              />
              <span className="library-number">{card.id.slice(-3)}</span>
              <span className="library-copy"><b>{card.title}</b><small>{card.effect}</small></span>
              {card.count > 1 && <em>×{card.count}</em>}
              <strong>{isExcluded ? "本局排除" : "参与抽取"}</strong>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function DeckDialog({
  excludedIds,
  onClose,
  onApply,
}: {
  excludedIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState(excludedIds);
  return (
    <div className="modal-backdrop">
      <section className="deck-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-title">
        <div className="dialog-heading">
          <div><p className="section-kicker">FULL DECK · 50 RULES / 51 CARDS</p><h2 id="deck-title">本局牌库</h2></div>
          <button className="close-button" aria-label="关闭牌库" onClick={onClose}>×</button>
        </div>
        <p className="setup-intro">勾选不参与本局抽取的卡牌。进行中修改只影响尚未抽出的牌，已经在手牌或记录中的卡牌不会被移除。</p>
        <DeckLibrary excludedIds={draft} onChange={setDraft} />
        <div className="dialog-actions">
          <button className="quiet-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={() => onApply(draft)}>应用牌库范围</button>
        </div>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max={max}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>张</small>
    </label>
  );
}

function SetupDialog({
  settings,
  hasGame,
  onCancel,
  onStart,
}: {
  settings: GameSettings;
  hasGame: boolean;
  onCancel: () => void;
  onStart: (settings: GameSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const total = draft.handMode === "shared"
    ? draft.sharedHandSize
    : draft.playerAHandSize + draft.playerBHandSize;
  const excludedCount = CARD_DEFINITIONS
    .filter((card) => draft.excludedDefinitionIds.includes(card.id))
    .reduce((sum, card) => sum + card.count, 0);
  const availableCount = 51 - excludedCount;
  const values = draft.handMode === "shared"
    ? [draft.sharedHandSize]
    : [draft.playerAHandSize, draft.playerBHandSize];
  const invalid = availableCount < 1 || total > availableCount ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > availableCount);

  return (
    <div className="modal-backdrop">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <p className="section-kicker">NEW MATCH</p>
        <h2 id="setup-title">{hasGame ? "开始新一局" : "设置本局手牌"}</h2>
        <p className="setup-intro">选择共用一套手牌，或为玩家 A、B 分别发牌。起始手牌会从 51 张牌中随机抽取。</p>

        <fieldset className="mode-picker">
          <legend>手牌模式</legend>
          <label className={draft.handMode === "shared" ? "selected" : ""}>
            <input
              type="radio"
              name="hand-mode"
              checked={draft.handMode === "shared"}
              onChange={() => setDraft({ ...draft, handMode: "shared" })}
            />
            <b>一套手牌</b>
            <span>双方共用，适合公开抽卡</span>
          </label>
          <label className={draft.handMode === "dual" ? "selected" : ""}>
            <input
              type="radio"
              name="hand-mode"
              checked={draft.handMode === "dual"}
              onChange={() => setDraft({ ...draft, handMode: "dual" })}
            />
            <b>两套手牌</b>
            <span>玩家 A、B 分开持有</span>
          </label>
        </fieldset>

        <div className="deal-settings">
          {draft.handMode === "shared" ? (
            <NumberField
              label="共用起始手牌"
              value={draft.sharedHandSize}
              max={51}
              onChange={(sharedHandSize) => setDraft({ ...draft, sharedHandSize })}
            />
          ) : (
            <>
              <NumberField
                label="玩家 A 起始手牌"
                value={draft.playerAHandSize}
                max={51}
                onChange={(playerAHandSize) => setDraft({ ...draft, playerAHandSize })}
              />
              <NumberField
                label="玩家 B 起始手牌"
                value={draft.playerBHandSize}
                max={51}
                onChange={(playerBHandSize) => setDraft({ ...draft, playerBHandSize })}
              />
            </>
          )}
        </div>
        <p className={invalid ? "deal-total error" : "deal-total"}>
          共发 {total} 张 · 抽取范围保留 {Math.max(0, availableCount - total)} 张
        </p>

        <details className="setup-deck-picker">
          <summary>
            <span><b>设置本局牌库</b><small>当前纳入 {availableCount} 张</small></span>
            <i>⌄</i>
          </summary>
          <DeckLibrary
            excludedIds={draft.excludedDefinitionIds}
            onChange={(excludedDefinitionIds) => setDraft({ ...draft, excludedDefinitionIds })}
          />
        </details>

        <aside className="safety-brief">
          <b>安全第一</b>
          <p>请遵守球房规定，确认挥杆范围内无人。闭眼、转圈、背后出杆等挑战可由双方同意后安全跳过并补抽。</p>
        </aside>

        {hasGame && <p className="reset-warning">确认后，当前手牌和使用记录将被清空。</p>}
        <div className="dialog-actions">
          {hasGame && <button className="quiet-button" onClick={onCancel}>取消</button>}
          <button className="primary-button" disabled={invalid} onClick={() => onStart(draft)}>
            {hasGame ? "确认并开始" : "开始本局"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function GameApp() {
  const [state, setState] = useState<GameState>(() => resetGame({
    ...DEFAULT_SETTINGS,
    sharedHandSize: 0,
    playerAHandSize: 0,
    playerBHandSize: 0,
  }));
  const [ready, setReady] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<GameState | null>(null);
  const [status, setStatus] = useState("");
  const freshTimer = useRef<number | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = loadGameState(localStorage.getItem(STORAGE_KEY))
        ?? loadGameState(localStorage.getItem(LEGACY_STORAGE_KEY));
      if (saved) {
        setState(saved);
      } else {
        setSetupOpen(true);
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => () => {
    if (freshTimer.current !== null) window.clearTimeout(freshTimer.current);
  }, []);

  const activeHand = state.settings.handMode === "shared" ? "shared" : state.activeHand;
  const hand = state.hands[activeHand];
  const value = Number(amount);
  const invalid = !Number.isInteger(value) || value < 1 || value > state.remaining.length;

  const hint = useMemo(() => {
    if (state.remaining.length === 0) return "本局卡牌已全部抽完";
    if (invalid) return `请输入 1 到 ${state.remaining.length} 之间的整数`;
    return `本次为 ${handLabel(activeHand)} 随机抽取`;
  }, [activeHand, invalid, state.remaining.length]);

  const commit = (next: GameState, message: string) => {
    if (next === state) return;
    setUndoSnapshot(state);
    setState(next);
    setStatus(message);
  };

  const markFresh = (ids: string[]) => {
    if (freshTimer.current !== null) window.clearTimeout(freshTimer.current);
    setFreshIds(ids);
    freshTimer.current = window.setTimeout(() => setFreshIds([]), 750);
  };

  const draw = () => {
    if (invalid) return;
    const next = drawCards(state, activeHand, value);
    markFresh(next.hands[activeHand].slice(0, value).map((card) => card.instanceId));
    commit(next, `已为${handLabel(activeHand)}抽取 ${value} 张卡牌`);
  };

  const startGame = (settings: GameSettings) => {
    const next = resetGame(settings);
    setState(next);
    setUndoSnapshot(null);
    setAmount("1");
    setFreshIds([]);
    setSetupOpen(false);
    setStatus(`新一局已开始，模式：${settings.handMode === "shared" ? "一套手牌" : "两套手牌"}`);
  };

  const undo = () => {
    if (!undoSnapshot) return;
    setState(undoSnapshot);
    setUndoSnapshot(null);
    setFreshIds([]);
    setStatus("已撤销上一步操作");
  };

  const play = (instanceId: string) => {
    const card = hand.find((item) => item.instanceId === instanceId);
    commit(playCard(state, activeHand, instanceId), `“${card?.title ?? "卡牌"}”已移入使用记录`);
  };

  const skip = (instanceId: string) => {
    const card = hand.find((item) => item.instanceId === instanceId);
    const next = skipCard(state, activeHand, instanceId);
    const replacement = next.hands[activeHand][0];
    if (replacement && !state.hands[activeHand].some((item) => item.instanceId === replacement.instanceId)) {
      markFresh([replacement.instanceId]);
    }
    commit(next, `双方同意跳过“${card?.title ?? "卡牌"}”${state.remaining.length ? "，已补抽 1 张" : ""}`);
  };

  const applyDeckRange = (definitionIds: string[]) => {
    const next = setExcludedDefinitions(state, definitionIds);
    const changed = next.excluded.length - state.excluded.length;
    commit(
      next,
      changed === 0 ? "牌库范围未变化" : `本局牌库已更新，当前排除 ${next.excluded.length} 张`,
    );
    setDeckOpen(false);
  };

  if (!ready) return <main className="loading">正在整理牌库…</main>;

  const totalInHands = state.hands.shared.length + state.hands.playerA.length + state.hands.playerB.length;
  const hasGame = totalInHands > 0 || state.used.length > 0 || state.discarded.length > 0;

  return (
    <main>
      <header className="hero">
        <div className="brand-lockup">
          <p className="eyebrow"><span /> CHINESE BILLIARDS · TRICK DECK</p>
          <h1>台球奇招<span>卡牌</span></h1>
          <p className="subtitle">抽一张，让这一杆变得不一样。</p>
        </div>
        <div className="hero-actions">
          {undoSnapshot && <button className="undo-button" onClick={undo}>↶ 撤销上一步</button>}
          <button className="reset-button" onClick={() => setSetupOpen(true)}>新一局</button>
        </div>
      </header>

      <section className="match-console" aria-label="本局牌况">
        <div className="console-status">
          <span className="live-dot" aria-hidden="true" />
          <div><small>当前模式</small><b>{state.settings.handMode === "shared" ? "一套共用手牌" : "双人独立手牌"}</b></div>
        </div>
        <button className="console-stat deck-stat" onClick={() => setDeckOpen(true)}>
          <b>{state.remaining.length}</b><span>牌库 · 点击查看</span>
        </button>
        <div className="console-stat"><b>{totalInHands}</b><span>手牌</span></div>
        <div className="console-stat"><b>{state.used.length}</b><span>已使用</span></div>
        <div className="console-stat"><b>{state.discarded.length}</b><span>已跳过</span></div>
      </section>

      {state.settings.handMode === "dual" && (
        <nav className="hand-switcher" aria-label="切换玩家手牌">
          {(["playerA", "playerB"] as HandId[]).map((handId) => (
            <button
              key={handId}
              aria-current={activeHand === handId ? "page" : undefined}
              className={activeHand === handId ? "active" : ""}
              onClick={() => setState({ ...state, activeHand: handId })}
            >
              <span>{handLabel(handId)}</span>
              <b>{state.hands[handId].length} 张</b>
            </button>
          ))}
        </nav>
      )}

      <section className="card-section">
        <div className="section-heading">
          <div><p className="section-kicker">IN YOUR HAND</p><h2>{handLabel(activeHand)} <em>{hand.length}</em></h2></div>
          <p>使用后会进入本局记录，误触可撤销</p>
        </div>
        {hand.length ? (
          <div className="card-grid">
            {hand.map((item) => (
              <Card
                key={item.instanceId}
                card={item}
                owner={activeHand}
                fresh={freshIds.includes(item.instanceId)}
                onUse={() => play(item.instanceId)}
                onSkip={() => skip(item.instanceId)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="empty-ball">8</span>
            <p>当前没有手牌，从牌库抽一张试试</p>
          </div>
        )}
      </section>

      <section className="draw-panel">
        <button className="deck-visual" onClick={() => setDeckOpen(true)} aria-label="查看并设置本局牌库">
          <span className="deck-card back-one" />
          <span className="deck-card back-two" />
          <span className="deck-card back-main"><i>8</i></span>
        </button>
        <div className="draw-copy">
          <p className="section-kicker">DRAW FROM THE DECK</p>
          <h2>抽取新卡牌</h2>
          <p className={invalid ? "error" : ""}>{hint}</p>
          <button className="library-link" onClick={() => setDeckOpen(true)}>
            查看全部 50 种规则 · 已排除 {state.excluded.length} 张
          </button>
        </div>
        <div className="draw-controls">
          <label>
            <span>抽取数量</span>
            <input
              aria-label="抽取数量"
              type="number"
              inputMode="numeric"
              min="1"
              max={state.remaining.length}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button className="draw-button" disabled={invalid || state.remaining.length === 0} onClick={draw}>
            抽取卡牌 <span>→</span>
          </button>
        </div>
      </section>

      <details className="history-section">
        <summary>
          <span><small>MATCH RECORD</small><b>本局记录</b></span>
          <span>{state.used.length + state.discarded.length} 条 <i>⌄</i></span>
        </summary>
        <div className="history-content">
          {state.used.length === 0 && state.discarded.length === 0 ? (
            <p className="history-empty">使用过或经双方同意跳过的卡牌会记录在这里。</p>
          ) : (
            <ol className="history-list">
              {[...state.used.map((record) => ({ ...record, type: "used" as const })),
                ...state.discarded.map((record) => ({ ...record, type: "skipped" as const }))]
                .sort((a, b) => b.recordedAt - a.recordedAt)
                .map((record) => (
                  <li key={`${record.type}-${record.card.instanceId}-${record.recordedAt}`}>
                    <span className={`history-marker ${record.type}`} />
                    <span className="history-number">NO. {record.card.displayNumber}</span>
                    <b>{record.card.title}</b>
                    <span>{handLabel(record.owner)}</span>
                    <em>{record.type === "used" ? "已使用" : "安全跳过"}</em>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </details>

      <footer>
        <b>台球奇招卡牌</b>
        <span>51 张实体卡 · 不放回抽取 · 进度保存在此设备</span>
        <span>趣味挑战请量力而行，遵守场地规定</span>
      </footer>

      <div className="mobile-actions">
        {state.settings.handMode === "dual" && (
          <button
            onClick={() => setState({ ...state, activeHand: activeHand === "playerA" ? "playerB" : "playerA" })}
          >
            切换手牌
          </button>
        )}
        {undoSnapshot && <button onClick={undo}>撤销</button>}
        <button className="mobile-draw" disabled={state.remaining.length === 0} onClick={() => {
          if (amount !== "1") setAmount("1");
          const next = drawCards(state, activeHand, 1);
          markFresh([next.hands[activeHand][0].instanceId]);
          commit(next, `已为${handLabel(activeHand)}抽取 1 张卡牌`);
        }}>抽 1 张</button>
      </div>

      <div className="status-toast" role="status" aria-live="polite" aria-atomic="true">
        {status && <span>{status}</span>}
        {status && undoSnapshot && <button onClick={undo}>撤销</button>}
      </div>

      {setupOpen && (
        <SetupDialog
          key={`${state.settings.handMode}-${setupOpen}`}
          settings={hasGame ? state.settings : DEFAULT_SETTINGS}
          hasGame={hasGame}
          onCancel={() => setSetupOpen(false)}
          onStart={startGame}
        />
      )}
      {deckOpen && (
        <DeckDialog
          key={state.settings.excludedDefinitionIds.join(",")}
          excludedIds={state.settings.excludedDefinitionIds}
          onClose={() => setDeckOpen(false)}
          onApply={applyDeckRange}
        />
      )}
    </main>
  );
}
