"use client";

import { useEffect, useState } from "react";
import { CARD_DEFINITIONS } from "../src/data/cards";
import { GameState, loadGameState } from "../src/lib/deck";
import { getOfficialDeck, OFFICIAL_DECKS, officialDeckCardCount, OfficialDeckId } from "../src/lib/official-decks";
import {
  addMatchPlayer,
  applyScore,
  applyTransferScore,
  BilliardsMatch,
  CardMode,
  createMatch,
  correctScoreEvent,
  deleteMatchPlayer,
  DEFAULT_RULES,
  drawMatchCards,
  finishMatch,
  getRankings,
  isStoredMatch,
  hasPlayerActivity,
  leaveMatchPlayer,
  MatchDraft,
  MatchMode,
  playMatchCard,
  reorderPlayers,
  ScoreRule,
  setCurrentPlayer,
  skipMatchCard,
  TurnStrategy,
  undoLastScore,
} from "../src/lib/match";

const APP_STORAGE_KEY = "billiards-club-assistant:v1";
const CARD_STORAGE_KEY = "billiards-trick-cards:v2";
const LEGACY_CARD_STORAGE_KEY = "neon-pool-cards:v1";
const APP_VERSION = "4.0.0";

type AppData = {
  version: 1;
  activeMatch: BilliardsMatch | null;
  history: BilliardsMatch[];
  savedRules: ScoreRule[];
  pausedMatches: BilliardsMatch[];
  recoverySnapshots: { match: BilliardsMatch; abandonedAt: number; reason: string }[];
};

type StorageIssue = { message: string; raw: string };

const EMPTY_DATA: AppData = { version: 1, activeMatch: null, history: [], savedRules: DEFAULT_RULES, pausedMatches: [], recoverySnapshots: [] };

const NAV_ITEMS = [
  { path: "/", label: "对局", icon: "◎" },
  { path: "/play", label: "玩法", icon: "◇" },
  { path: "/decks", label: "牌组", icon: "▤" },
  { path: "/history", label: "战绩", icon: "⌁" },
  { path: "/profile", label: "我的", icon: "○" },
];

function migrateLegacyCardMatch(state: GameState): BilliardsMatch {
  const now = Date.now();
  const players = [
    { id: "legacy-player-a", name: "玩家 A", kind: "guest" as const, initialScore: 0, score: 0, active: true },
    { id: "legacy-player-b", name: "玩家 B", kind: "guest" as const, initialScore: 0, score: 0, active: true },
  ];
  const shared = state.settings.handMode === "shared";
  return {
    version: 1,
    id: `migrated-${now}`,
    mode: "cards",
    status: "active",
    createdAt: now,
    startedAt: now,
    players,
    currentPlayerId: players[0].id,
    rules: DEFAULT_RULES,
    scoreEvents: [],
    cards: {
      mode: shared ? "shared" : "independent",
      remaining: state.remaining,
      hands: shared
        ? { shared: state.hands.shared }
        : { [players[0].id]: state.hands.playerA, [players[1].id]: state.hands.playerB },
      used: state.used.map((record) => record.card),
      skipped: state.discarded.map((record) => record.card),
      events: [],
      initialHandSize: shared ? state.settings.sharedHandSize : state.settings.playerAHandSize,
      deckSnapshot: {
        id: "complete",
        version: 1,
        name: "完整奇招",
        definitionIds: [...getOfficialDeck("complete").definitionIds],
        cardCount: 51,
      },
    },
  };
}

function parseAppData(raw: string | null): AppData | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object") {
    const data = parsed as Partial<AppData>;
    if (data.version === 1 && Array.isArray(data.history)) {
      return {
        version: 1,
        activeMatch: isStoredMatch(data.activeMatch) ? data.activeMatch : null,
        history: data.history.filter(isStoredMatch),
        savedRules: Array.isArray(data.savedRules) ? data.savedRules : DEFAULT_RULES,
        pausedMatches: Array.isArray(data.pausedMatches) ? data.pausedMatches.filter(isStoredMatch) : [],
        recoverySnapshots: Array.isArray(data.recoverySnapshots)
          ? data.recoverySnapshots.filter((item) => item && isStoredMatch(item.match))
          : [],
      };
    }
  }
  throw new Error("数据格式或版本无法识别");
}

function loadAppData(): { data: AppData; issue?: StorageIssue } {
  const raw = localStorage.getItem(APP_STORAGE_KEY);
  try {
    const parsed = parseAppData(raw);
    if (parsed) return { data: parsed };
  } catch (error) {
    return { data: EMPTY_DATA, issue: { message: error instanceof Error ? error.message : "本机数据读取失败", raw: raw ?? "" } };
  }
  const legacy = loadGameState(localStorage.getItem(CARD_STORAGE_KEY))
    ?? loadGameState(localStorage.getItem(LEGACY_CARD_STORAGE_KEY));
  const hasLegacyGame = legacy && (
    legacy.used.length > 0 || legacy.discarded.length > 0 ||
    Object.values(legacy.hands).some((hand) => hand.length > 0)
  );
  return { data: hasLegacyGame ? { ...EMPTY_DATA, activeMatch: migrateLegacyCardMatch(legacy) } : EMPTY_DATA };
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatDuration(startedAt: number, endedAt = Date.now()) {
  const minutes = Math.max(0, Math.floor((endedAt - startedAt) / 60000));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function AppHeader({ path, active, onNavigate }: { path: string; active: boolean; onNavigate: (path: string) => void }) {
  return (
    <>
      <header className="app-header">
        <button className="brand" onClick={() => onNavigate("/")} aria-label="返回对局首页">
          <span className="brand-ball">8</span><span><b>台球奇招</b><small>朋友局助手</small></span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button key={item.path} className={path === item.path || (item.path !== "/" && path.startsWith(item.path)) ? "active" : ""} onClick={() => onNavigate(item.path)}>
              {item.label}{item.path === "/" && active && <i>进行中</i>}
            </button>
          ))}
        </nav>
        <button className="guest-chip" onClick={() => onNavigate("/profile")}><span>游</span>游客模式</button>
      </header>
      <nav className="mobile-nav" aria-label="手机主导航">
        {NAV_ITEMS.map((item) => (
          <button key={item.path} className={path === item.path || (item.path !== "/" && path.startsWith(item.path)) ? "active" : ""} onClick={() => onNavigate(item.path)}>
            <span>{item.icon}</span><b>{item.label}</b>{item.path === "/" && active && <i />}
          </button>
        ))}
      </nav>
    </>
  );
}

function EmptyHome({ onStart, onNavigate, onResume, recent, paused }: { onStart: (mode: MatchMode) => void; onNavigate: (path: string) => void; onResume: (id: string) => void; recent?: BilliardsMatch; paused: BilliardsMatch[] }) {
  return (
    <div className="home-page page-shell">
      <section className="welcome-panel">
        <div>
          <p className="kicker">CHINESE BILLIARDS · MATCH NIGHT</p>
          <h1>今晚这桌，<br /><em>玩点不一样。</em></h1>
          <p className="lead">追分、抽牌、记流水，一部手机就能管好整场朋友局。</p>
          <div className="welcome-actions">
            <button className="primary" onClick={() => onStart("score")}>开始追分局 <span>→</span></button>
            <button className="secondary" onClick={() => onStart("cards")}>开始奇招牌局</button>
          </div>
        </div>
        <div className="feature-orbit" aria-hidden="true">
          <div className="orbit-ring ring-a" /><div className="orbit-ring ring-b" />
          <span className="hero-ball">8</span>
          <div className="float-card card-one"><small>NO. 016</small><b>纷乱头脑</b><span>安全挑战</span></div>
          <div className="float-card card-two"><small>LIVE SCORE</small><b>+ 20</b><span>小金</span></div>
        </div>
      </section>

      {!!paused.length && <section className="paused-matches" aria-label="已保存的未结束对局"><div><p className="kicker">SAVED MATCHES</p><h2>继续未结束对局</h2></div>{paused.map((match) => <button key={match.id} onClick={() => onResume(match.id)}><b>{match.players.map((player) => player.name).join(" · ")}</b><small>{formatTime(match.startedAt)} · {match.scoreEvents.length} 笔计分</small><span>继续 →</span></button>)}</section>}

      <section className="quick-grid" aria-label="快速开始">
        <button onClick={() => onStart("score")}><span className="quick-icon mint">＋</span><div><b>多人追分</b><small>2–8 人 · 分值可配 · 自动排名</small></div><i>→</i></button>
        <button onClick={() => onStart("score_cards")}><span className="quick-icon cyan">◇</span><div><b>追分 + 奇招牌</b><small>计分和抽牌同时进行</small></div><i>→</i></button>
        <button onClick={() => onNavigate("/play")}><span className="quick-icon violet">▦</span><div><b>更多娱乐玩法</b><small>查看规则与即将推出的挑战</small></div><i>→</i></button>
      </section>

      {recent && (
        <section className="recent-strip">
          <div><p className="kicker">LAST MATCH</p><h2>上次对局</h2></div>
          <div className="recent-copy"><b>{recent.players.map((player) => player.name).join("、")}</b><small>{formatTime(recent.startedAt)} · {recent.mode === "cards" ? "奇招牌局" : "多人追分"}</small></div>
          <button onClick={() => onNavigate(`/history/${recent.id}`)}>查看战绩</button>
        </section>
      )}
    </div>
  );
}

function SetupDialog({ initialMode, savedRules, onClose, onStart }: { initialMode: MatchMode; savedRules: ScoreRule[]; onClose: () => void; onStart: (draft: MatchDraft, savePreset: boolean) => void }) {
  const [names, setNames] = useState(["玩家 A", "玩家 B"]);
  const [initialScore, setInitialScore] = useState(0);
  const [playerScores, setPlayerScores] = useState([0, 0]);
  const [turnStrategy, setTurnStrategy] = useState<TurnStrategy>("fixed");
  const [rules, setRules] = useState(savedRules.map((rule) => ({ ...rule })));
  const [cardMode, setCardMode] = useState<CardMode>(initialMode === "score" ? "none" : "shared");
  const [handSize, setHandSize] = useState(3);
  const [deckId, setDeckId] = useState<OfficialDeckId>("complete");
  const [reviewing, setReviewing] = useState(false);
  const [savePreset, setSavePreset] = useState(false);
  const scoreEnabled = initialMode !== "cards";
  const selectedDeck = getOfficialDeck(deckId);
  const selectedDeckCount = officialDeckCardCount(selectedDeck);
  const validPlayers = names.map((name, index) => ({ name: name.trim(), initialScore: playerScores[index] ?? initialScore })).filter((player) => player.name);
  const validNames = validPlayers.map((player) => player.name);
  const valid = validNames.length >= 2 && validNames.length <= 8 && validPlayers.every((player) => Number.isFinite(player.initialScore)) && rules.every((rule) => Number.isFinite(rule.value) && rule.value >= 0);

  const updateName = (index: number, value: string) => setNames(names.map((name, itemIndex) => itemIndex === index ? value : name));
  const updatePlayerScore = (index: number, value: number) => setPlayerScores(playerScores.map((score, itemIndex) => itemIndex === index ? value : score));
  const updateRule = (id: string, patch: Partial<ScoreRule>) => setRules(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  const moveRule = (id: string, direction: -1 | 1) => { const index = rules.findIndex((rule) => rule.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= rules.length) return; const next = [...rules]; [next[index], next[target]] = [next[target], next[index]]; setRules(next); };
  const addCustomRule = () => setRules([...rules, { id: `custom-${Date.now()}`, label: "自定义计分", value: 10, kind: "gain", enabled: true, color: "mint", description: "", custom: true }]);
  const shufflePlayers = () => {
    const shuffled = names.map((name, index) => ({ name, score: playerScores[index] ?? initialScore }));
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const selected = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
    }
    setNames(shuffled.map((player) => player.name));
    setPlayerScores(shuffled.map((player) => player.score));
  };
  const submit = () => onStart({
    mode: initialMode === "cards" ? "cards" : cardMode === "none" ? "score" : "score_cards",
    playerNames: validNames,
    initialScore,
    playerInitialScores: validPlayers.map((player) => player.initialScore),
    turnStrategy,
    rules,
    cardMode: initialMode === "cards" && cardMode === "none" ? "shared" : cardMode,
    initialHandSize: cardMode === "independent" ? Math.min(handSize, Math.floor(selectedDeckCount / validNames.length)) : handSize,
    deckId,
  }, savePreset);

  return (
    <div className="modal-backdrop">
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="modal-heading">
          <div><p className="kicker">NEW MATCH</p><h2 id="setup-title">{reviewing ? "确认本局规则" : initialMode === "cards" ? "开始奇招牌局" : "创建追分对局"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {!reviewing ? (
          <div className="setup-body">
            <section className="setup-section">
              <div className="setup-title"><span>01</span><div><b>添加玩家</b><small>支持 2–8 名临时玩家，无需注册</small></div></div>
              <div className="player-inputs">
                {names.map((name, index) => (
                  <label key={index} className="player-input"><span>{index + 1}</span><input className="player-name-input" aria-label={`玩家 ${index + 1} 昵称`} value={name} maxLength={12} onChange={(event) => updateName(index, event.target.value)} /><input className="player-score-input" aria-label={`${name || `玩家 ${index + 1}`}初始积分`} type="number" inputMode="numeric" value={playerScores[index] ?? initialScore} onChange={(event) => updatePlayerScore(index, Number(event.target.value))} />{names.length > 2 && <button onClick={() => { setNames(names.filter((_, itemIndex) => itemIndex !== index)); setPlayerScores(playerScores.filter((_, itemIndex) => itemIndex !== index)); }} aria-label={`删除玩家 ${index + 1}`}>×</button>}</label>
                ))}
                {names.length < 8 && <button className="add-player" onClick={() => { setNames([...names, `玩家 ${String.fromCharCode(65 + names.length)}`]); setPlayerScores([...playerScores, initialScore]); }}>＋ 添加临时玩家</button>}
                <button className="add-player" onClick={shufflePlayers}>⤨ 随机排列顺序</button>
                <button className="registered-entry" disabled title="账户功能将在云同步阶段开放">○ 添加注册玩家 <small>即将开放</small></button>
              </div>
            </section>

            {scoreEnabled && (
              <section className="setup-section">
                <div className="setup-title"><span>02</span><div><b>计分规则</b><small>所有分值都可修改</small></div></div>
                <label className="initial-score"><span>统一设置初始积分</span><input type="number" inputMode="numeric" value={initialScore} onChange={(event) => { const value = Number(event.target.value); setInitialScore(value); setPlayerScores(playerScores.map(() => value)); }} /><small>可在玩家姓名右侧单独调整</small></label>
                <div className="turn-strategy"><span>击球顺序</span><div className="segmented"><button className={turnStrategy === "fixed" ? "active" : ""} onClick={() => setTurnStrategy("fixed")}>固定轮转</button><button className={turnStrategy === "winner_stays" ? "active" : ""} onClick={() => setTurnStrategy("winner_stays")}>得分者继续</button></div></div>
                <div className="rule-editor">
                  {rules.map((rule) => (
                    <label key={rule.id} className={!rule.enabled ? "disabled" : ""}>
                      <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} />
                      <span className={`rule-dot ${rule.color}`} /><input className="rule-name-input" aria-label={`${rule.label}名称`} value={rule.label} maxLength={12} onChange={(event) => updateRule(rule.id, { label: event.target.value })} /><select aria-label={`${rule.label}颜色`} value={rule.color} onChange={(event) => updateRule(rule.id, { color: event.target.value })}><option value="mint">绿色</option><option value="cyan">青色</option><option value="gold">金色</option><option value="violet">紫色</option><option value="red">红色</option></select><select aria-label={`${rule.label}类型`} value={rule.kind} onChange={(event) => updateRule(rule.id, { kind: event.target.value as "gain" | "penalty" })}><option value="gain">得分</option><option value="penalty">扣分</option></select>
                      <input aria-label={`${rule.label}分值`} type="number" min="0" inputMode="numeric" value={rule.value} onChange={(event) => updateRule(rule.id, { value: Number(event.target.value) })} />
                      <input className="rule-description-input" aria-label={`${rule.label}说明`} placeholder="计分说明（可选）" value={rule.description ?? ""} maxLength={40} onChange={(event) => updateRule(rule.id, { description: event.target.value })} /><span className="rule-order"><button type="button" onClick={() => moveRule(rule.id, -1)}>↑</button><button type="button" onClick={() => moveRule(rule.id, 1)}>↓</button>{rule.custom && <button type="button" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))}>删除</button>}</span>
                    </label>
                  ))}
                </div>
                <button className="add-player add-score-rule" type="button" onClick={addCustomRule}>＋ 添加自定义计分项</button>
                <label className="save-preset"><input type="checkbox" checked={savePreset} onChange={(event) => setSavePreset(event.target.checked)} /> 保存为本机常用计分预设</label>
              </section>
            )}

            <section className="setup-section">
              <div className="setup-title"><span>{scoreEnabled ? "03" : "02"}</span><div><b>奇招牌</b><small>{initialMode === "cards" ? "选择手牌归属方式" : "可与追分自由组合"}</small></div></div>
              <div className="segmented card-mode-picker">
                {initialMode !== "cards" && <button className={cardMode === "none" ? "active" : ""} onClick={() => setCardMode("none")}>不抽牌</button>}
                <button className={cardMode === "shared" ? "active" : ""} onClick={() => setCardMode("shared")}>共用手牌</button>
                <button className={cardMode === "independent" ? "active" : ""} onClick={() => setCardMode("independent")}>独立手牌</button>
              </div>
              {cardMode !== "none" && <><div className="deck-picker" aria-label="选择官方牌组">{OFFICIAL_DECKS.map((deck) => <button key={deck.id} className={deckId === deck.id ? "active" : ""} onClick={() => setDeckId(deck.id)}><b>{deck.name}</b><small>{officialDeckCardCount(deck)} 张 · {deck.difficulty}</small><span>{deck.description}</span></button>)}</div><label className="initial-score"><span>{cardMode === "shared" ? "共用起始手牌" : "每人起始手牌"}</span><input type="number" min="0" max="10" inputMode="numeric" value={handSize} onChange={(event) => setHandSize(Number(event.target.value))} /><small>{selectedDeck.name} · {selectedDeckCount} 张实体牌</small></label></>}
              <aside className="safety-callout"><span>!</span><p><b>安全跳过机制已启用</b>危险动作或身体不适时，双方同意即可跳过并自动补抽，不计犯规。</p></aside>
            </section>
          </div>
        ) : (
          <div className="review-card">
            <div><span>玩家与顺序</span><b>{validPlayers.map((player, index) => `${index + 1}. ${player.name}${scoreEnabled ? `（${player.initialScore} 分）` : ""}`).join("　")}</b></div>
            {scoreEnabled && <><div><span>击球顺序</span><b>{turnStrategy === "fixed" ? "固定轮转" : "得分者继续，犯规后轮转"}</b></div><div><span>计分项目</span><b>{rules.filter((rule) => rule.enabled).map((rule) => `${rule.label} ${rule.kind === "penalty" ? "−" : "+"}${rule.value}`).join(" · ")}</b></div></>}
            <div><span>奇招牌</span><b>{cardMode === "none" ? "不启用" : `${selectedDeck.name} V${selectedDeck.version} · ${selectedDeckCount} 张快照 · ${cardMode === "shared" ? "共用手牌" : "独立手牌"} · 起始 ${cardMode === "independent" ? Math.min(handSize, Math.floor(selectedDeckCount / validNames.length)) : handSize} 张`}</b></div>
            <aside className="safety-callout"><span>✓</span><p><b>规则快照将在开局时保存</b>后续修改默认规则，不会影响本场对局记录。</p></aside>
          </div>
        )}

        <footer className="modal-actions">
          <button className="secondary" onClick={() => reviewing ? setReviewing(false) : onClose()}>{reviewing ? "返回修改" : "取消"}</button>
          <button className="primary" disabled={!valid} onClick={() => reviewing ? submit() : setReviewing(true)}>{reviewing ? "确认并开始" : "下一步：确认规则"} <span>→</span></button>
        </footer>
      </section>
    </div>
  );
}

function ScoreBoard({ match, onScore, onTransfer, onCorrect, onUndo }: { match: BilliardsMatch; onScore: (ruleId: string, playerId: string) => void; onTransfer: (winnerId: string, loserIds: string[], amount: number, note: string) => void; onCorrect: (eventId: string) => void; onUndo: () => void }) {
  const rankings = getRankings(match).filter((player) => player.active);
  const current = match.players.find((player) => player.id === match.currentPlayerId) ?? match.players[0];
  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState(10);
  const [transferLosers, setTransferLosers] = useState<string[]>([]);
  const [transferNote, setTransferNote] = useState("");
  const selectedId = manualSelectedId && match.players.some((player) => player.id === manualSelectedId)
    ? manualSelectedId
    : current.id;
  return (
    <>
      <section className="match-section score-hero">
        <div className="section-heading"><div><p className="kicker">LIVE RANKING</p><h2>当前排名</h2></div><span className="turn-chip"><i /> 当前：{current.name}</span></div>
        <div className="ranking-grid">
          {rankings.map((player, index) => (
            <button key={player.id} className={`${selectedId === player.id ? "selected" : ""} ${player.id === match.currentPlayerId ? "current" : ""}`} onClick={() => setManualSelectedId(player.id === current.id ? null : player.id)}>
              <span className="rank">{index + 1}</span><span className="avatar">{player.name.slice(0, 1)}</span><span className="player-copy"><b>{player.name}</b><small>{player.id === match.currentPlayerId ? "正在击球" : `较开局 ${player.score - player.initialScore >= 0 ? "+" : ""}${player.score - player.initialScore}`}</small></span><strong>{player.score}<small>分</small></strong>
            </button>
          ))}
        </div>
      </section>

      <section className="match-section scoring-panel">
        <div className="section-heading"><div><p className="kicker">QUICK SCORE</p><h2>为 {match.players.find((player) => player.id === selectedId)?.name} 记分</h2></div><button className="text-button" disabled={!match.scoreEvents.length} onClick={onUndo}>↶ 撤销上一笔</button></div>
        <div className="score-actions">
          {match.rules.filter((rule) => rule.enabled).map((rule) => (
            <button key={rule.id} className={rule.color} onClick={() => { onScore(rule.id, selectedId); setManualSelectedId(null); }}><span>{rule.kind === "penalty" ? "−" : "+"}{rule.value}</span><b>{rule.label}</b></button>
          ))}
        </div>
        <div className="transfer-entry"><button className="text-button" onClick={() => setTransferOpen(!transferOpen)}>⇄ {transferOpen ? "收起转账计分" : "转账计分"}</button>{transferOpen && <div className="transfer-panel"><header><b>获胜者：{match.players.find((player) => player.id === selectedId)?.name}</b><small>每名所选输家支付同样分数，总分保持不变</small></header><div className="transfer-losers">{rankings.filter((player) => player.id !== selectedId).map((player) => <label key={player.id}><input type="checkbox" checked={transferLosers.includes(player.id)} onChange={(event) => setTransferLosers(event.target.checked ? [...transferLosers, player.id] : transferLosers.filter((id) => id !== player.id))} />{player.name}</label>)}</div><div className="transfer-fields"><label><span>每人支付</span><input aria-label="每名输家支付分数" type="number" min="1" inputMode="numeric" value={transferAmount} onChange={(event) => setTransferAmount(Number(event.target.value))} /></label><label><span>备注</span><input aria-label="转账计分备注" maxLength={80} placeholder="可选" value={transferNote} onChange={(event) => setTransferNote(event.target.value)} /></label><button disabled={!transferLosers.length || transferAmount <= 0} onClick={() => { onTransfer(selectedId, transferLosers, transferAmount, transferNote); setTransferLosers([]); setTransferNote(""); setManualSelectedId(null); setTransferOpen(false); }}>确认转账</button></div></div>}</div>
        <div className="ledger-preview">
          <div className="subheading"><b>最近流水</b><small>{match.scoreEvents.length} 笔</small></div>
          {match.scoreEvents.length ? match.scoreEvents.slice(0, 5).map((event) => {
            const player = match.players.find((item) => item.id === event.playerId);
            const delta = event.changes[event.playerId] ?? 0;
            const corrected = match.scoreEvents.some((item) => item.correctsEventId === event.id);
            return <div className="ledger-row" key={event.id}><span className={delta < 0 ? "negative" : "positive"}>{delta > 0 ? "+" : ""}{delta}</span><div><b>{player?.name} · {event.label}</b><small>{event.note ? `${event.note} · ` : ""}{formatTime(event.occurredAt)}{corrected ? " · 已更正" : ""}</small></div>{event.type !== "correction" && !corrected && <button className="ledger-correct" onClick={() => onCorrect(event.id)}>更正</button>}</div>;
          }) : <div className="empty-row">记下第一笔得分后，完整原因会出现在这里。</div>}
        </div>
      </section>
    </>
  );
}

function CardBoard({ match, onChange, toast }: { match: BilliardsMatch; onChange: (match: BilliardsMatch) => void; toast: (message: string) => void }) {
  const cards = match.cards!;
  const handIds = Object.keys(cards.hands).filter((id) => id === "shared" || match.players.some((player) => player.id === id && player.active));
  const [handId, setHandId] = useState(handIds[0]);
  const activeHand = cards.hands[handId] ? handId : handIds[0];
  const label = activeHand === "shared" ? "共用手牌" : match.players.find((player) => player.id === activeHand)?.name ?? "玩家手牌";
  const draw = () => {
    if (!cards.remaining.length) return;
    onChange(drawMatchCards(match, activeHand, 1));
    toast(`已为${label}抽取 1 张奇招牌`);
  };
  return (
    <section className="match-section card-board">
      <div className="section-heading"><div><p className="kicker">TRICK DECK · {cards.remaining.length} LEFT</p><h2>{label}</h2></div><button className="primary compact" disabled={!cards.remaining.length} onClick={draw}>抽一张 <span>→</span></button></div>
      {handIds.length > 1 && <div className="hand-tabs">{handIds.map((id) => <button key={id} className={activeHand === id ? "active" : ""} onClick={() => setHandId(id)}>{match.players.find((player) => player.id === id)?.name}<small>{cards.hands[id].length} 张</small></button>)}</div>}
      {cards.hands[activeHand].length ? (
        <div className="trick-grid">
          {cards.hands[activeHand].map((card) => (
            <article className="trick-card" key={card.instanceId}>
              <div className="card-top"><span>NO. {card.displayNumber}</span><i>8</i></div><h3>{card.title}</h3><p>{card.effect}</p>
              {card.safetyNote && <aside><b>安全提示</b>{card.safetyNote}</aside>}
              <div><button onClick={() => { onChange(playMatchCard(match, activeHand, card.instanceId)); toast(`已使用「${card.title}」`); }}>使用此卡</button><button onClick={() => { onChange(skipMatchCard(match, activeHand, card.instanceId)); toast(`已安全跳过「${card.title}」并补抽`); }}>安全跳过</button></div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><span>8</span><div><b>手牌还是空的</b><small>从剩余 {cards.remaining.length} 张牌中抽一张试试。</small></div><button onClick={draw}>立即抽牌</button></div>}
      {!!cards.events.length && <details className="card-log"><summary>卡牌流水 <span>{cards.events.length} 条</span></summary>{cards.events.slice(0, 8).map((event) => <div key={event.id}><b>{event.label}</b><small>{formatTime(event.occurredAt)}</small></div>)}</details>}
    </section>
  );
}

function PlayerManager({ match, onChange, toast }: { match: BilliardsMatch; onChange: (match: BilliardsMatch) => void; toast: (message: string) => void }) {
  const [name, setName] = useState("");
  const [initialScore, setInitialScore] = useState(0);
  const activePlayers = match.players.filter((player) => player.active);
  const departedPlayers = match.players.filter((player) => !player.active);
  const move = (playerId: string, direction: -1 | 1) => {
    const ids = activePlayers.map((player) => player.id);
    const index = ids.indexOf(playerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onChange(reorderPlayers(match, ids));
  };
  const add = () => {
    const updated = addMatchPlayer(match, name, initialScore);
    if (updated === match) return;
    onChange(updated);
    setName("");
    toast("已添加中途加入玩家；独立手牌模式下从空手牌开始");
  };
  return <section className="player-manager" aria-label="玩家管理"><header><div><p className="kicker">PLAYER CONTROL</p><h2>玩家与击球顺序</h2></div><div className="segmented strategy-switch"><button className={(match.turnStrategy ?? "fixed") === "fixed" ? "active" : ""} onClick={() => onChange({ ...match, turnStrategy: "fixed" })}>固定轮转</button><button className={match.turnStrategy === "winner_stays" ? "active" : ""} onClick={() => onChange({ ...match, turnStrategy: "winner_stays" })}>得分者继续</button></div></header><div className="manager-list">{activePlayers.map((player, index) => { const activity = hasPlayerActivity(match, player.id); return <article key={player.id} className={player.id === match.currentPlayerId ? "current" : ""}><span className="manager-order">{index + 1}</span><div><b>{player.name}</b><small>{player.id === match.currentPlayerId ? "当前击球" : `加入 ${formatTime(player.joinedAt ?? match.startedAt)}`} · {player.score} 分</small></div><div className="manager-actions"><button disabled={index === 0} onClick={() => move(player.id, -1)} aria-label={`${player.name}上移`}>↑</button><button disabled={index === activePlayers.length - 1} onClick={() => move(player.id, 1)} aria-label={`${player.name}下移`}>↓</button><button className="current-button" disabled={player.id === match.currentPlayerId} onClick={() => onChange(setCurrentPlayer(match, player.id))}>设为当前</button>{activity ? <button className="leave-button" disabled={activePlayers.length <= 2} onClick={() => { onChange(leaveMatchPlayer(match, player.id)); toast(`${player.name} 已离场，历史和最终分数已保留`); }}>离场</button> : <button className="leave-button" disabled={activePlayers.length <= 2} onClick={() => { onChange(deleteMatchPlayer(match, player.id)); toast(`${player.name} 尚无流水，已安全移除`); }}>移除</button>}</div></article>; })}</div>{!!departedPlayers.length && <details className="departed-list"><summary>已离场玩家 <span>{departedPlayers.length}</span></summary>{departedPlayers.map((player) => <div key={player.id}><b>{player.name}</b><small>{player.score} 分 · {player.leftAt ? formatTime(player.leftAt) : "已离场"}</small></div>)}</details>}<div className="mid-match-add"><input aria-label="中途加入玩家昵称" placeholder="新玩家昵称" maxLength={12} value={name} onChange={(event) => setName(event.target.value)} />{match.mode !== "cards" && <input aria-label="中途加入玩家初始积分" type="number" inputMode="numeric" value={initialScore} onChange={(event) => setInitialScore(Number(event.target.value))} />}<button disabled={!name.trim() || activePlayers.length >= 8} onClick={add}>＋ 中途加入</button></div></section>;
}

function ActiveMatchView({ match, onChange, onFinish, toast }: { match: BilliardsMatch; onChange: (match: BilliardsMatch) => void; onFinish: () => void; toast: (message: string) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => tick((value) => value + 1), 60000); return () => window.clearInterval(timer); }, []);
  const current = match.players.find((player) => player.id === match.currentPlayerId && player.active) ?? match.players.find((player) => player.active) ?? match.players[0];
  return (
    <div className="match-page page-shell">
      <section className="match-banner">
        <div><span className="live-label"><i /> 对局进行中</span><h1>{match.mode === "cards" ? "奇招卡牌局" : match.mode === "score_cards" ? "追分 · 奇招牌" : "多人追分"}</h1><p>{match.players.filter((player) => player.active).length} 位在场 · {formatDuration(match.startedAt)}{match.cards ? ` · ${match.cards.deckSnapshot?.name ?? "完整奇招"}` : ""}</p></div>
        <div className="match-banner-actions"><button onClick={() => setMoreOpen(!moreOpen)}>本局信息</button><button className="danger-text" onClick={onFinish}>结束对局</button></div>
      </section>
      {moreOpen && <><section className="match-info"><div><span>玩家顺序</span><b>{match.players.filter((player) => player.active).map((player) => player.name).join(" → ")}</b></div><div><span>当前玩家</span><b>{current.name} · {(match.turnStrategy ?? "fixed") === "fixed" ? "固定轮转" : "得分者继续"}</b></div><div><span>规则与牌组快照</span><b>{match.rules.filter((rule) => rule.enabled).map((rule) => `${rule.label} ${rule.kind === "penalty" ? "−" : "+"}${rule.value}`).join(" · ") || "纯奇招牌局"}{match.cards && ` · ${match.cards.deckSnapshot?.name ?? "完整奇招"} V${match.cards.deckSnapshot?.version ?? 1}`}</b></div></section><PlayerManager match={match} onChange={onChange} toast={toast} /></>}
      {match.mode !== "cards" && <ScoreBoard match={match} onScore={(ruleId, playerId) => { const rule = match.rules.find((item) => item.id === ruleId); onChange(applyScore(match, ruleId, playerId)); toast(`已记录 ${rule?.label ?? "计分"}`); }} onTransfer={(winnerId, loserIds, amount, note) => { onChange(applyTransferScore(match, winnerId, loserIds, amount, note)); toast(`已记录转账：每名输家支付 ${amount} 分`); }} onCorrect={(eventId) => { onChange(correctScoreEvent(match, eventId, "手动更正")); toast("已追加更正事件，原流水保持不变"); }} onUndo={() => { onChange(undoLastScore(match)); toast("已撤销上一笔计分"); }} />}
      {match.cards && <CardBoard match={match} onChange={onChange} toast={toast} />}
      <div className="match-dock"><button disabled={!match.scoreEvents.length} onClick={() => onChange(undoLastScore(match))}>↶<span>撤销</span></button><button className="dock-main" onClick={() => match.cards ? document.querySelector(".card-board")?.scrollIntoView({ behavior: "smooth" }) : document.querySelector(".scoring-panel")?.scrollIntoView({ behavior: "smooth" })}>{match.cards ? "抽牌" : "记分"}</button><button onClick={() => setMoreOpen(!moreOpen)}>•••<span>更多</span></button></div>
    </div>
  );
}

function PlayPage({ onStart }: { onStart: (mode: MatchMode) => void }) {
  return <div className="content-page page-shell"><header className="page-title"><p className="kicker">PLAY MODES</p><h1>今天想怎么玩？</h1><p>从轻松抽牌到完整追分，每种玩法都能独立开始，也能自由组合。</p></header><div className="mode-grid">
    <article className="mode-card featured"><span className="mode-number">01</span><div className="mode-symbol">8</div><p className="kicker">TRICK DECK</p><h2>奇招卡牌局</h2><p>51 张实体牌，不放回抽取。每一杆多一个意外，也保留安全跳过机制。</p><ul><li>2 人推荐</li><li>15–60 分钟</li><li>轻松</li></ul><div><button className="secondary" onClick={() => onStart("cards")}>查看并开始</button></div></article>
    <article className="mode-card"><span className="mode-number">02</span><div className="mode-symbol score">＋</div><p className="kicker">SCORE CHASE</p><h2>多人追分</h2><p>快速记录普胜、小金、大金和犯规，自动轮转与排名，适合整晚朋友局。</p><ul><li>2–8 人</li><li>30–120 分钟</li><li>可配规则</li></ul><div><button className="primary" onClick={() => onStart("score")}>开始设置 <span>→</span></button><button className="text-button" onClick={() => onStart("score_cards")}>同时加入奇招牌</button></div></article>
    {[["03","▦","九宫格挑战"],["04","♛","擂台模式"],["05","◷","限时闯关"]].map(([number, symbol, title]) => <article className="mode-card upcoming" key={number}><span className="mode-number">{number}</span><div className="mode-symbol">{symbol}</div><p className="kicker">COMING SOON</p><h2>{title}</h2><p>路线图后续玩法，核心对局稳定后开放。</p><span className="soon-chip">筹备中</span></article>)}
  </div></div>;
}

function DecksPage() {
  const [query, setQuery] = useState("");
  const cards = CARD_DEFINITIONS.filter((card) => `${card.title}${card.effect}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="content-page page-shell"><header className="page-title split"><div><p className="kicker">DECK LIBRARY</p><h1>牌组</h1><p>四个官方牌组均按版本保存完整快照，后续更新不会改变旧战绩。</p></div><div className="deck-summary"><span>4<small>官方牌组</small></span><span>V1<small>当前版本</small></span></div></header><div className="official-deck-grid">{OFFICIAL_DECKS.map((deck) => <section className="official-deck" key={deck.id}><div className="official-art"><span>8</span></div><div><p className="kicker">OFFICIAL · V{deck.version}</p><h2>{deck.name}</h2><p>{deck.description}</p><div className="tag-row"><span>{officialDeckCardCount(deck)} 张</span><span>{deck.difficulty}</span><span>{deck.safety}</span></div></div></section>)}</div><section className="card-catalog"><div className="section-heading"><div><p className="kicker">ALL CARDS</p><h2>完整卡牌清单</h2></div><label className="search"><span>⌕</span><input type="search" placeholder="搜索名称或效果" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div><div className="catalog-list">{cards.map((card) => <article key={card.id}><span>{card.id.slice(-3)}</span><div><b>{card.title}{card.count > 1 && <em> ×{card.count}</em>}</b><p>{card.effect}</p>{card.safetyNote && <small>! {card.safetyNote}</small>}</div></article>)}</div></section></div>;
}

function HistoryPage({ history, selectedId, onSelect }: { history: BilliardsMatch[]; selectedId?: string; onSelect: (id: string) => void }) {
  const selected = history.find((match) => match.id === selectedId);
  if (selected) {
    const rankings = getRankings(selected);
    const eventStats = selected.rules.map((rule) => ({ label: rule.label, count: selected.scoreEvents.filter((event) => event.label === rule.label).length })).filter((item) => item.count > 0);
    return <div className="content-page page-shell"><button className="back-link" onClick={() => onSelect("")}>← 返回战绩</button><header className="page-title"><p className="kicker">MATCH DETAIL</p><h1>{selected.mode === "cards" ? "奇招卡牌局" : "追分结算"}</h1><p>{formatTime(selected.startedAt)} · {formatDuration(selected.startedAt, selected.endedAt)}</p></header><section className="result-podium">{rankings.map((player, index) => <div key={player.id}><span>{index + 1}</span><b>{player.name}</b><strong>{player.score}<small> 分</small></strong><small>较开局 {player.score - player.initialScore >= 0 ? "+" : ""}{player.score - player.initialScore}</small></div>)}</section><section className="event-stats"><div><strong>{selected.scoreEvents.length}</strong><span>计分事件</span></div><div><strong>{selected.cards?.used.length ?? 0}</strong><span>已使用卡牌</span></div><div><strong>{selected.cards?.skipped.length ?? 0}</strong><span>安全跳过</span></div>{eventStats.slice(0, 3).map((item) => <div key={item.label}><strong>{item.count}</strong><span>{item.label}</span></div>)}</section><section className="history-detail"><div className="section-heading"><div><p className="kicker">FULL TIMELINE</p><h2>完整流水</h2></div></div>{[...selected.scoreEvents.map((event) => ({ id: event.id, at: event.occurredAt, label: `${selected.players.find((player) => player.id === event.playerId)?.name} · ${event.label}`, value: event.changes[event.playerId] })), ...(selected.cards?.events ?? []).map((event) => ({ id: event.id, at: event.occurredAt, label: event.label, value: undefined }))].sort((a, b) => b.at - a.at).map((event) => <div className="timeline-row" key={event.id}><span>{formatTime(event.at)}</span><b>{event.label}</b>{event.value !== undefined && <strong className={event.value < 0 ? "negative" : "positive"}>{event.value > 0 ? "+" : ""}{event.value}</strong>}</div>)}</section></div>;
  }
  return <div className="content-page page-shell"><header className="page-title"><p className="kicker">MATCH HISTORY</p><h1>战绩</h1><p>所有已结束对局都保存在这台设备上，可查看规则快照和完整流水。</p></header>{history.length ? <div className="history-grid">{history.map((match) => { const winner = getRankings(match)[0]; return <button key={match.id} onClick={() => onSelect(match.id)}><span className="history-type">{match.mode === "cards" ? "奇招牌" : match.mode === "score_cards" ? "追分 + 奇招牌" : "多人追分"}</span><b>{match.players.map((player) => player.name).join(" · ")}</b><small>{formatTime(match.startedAt)} · {formatDuration(match.startedAt, match.endedAt)}</small><div><span>第一名</span><strong>{winner?.name}{match.mode !== "cards" && ` · ${winner?.score} 分`}</strong><i>→</i></div></button>; })}</div> : <div className="large-empty"><span>⌁</span><h2>还没有战绩</h2><p>完成第一场对局后，排名、计分与卡牌流水都会保存在这里。</p></div>}</div>;
}

function ProfilePage({ history }: { history: BilliardsMatch[] }) {
  return <div className="content-page page-shell"><header className="profile-hero"><span className="profile-avatar">游</span><div><p className="kicker">LOCAL GUEST · V{APP_VERSION}</p><h1>游客模式</h1><p>R2 本地核心功能版，核心能力无需注册，本机数据会持续保存。</p></div><button className="secondary" disabled>登录 / 注册 · 即将开放</button></header><section className="local-stats"><div><strong>{history.length}</strong><span>已完成对局</span></div><div><strong>{history.reduce((sum, match) => sum + match.scoreEvents.length, 0)}</strong><span>计分流水</span></div><div><strong>{history.reduce((sum, match) => sum + (match.cards?.events.length ?? 0), 0)}</strong><span>卡牌事件</span></div></section><section className="settings-list"><header><p className="kicker">LOCAL DATA</p><h2>本机资料</h2></header><div><span>4</span><p><b>R2 应用版本</b><small>当前预览版本 v{APP_VERSION}</small></p><strong className="state-good">预览中</strong></div><div><span>◎</span><p><b>本地自动保存</b><small>刷新页面仍可恢复未结束对局</small></p><strong className="state-good">已开启</strong></div><div><span>⇅</span><p><b>云端同步</b><small>账户与跨设备同步将在认证阶段开放</small></p><strong>未连接</strong></div><div><span>○</span><p><b>常用球友</b><small>登录后保存注册玩家与临时球友</small></p><strong>即将开放</strong></div></section></div>;
}

function ConfirmDialog({ title, body, onCancel, onConfirm }: { title: string; body: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true"><span className="warning-icon">!</span><h2>{title}</h2><p>{body}</p><div className="modal-actions"><button className="secondary" onClick={onCancel}>继续对局</button><button className="danger-button" onClick={onConfirm}>确认结束并保存</button></div></section></div>;
}

function ActiveMatchProtectionDialog({ match, discardArmed, onContinue, onSave, onArmDiscard, onDiscard }: { match: BilliardsMatch; discardArmed: boolean; onContinue: () => void; onSave: () => void; onArmDiscard: () => void; onDiscard: () => void }) {
  return <div className="modal-backdrop"><section className="confirm-modal protection-modal" role="alertdialog" aria-modal="true" aria-labelledby="protect-title"><span className="warning-icon">!</span><h2 id="protect-title">发现未结束对局</h2><p>{match.players.map((player) => player.name).join("、")} 的对局仍在进行。新建前请选择如何处理，旧对局不会被静默覆盖。</p><div className="protection-actions"><button className="primary" onClick={onContinue}>继续当前对局</button><button className="secondary" onClick={onSave}>保存当前对局后新建</button>{discardArmed ? <button className="danger-button" onClick={onDiscard}>再次确认：放弃并新建</button> : <button className="text-button danger-text" onClick={onArmDiscard}>放弃旧对局…</button>}</div>{discardArmed && <small className="audit-note">确认后仍会保留可恢复快照和放弃时间。</small>}</section></div>;
}

function StorageRecoveryDialog({ issue, onRetry, onReset }: { issue: StorageIssue; onRetry: () => void; onReset: () => void }) {
  return <div className="modal-backdrop"><section className="confirm-modal protection-modal" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title"><span className="warning-icon">!</span><h2 id="recovery-title">本机数据无法读取</h2><p>原因：{issue.message}。为防止静默丢失，应用已暂停写入。你可以重试，或先备份原始数据再安全重置。</p><div className="protection-actions"><button className="primary" onClick={onRetry}>重试读取</button><button className="danger-button" onClick={onReset}>备份并安全重置</button></div></section></div>;
}

export default function GameApp() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [path, setPath] = useState("/");
  const [setupMode, setSetupMode] = useState<MatchMode | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingMode, setPendingMode] = useState<MatchMode | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadAppData();
      setData(loaded.data);
      setStorageIssue(loaded.issue ?? null);
      setPath(window.location.pathname || "/");
      setReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (ready && !storageIssue) localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(data));
  }, [data, ready, storageIssue]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2600);
    return () => window.clearTimeout(timer);
  }, [status]);

  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const start = (draft: MatchDraft, savePreset: boolean) => {
    if (data.activeMatch) return;
    const match = createMatch(draft);
    setData({ ...data, activeMatch: match, ...(savePreset ? { savedRules: draft.rules } : {}) });
    setSetupMode(null);
    navigate("/");
    setStatus("新对局已开始并保存到本机");
  };

  const updateActive = (match: BilliardsMatch) => setData((current) => ({ ...current, activeMatch: match }));
  const complete = () => {
    if (!data.activeMatch) return;
    const completed = finishMatch(data.activeMatch);
    setData({ ...data, activeMatch: null, history: [completed, ...data.history] });
    setConfirmEnd(false);
    navigate(`/history/${completed.id}`);
    setStatus("对局已结束，完整战绩已保存");
  };

  const openSetup = (mode: MatchMode) => {
    if (data.activeMatch) {
      setPendingMode(mode);
      setDiscardArmed(false);
      return;
    }
    setSetupMode(mode);
  };

  const continueActive = () => { setPendingMode(null); setDiscardArmed(false); navigate("/"); };
  const saveActiveAndCreate = () => {
    if (!data.activeMatch || !pendingMode) return;
    const mode = pendingMode;
    setData({ ...data, activeMatch: null, pausedMatches: [data.activeMatch, ...data.pausedMatches] });
    setPendingMode(null);
    setDiscardArmed(false);
    setSetupMode(mode);
  };
  const abandonActiveAndCreate = () => {
    if (!data.activeMatch || !pendingMode) return;
    const mode = pendingMode;
    setData({ ...data, activeMatch: null, recoverySnapshots: [{ match: data.activeMatch, abandonedAt: Date.now(), reason: "用户二次确认后放弃并新建" }, ...data.recoverySnapshots].slice(0, 10) });
    setPendingMode(null);
    setDiscardArmed(false);
    setSetupMode(mode);
  };
  const resumePaused = (id: string) => {
    const selected = data.pausedMatches.find((match) => match.id === id);
    if (!selected || data.activeMatch) return;
    setData({ ...data, activeMatch: selected, pausedMatches: data.pausedMatches.filter((match) => match.id !== id) });
    navigate("/");
    setStatus("已恢复保存的未结束对局");
  };
  const retryStorage = () => {
    const loaded = loadAppData();
    setData(loaded.data);
    setStorageIssue(loaded.issue ?? null);
    if (!loaded.issue) setStatus("本机数据已恢复");
  };
  const resetStorage = () => {
    if (!storageIssue) return;
    localStorage.setItem(`${APP_STORAGE_KEY}:corrupt-backup:${Date.now()}`, storageIssue.raw);
    localStorage.removeItem(APP_STORAGE_KEY);
    setData(EMPTY_DATA);
    setStorageIssue(null);
    setStatus("原始数据已备份，本机数据已安全重置");
  };

  const page = (() => {
    if (path === "/") return data.activeMatch
      ? <ActiveMatchView match={data.activeMatch} onChange={updateActive} onFinish={() => setConfirmEnd(true)} toast={setStatus} />
      : <EmptyHome onStart={openSetup} onNavigate={navigate} onResume={resumePaused} recent={data.history[0]} paused={data.pausedMatches} />;
    if (path === "/play") return <PlayPage onStart={openSetup} />;
    if (path === "/decks") return <DecksPage />;
    if (path.startsWith("/history")) return <HistoryPage history={data.history} selectedId={path.split("/")[2]} onSelect={(id) => navigate(id ? `/history/${id}` : "/history")} />;
    if (path === "/profile") return <ProfilePage history={data.history} />;
    return <div className="large-empty page-shell"><span>404</span><h2>页面不存在</h2><button className="primary" onClick={() => navigate("/")}>返回对局</button></div>;
  })();

  if (!ready) return <main className="loading-screen"><span>8</span><p>正在恢复本机对局…</p></main>;

  return (
    <main className="app-root">
      <AppHeader path={path} active={!!data.activeMatch} onNavigate={navigate} />
      {page}
      {setupMode && <SetupDialog initialMode={setupMode} savedRules={data.savedRules} onClose={() => setSetupMode(null)} onStart={start} />}
      {confirmEnd && <ConfirmDialog title="结束本场对局？" body="系统会保存最终排名、规则快照、计分流水和卡牌记录。结束后本场默认只读。" onCancel={() => setConfirmEnd(false)} onConfirm={complete} />}
      {pendingMode && data.activeMatch && <ActiveMatchProtectionDialog match={data.activeMatch} discardArmed={discardArmed} onContinue={continueActive} onSave={saveActiveAndCreate} onArmDiscard={() => setDiscardArmed(true)} onDiscard={abandonActiveAndCreate} />}
      {storageIssue && <StorageRecoveryDialog issue={storageIssue} onRetry={retryStorage} onReset={resetStorage} />}
      {status && <div className="status-toast" role="status"><span>✓</span>{status}</div>}
    </main>
  );
}
