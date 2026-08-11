"use client";

import { useEffect, useState } from "react";
import { CARD_DEFINITIONS, CardCategory } from "../src/data/cards";
import { getOfficialDeck, OFFICIAL_DECKS, officialDeckCardCount, OfficialDeckId } from "../src/lib/official-decks";
import {
  addMatchPlayer,
  applyBlackGoldScore,
  applyHandicapScore,
  applyScore,
  applyTransferScore,
  AutoDrawPolicy,
  backfillScoreEvent,
  BilliardsMatch,
  CardMode,
  createMatch,
  correctScoreEvent,
  deleteMatchPlayer,
  DEFAULT_RULES,
  drawMatchCards,
  DeckExhaustionPolicy,
  finishMatch,
  getPlayerAvatarColor,
  getRankings,
  hasPlayerActivity,
  leaveMatchPlayer,
  MatchDraft,
  MatchMode,
  playMatchCard,
  reorderPlayers,
  ScoreRule,
  setCurrentPlayer,
  skipMatchCard,
  triggerMatchCardRefill,
  TurnStrategy,
  undoLastScore,
  undoCardAction,
  updateMatchCardSettings,
} from "../src/lib/match";
import {
  calculateEightBallStats,
  correctEightBallRound,
  createEightBallMatch,
  EIGHT_BALL_WIN_LABELS,
  eightBallElapsedMs,
  EightBallDraft,
  EightBallLayout,
  EightBallMatch,
  EightBallServeRule,
  EightBallWinType,
  finishEightBallMatch,
  getEffectiveEightBallRounds,
  pauseEightBallMatch,
  recordEightBallRound,
  renameEightBallPlayer,
  resumeEightBallMatch,
  undoLastEightBallRound,
} from "../src/lib/eight-ball";
import {
  APP_DATA_CODEC,
  APP_STORAGE_KEY,
  AppData,
  BrowserStorageAdapter,
  EIGHT_BALL_LAYOUT_KEY,
  EMPTY_APP_DATA as EMPTY_DATA,
  loadAppData,
  ScorePreset,
  StorageIssue,
  SYNC_DEVICE_KEY,
  VersionedLocalStore,
} from "../src/lib/local-storage";
import {
  downloadMigrationBackup,
  prepareLocalMigration,
  PreparedLocalMigration,
  recordMigrationUpload,
  uploadLocalMigration,
} from "../src/lib/local-migration";

const APP_VERSION = "4.1.0";

const DEFAULT_SCORE_PRESET_ID = "builtin-14710";

const NAV_ITEMS = [
  { path: "/", label: "对局", icon: "◎" },
  { path: "/play", label: "玩法", icon: "◇" },
  { path: "/decks", label: "牌组", icon: "▤" },
  { path: "/history", label: "战绩", icon: "⌁" },
  { path: "/profile", label: "我的", icon: "○" },
];

function browserStore() {
  return new VersionedLocalStore(new BrowserStorageAdapter(window.localStorage));
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

function EmptyHome({ onStart, onStartEight, onNavigate, onResume, recent, paused }: { onStart: (mode: MatchMode) => void; onStartEight: () => void; onNavigate: (path: string) => void; onResume: (id: string) => void; recent?: BilliardsMatch; paused: BilliardsMatch[] }) {
  return (
    <div className="home-page page-shell">
      <section className="welcome-panel">
        <div>
          <p className="kicker">CHINESE BILLIARDS · MATCH NIGHT</p>
          <h1>今晚这桌，<br /><em>玩点不一样。</em></h1>
          <p className="lead">追分、抽牌、记流水，一部手机就能管好整场朋友局。</p>
          <div className="welcome-actions">
            <button className="primary" onClick={onStartEight}>开始中八比赛 <span>→</span></button>
            <button className="secondary" onClick={() => onStart("score")}>开始追分局</button>
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
        <button onClick={onStartEight}><span className="quick-icon red">8</span><div><b>中八双人计分板</b><small>抢 N / 自由局 · 逐局流水</small></div><i>→</i></button>
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

function ScoreValueInput({ rule, onValueChange }: { rule: ScoreRule; onValueChange: (value: number) => void }) {
  const [draftValue, setDraftValue] = useState(String(rule.value));

  return <input aria-label={`${rule.label}分值`} type="number" min="0" inputMode="numeric" value={draftValue} onChange={(event) => {
    const next = event.target.value;
    setDraftValue(next);
    if (next !== "" && Number.isFinite(Number(next))) onValueChange(Number(next));
  }} onBlur={() => {
    if (draftValue === "") {
      setDraftValue("0");
      onValueChange(0);
    }
  }} />;
}

function SetupDialog({ initialMode, savedRules, scorePresets, onClose, onStart }: { initialMode: MatchMode; savedRules: ScoreRule[]; scorePresets: ScorePreset[]; onClose: () => void; onStart: (draft: MatchDraft, presets: ScorePreset[]) => void }) {
  const [names, setNames] = useState(["玩家 A", "玩家 B"]);
  const [initialScore, setInitialScore] = useState(0);
  const [playerScores, setPlayerScores] = useState([0, 0]);
  const [turnStrategy, setTurnStrategy] = useState<TurnStrategy>("fixed");
  const [rules, setRules] = useState(DEFAULT_RULES.map((rule) => ({ ...rule })));
  const [cardMode, setCardMode] = useState<CardMode>(initialMode === "score" ? "none" : "shared");
  const [handSize, setHandSize] = useState(3);
  const [cardAutoDrawPolicy, setCardAutoDrawPolicy] = useState<AutoDrawPolicy>("manual");
  const [cardHandLimit, setCardHandLimit] = useState(5);
  const [cardExhaustionPolicy, setCardExhaustionPolicy] = useState<DeckExhaustionPolicy>("stop");
  const [excludedCategories, setExcludedCategories] = useState<CardCategory[]>([]);
  const [maxSafetyLevel, setMaxSafetyLevel] = useState<"low" | "medium" | "review">("review");
  const [excludedKeywords, setExcludedKeywords] = useState("");
  const [deckId, setDeckId] = useState<OfficialDeckId>("complete");
  const [reviewing, setReviewing] = useState(false);
  const [savePreset, setSavePreset] = useState(false);
  const [presets, setPresets] = useState(scorePresets.map((preset) => ({ ...preset, rules: preset.rules.map((rule) => ({ ...rule })) })));
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_SCORE_PRESET_ID);
  const [presetName, setPresetName] = useState("");
  const [newPresetId] = useState(() => `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const selectedCustomPreset = presets.find((preset) => preset.id === selectedPresetId);
  const scoreEnabled = initialMode !== "cards";
  const selectedDeck = getOfficialDeck(deckId);
  const selectedDeckCount = officialDeckCardCount(selectedDeck);
  const validPlayers = names.map((name, index) => ({ name: name.trim(), initialScore: playerScores[index] ?? initialScore })).filter((player) => player.name);
  const validNames = validPlayers.map((player) => player.name);
  const valid = validNames.length >= 2 && validNames.length <= 8 && validPlayers.every((player) => Number.isFinite(player.initialScore)) && rules.every((rule) => Number.isFinite(rule.value) && rule.value >= 0) && (!savePreset || !!presetName.trim());

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
  const loadPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    setSelectedPresetId(id);
    if (id === DEFAULT_SCORE_PRESET_ID) {
      setRules(DEFAULT_RULES.map((rule) => ({ ...rule })));
      setPresetName("");
    } else if (!id) {
      setRules(savedRules.map((rule) => ({ ...rule })));
      setPresetName("");
    } else if (preset) {
      setRules(preset.rules.map((rule) => ({ ...rule })));
      setPresetName(preset.name);
    }
  };
  const copyPreset = () => {
    const source = selectedCustomPreset;
    if (!source) return;
    const copy = { id: `preset-${Date.now()}`, name: `${source.name} 副本`, rules: source.rules.map((rule) => ({ ...rule })) };
    setPresets([...presets, copy]);
    setSelectedPresetId(copy.id);
    setPresetName(copy.name);
    setRules(copy.rules.map((rule) => ({ ...rule })));
    setSavePreset(true);
  };
  const deletePreset = () => {
    if (!selectedCustomPreset) return;
    setPresets(presets.filter((preset) => preset.id !== selectedPresetId));
    setSelectedPresetId("");
    setPresetName("");
    setRules(DEFAULT_RULES.map((rule) => ({ ...rule })));
    setSelectedPresetId(DEFAULT_SCORE_PRESET_ID);
  };
  const submit = () => {
    const nextPresets = savePreset && presetName.trim()
      ? selectedCustomPreset
        ? presets.map((preset) => preset.id === selectedPresetId ? { ...preset, name: presetName.trim(), rules: rules.map((rule) => ({ ...rule })) } : preset)
        : [...presets, { id: newPresetId, name: presetName.trim(), rules: rules.map((rule) => ({ ...rule })) }]
      : presets;
    onStart({
    mode: initialMode === "cards" ? "cards" : cardMode === "none" ? "score" : "score_cards",
    playerNames: validNames,
    initialScore,
    playerInitialScores: validPlayers.map((player) => player.initialScore),
    turnStrategy,
    rules,
      cardMode: initialMode === "cards" && cardMode === "none" ? "shared" : cardMode,
      initialHandSize: cardMode === "independent" ? Math.min(handSize, Math.floor(selectedDeckCount / validNames.length)) : handSize,
      cardAutoDrawPolicy,
      cardHandLimit: Math.max(handSize, cardHandLimit),
      cardExhaustionPolicy,
      cardFilter: { excludedCategories, maxSafetyLevel, excludedKeywords: excludedKeywords.split(/[，,]/).map((keyword) => keyword.trim()).filter(Boolean) },
      deckId,
    }, nextPresets);
  };

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
                <div className="preset-manager"><select aria-label="计分预设" value={selectedPresetId} onChange={(event) => loadPreset(event.target.value)}><option value={DEFAULT_SCORE_PRESET_ID}>14710 标准（默认）</option><option value="">上次使用规则</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" disabled={!selectedCustomPreset} onClick={copyPreset}>复制</button><button type="button" disabled={!selectedCustomPreset} onClick={deletePreset}>删除</button></div>
                <div className="rule-editor">
                  {rules.map((rule) => (
                    <label key={rule.id} className={!rule.enabled ? "disabled" : ""}>
                      <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} />
                      <span className={`rule-dot ${rule.color}`} /><input className="rule-name-input" aria-label={`${rule.label}名称`} value={rule.label} maxLength={12} onChange={(event) => updateRule(rule.id, { label: event.target.value })} /><select aria-label={`${rule.label}颜色`} value={rule.color} onChange={(event) => updateRule(rule.id, { color: event.target.value })}><option value="mint">绿色</option><option value="cyan">青色</option><option value="gold">金色</option><option value="violet">紫色</option><option value="red">红色</option></select><select aria-label={`${rule.label}类型`} value={rule.kind} onChange={(event) => updateRule(rule.id, { kind: event.target.value as "gain" | "penalty" })}><option value="gain">得分</option><option value="penalty">扣分</option></select>
                      <ScoreValueInput key={`${selectedPresetId}-${rule.id}`} rule={rule} onValueChange={(value) => updateRule(rule.id, { value })} />
                      <input className="rule-description-input" aria-label={`${rule.label}说明`} placeholder="计分说明（可选）" value={rule.description ?? ""} maxLength={40} onChange={(event) => updateRule(rule.id, { description: event.target.value })} /><span className="rule-order"><button type="button" onClick={() => moveRule(rule.id, -1)}>↑</button><button type="button" onClick={() => moveRule(rule.id, 1)}>↓</button>{rule.custom && <button type="button" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))}>删除</button>}</span>
                    </label>
                  ))}
                </div>
                <button className="add-player add-score-rule" type="button" onClick={addCustomRule}>＋ 添加自定义计分项</button>
                <div className="save-preset"><label><input type="checkbox" checked={savePreset} onChange={(event) => setSavePreset(event.target.checked)} /> {selectedCustomPreset ? "保存对当前预设的编辑" : "另存为命名预设"}</label>{savePreset && <input aria-label="计分预设名称" maxLength={24} placeholder="例如：周五俱乐部规则" value={presetName} onChange={(event) => setPresetName(event.target.value)} />}</div>
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
              {cardMode !== "none" && <div className="advanced-card-settings"><label><span>自动补牌</span><select aria-label="自动补牌策略" value={cardAutoDrawPolicy} onChange={(event) => setCardAutoDrawPolicy(event.target.value as AutoDrawPolicy)}><option value="manual">仅手动抽牌</option><option value="game">每小局补满</option><option value="round">每轮补满</option><option value="after_play">用牌后补一张</option></select></label><label><span>手牌上限</span><input aria-label="手牌上限" type="number" min={handSize} max="20" value={cardHandLimit} onChange={(event) => setCardHandLimit(Number(event.target.value))} /></label><label><span>牌库耗尽</span><select aria-label="牌库耗尽策略" value={cardExhaustionPolicy} onChange={(event) => setCardExhaustionPolicy(event.target.value as DeckExhaustionPolicy)}><option value="stop">停止抽牌</option><option value="reshuffle">确认后重洗弃牌</option></select></label><label><span>最高安全等级</span><select aria-label="卡牌最高安全等级" value={maxSafetyLevel} onChange={(event) => setMaxSafetyLevel(event.target.value as "low" | "medium" | "review")}><option value="review">包含待复核</option><option value="medium">排除待复核</option><option value="low">仅低风险</option></select></label><fieldset><legend>排除类别</legend>{([['strategy','竞技策略'],['social','社交惩罚'],['physical','身体动作'],['chaos','趣味混沌']] as const).map(([id, label]) => <label key={id}><input type="checkbox" checked={excludedCategories.includes(id)} onChange={(event) => setExcludedCategories(event.target.checked ? [...excludedCategories, id] : excludedCategories.filter((item) => item !== id))} />{label}</label>)}</fieldset><label className="filter-keywords"><span>排除关键词</span><input aria-label="排除卡牌关键词" placeholder="用逗号分隔，例如：红包，朋友圈" value={excludedKeywords} onChange={(event) => setExcludedKeywords(event.target.value)} /></label></div>}
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

function ScoreBoard({ match, onScore, onTransfer, onBackfill, onBlackGold, onHandicap, onCorrect, onUndo }: { match: BilliardsMatch; onScore: (ruleId: string, playerId: string, note: string) => void; onTransfer: (winnerId: string, loserIds: string[], amount: number, note: string) => void; onBackfill: (playerId: string, delta: number, label: string, note: string) => void; onBlackGold: (winnerId: string, baseAmount: number, note: string) => void; onHandicap: (beneficiaryId: string, grantorId: string, amount: number, note: string) => void; onCorrect: (eventId: string) => void; onUndo: () => void }) {
  const rankings = getRankings(match).filter((player) => player.active);
  const current = match.players.find((player) => player.id === match.currentPlayerId) ?? match.players[0];
  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState(10);
  const [transferLosers, setTransferLosers] = useState<string[]>([]);
  const [transferNote, setTransferNote] = useState("");
  const [scoreNote, setScoreNote] = useState("");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillDelta, setBackfillDelta] = useState(0);
  const [backfillLabel, setBackfillLabel] = useState("");
  const [backfillNote, setBackfillNote] = useState("");
  const [specialOpen, setSpecialOpen] = useState(false);
  const [specialAmount, setSpecialAmount] = useState(5);
  const [handicapGrantorId, setHandicapGrantorId] = useState("");
  const [specialNote, setSpecialNote] = useState("");
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
              <span className="rank">{index + 1}</span><span className={`avatar avatar-${getPlayerAvatarColor(player.id)}`}>{player.name.slice(0, 1)}</span><span className="player-copy"><b>{player.name}</b><small>{player.id === match.currentPlayerId ? "正在击球" : `较开局 ${player.score - player.initialScore >= 0 ? "+" : ""}${player.score - player.initialScore}`}</small></span><strong>{player.score}<small>分</small></strong>
            </button>
          ))}
        </div>
      </section>

      <section className="match-section scoring-panel">
        <div className="section-heading"><div><p className="kicker">QUICK SCORE</p><h2>为 {match.players.find((player) => player.id === selectedId)?.name} 记分</h2></div><button className="text-button" disabled={!match.scoreEvents.length} onClick={onUndo}>↶ 撤销上一笔</button></div>
        <div className="score-actions">
          {match.rules.filter((rule) => rule.enabled).map((rule) => (
            <button key={rule.id} className={rule.color} onClick={() => { onScore(rule.id, selectedId, scoreNote); setScoreNote(""); setManualSelectedId(null); }}><span>{rule.kind === "penalty" ? "−" : "+"}{rule.value}</span><b>{rule.label}</b></button>
          ))}
        </div>
        <label className="score-note"><span>本笔备注</span><input aria-label="下一笔计分备注" maxLength={80} placeholder="可选，例如：第三局翻中袋" value={scoreNote} onChange={(event) => setScoreNote(event.target.value)} /></label>
        <div className="transfer-entry"><button className="text-button" onClick={() => setTransferOpen(!transferOpen)}>⇄ {transferOpen ? "收起转账计分" : "转账计分"}</button>{transferOpen && <div className="transfer-panel"><header><b>获胜者：{match.players.find((player) => player.id === selectedId)?.name}</b><small>每名所选输家支付同样分数，总分保持不变</small></header><div className="transfer-losers">{rankings.filter((player) => player.id !== selectedId).map((player) => <label key={player.id}><input type="checkbox" checked={transferLosers.includes(player.id)} onChange={(event) => setTransferLosers(event.target.checked ? [...transferLosers, player.id] : transferLosers.filter((id) => id !== player.id))} />{player.name}</label>)}</div><div className="transfer-fields"><label><span>每人支付</span><input aria-label="每名输家支付分数" type="number" min="1" inputMode="numeric" value={transferAmount} onChange={(event) => setTransferAmount(Number(event.target.value))} /></label><label><span>备注</span><input aria-label="转账计分备注" maxLength={80} placeholder="可选" value={transferNote} onChange={(event) => setTransferNote(event.target.value)} /></label><button disabled={!transferLosers.length || transferAmount <= 0} onClick={() => { onTransfer(selectedId, transferLosers, transferAmount, transferNote); setTransferLosers([]); setTransferNote(""); setManualSelectedId(null); setTransferOpen(false); }}>确认转账</button></div></div>}</div>
        <div className="transfer-entry"><button className="text-button" onClick={() => setBackfillOpen(!backfillOpen)}>＋ {backfillOpen ? "收起补录" : "补录计分事件"}</button>{backfillOpen && <div className="backfill-panel"><label><span>原因</span><input aria-label="补录原因" maxLength={30} placeholder="例如：漏记犯规" value={backfillLabel} onChange={(event) => setBackfillLabel(event.target.value)} /></label><label><span>分值（可负数）</span><input aria-label="补录分值" type="number" inputMode="numeric" value={backfillDelta} onChange={(event) => setBackfillDelta(Number(event.target.value))} /></label><label><span>备注</span><input aria-label="补录备注" maxLength={80} placeholder="说明补录依据" value={backfillNote} onChange={(event) => setBackfillNote(event.target.value)} /></label><button disabled={!backfillLabel.trim() || backfillDelta === 0} onClick={() => { onBackfill(selectedId, backfillDelta, backfillLabel, backfillNote); setBackfillDelta(0); setBackfillLabel(""); setBackfillNote(""); setBackfillOpen(false); }}>确认补录</button></div>}</div>
        <div className="transfer-entry"><button className="text-button" onClick={() => setSpecialOpen(!specialOpen)}>◆ {specialOpen ? "收起特殊规则" : "黑金 / 让杆"}</button>{specialOpen && <div className="special-score-panel"><label><span>基础分</span><input aria-label="特殊规则基础分" type="number" min="1" inputMode="numeric" value={specialAmount} onChange={(event) => setSpecialAmount(Number(event.target.value))} /></label><label><span>让分方</span><select aria-label="让杆让分方" value={handicapGrantorId} onChange={(event) => setHandicapGrantorId(event.target.value)}><option value="">请选择</option>{rankings.filter((player) => player.id !== selectedId).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label><span>备注</span><input aria-label="特殊规则备注" maxLength={80} placeholder="可选" value={specialNote} onChange={(event) => setSpecialNote(event.target.value)} /></label><button disabled={specialAmount <= 0} onClick={() => { onBlackGold(selectedId, specialAmount, specialNote); setSpecialNote(""); setSpecialOpen(false); }}>黑金结算（每家 ×2）</button><button disabled={specialAmount <= 0 || !handicapGrantorId} onClick={() => { onHandicap(selectedId, handicapGrantorId, specialAmount, specialNote); setSpecialNote(""); setHandicapGrantorId(""); setSpecialOpen(false); }}>记录让杆</button></div>}</div>
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
  const [reshuffleArmed, setReshuffleArmed] = useState(false);
  const [linkPlayerId, setLinkPlayerId] = useState(match.currentPlayerId);
  const [linkDelta, setLinkDelta] = useState(0);
  const [linkNote, setLinkNote] = useState("");
  const activeHand = cards.hands[handId] ? handId : handIds[0];
  const label = activeHand === "shared" ? "共用手牌" : match.players.find((player) => player.id === activeHand)?.name ?? "玩家手牌";
  const handLimit = cards.handLimit ?? Math.max(cards.initialHandSize, 5);
  const canRecycle = cards.exhaustionPolicy === "reshuffle" && (cards.used.length > 0 || cards.skipped.length > 0);
  const draw = () => {
    if (!cards.remaining.length && canRecycle && !reshuffleArmed) { setReshuffleArmed(true); return; }
    const updated = drawMatchCards(match, activeHand, 1, Date.now(), undefined, { allowReshuffle: reshuffleArmed });
    onChange(updated);
    setReshuffleArmed(false);
    toast(`已为${label}抽取 1 张奇招牌`);
  };
  const triggerRefill = (trigger: "game" | "round") => {
    if (!cards.remaining.length && canRecycle && !reshuffleArmed) { setReshuffleArmed(true); toast("牌库已耗尽，请再次确认重洗弃牌"); return; }
    const updated = triggerMatchCardRefill(match, trigger, Date.now(), undefined, reshuffleArmed);
    onChange(updated);
    setReshuffleArmed(false);
    toast(trigger === "game" ? "已按新小局策略补牌" : "已按新一轮策略补牌");
  };
  return (
    <section className="match-section card-board">
      <div className="section-heading"><div><p className="kicker">TRICK DECK · {cards.remaining.length} LEFT</p><h2>{label}</h2></div><button className={reshuffleArmed ? "danger-button compact" : "primary compact"} disabled={cards.hands[activeHand].length >= handLimit || (!cards.remaining.length && !canRecycle)} onClick={draw}>{reshuffleArmed ? "确认重洗并抽牌" : "抽一张"} <span>→</span></button></div>
      <div className="card-control-panel"><label><span>补牌策略</span><select aria-label="对局中自动补牌策略" value={cards.autoDrawPolicy ?? "manual"} onChange={(event) => onChange(updateMatchCardSettings(match, { autoDrawPolicy: event.target.value as AutoDrawPolicy }))}><option value="manual">仅手动</option><option value="game">每小局</option><option value="round">每轮</option><option value="after_play">用牌后</option></select></label><label><span>手牌上限</span><input aria-label="对局中手牌上限" type="number" min={cards.initialHandSize} max="20" value={handLimit} onChange={(event) => onChange(updateMatchCardSettings(match, { handLimit: Number(event.target.value) }))} /></label><label><span>耗尽策略</span><select aria-label="对局中牌库耗尽策略" value={cards.exhaustionPolicy ?? "stop"} onChange={(event) => onChange(updateMatchCardSettings(match, { exhaustionPolicy: event.target.value as DeckExhaustionPolicy }))}><option value="stop">停止抽牌</option><option value="reshuffle">确认后重洗</option></select></label><button disabled={cards.autoDrawPolicy !== "game"} onClick={() => triggerRefill("game")}>{reshuffleArmed ? "确认重洗并补满" : "新小局补牌"}</button><button disabled={cards.autoDrawPolicy !== "round"} onClick={() => triggerRefill("round")}>{reshuffleArmed ? "确认重洗并补满" : "新一轮补牌"}</button></div>
      {handIds.length > 1 && <div className="hand-tabs">{handIds.map((id) => <button key={id} className={activeHand === id ? "active" : ""} onClick={() => setHandId(id)}>{match.players.find((player) => player.id === id)?.name}<small>{cards.hands[id].length} 张</small></button>)}</div>}
      <div className="card-score-link"><header><b>卡牌影响积分（可选）</b><small>填写非零分值后，使用卡牌会生成双向关联计分事件。</small></header><select aria-label="卡牌计分玩家" value={linkPlayerId} onChange={(event) => setLinkPlayerId(event.target.value)}>{match.players.filter((player) => player.active).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><input aria-label="卡牌关联分值" type="number" inputMode="numeric" value={linkDelta} onChange={(event) => setLinkDelta(Number(event.target.value))} /><input aria-label="卡牌关联计分备注" maxLength={80} placeholder="关联说明（可选）" value={linkNote} onChange={(event) => setLinkNote(event.target.value)} /></div>
      {cards.hands[activeHand].length ? (
        <div className="trick-grid">
          {cards.hands[activeHand].map((card) => (
            <article className="trick-card" key={card.instanceId}>
              <div className="card-top"><span>NO. {card.displayNumber}</span><i>8</i></div><h3>{card.title}</h3><p>{card.effect}</p>
              {card.safetyNote && <aside><b>安全提示</b>{card.safetyNote}</aside>}
              <div><button onClick={() => { onChange(playMatchCard(match, activeHand, card.instanceId, Date.now(), linkDelta ? { playerId: linkPlayerId, delta: linkDelta, note: linkNote } : undefined)); setLinkDelta(0); setLinkNote(""); toast(`已使用「${card.title}」${linkDelta ? "并关联计分" : ""}`); }}>使用此卡</button><button onClick={() => { onChange(skipMatchCard(match, activeHand, card.instanceId)); toast(`已安全跳过「${card.title}」并补抽`); }}>安全跳过</button></div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><span>8</span><div><b>手牌还是空的</b><small>从剩余 {cards.remaining.length} 张牌中抽一张试试。</small></div><button onClick={draw}>立即抽牌</button></div>}
      {!!cards.events.length && <details className="card-log"><summary>卡牌流水 <span>{cards.events.length} 条</span></summary>{cards.events.slice(0, 8).map((event) => <div key={event.id}><b>{event.label}{event.relatedScoreEventId && " · 已关联积分"}</b><span><small>{formatTime(event.occurredAt)}</small><button onClick={() => { onChange(undoCardAction(match, event.id)); toast("已撤销整组卡牌动作及关联积分"); }}>撤销</button></span></div>)}</details>}
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
      {match.mode !== "cards" && <ScoreBoard match={match} onScore={(ruleId, playerId, note) => { const rule = match.rules.find((item) => item.id === ruleId); onChange(applyScore(match, ruleId, playerId, Date.now(), note)); toast(`已记录 ${rule?.label ?? "计分"}`); }} onTransfer={(winnerId, loserIds, amount, note) => { onChange(applyTransferScore(match, winnerId, loserIds, amount, note)); toast(`已记录转账：每名输家支付 ${amount} 分`); }} onBackfill={(playerId, delta, label, note) => { onChange(backfillScoreEvent(match, playerId, delta, label, note)); toast(`已补录 ${label} ${delta > 0 ? "+" : ""}${delta} 分`); }} onBlackGold={(winnerId, baseAmount, note) => { onChange(applyBlackGoldScore(match, winnerId, baseAmount, note)); toast(`黑金结算完成：每家支付 ${baseAmount * 2} 分`); }} onHandicap={(beneficiaryId, grantorId, amount, note) => { onChange(applyHandicapScore(match, beneficiaryId, grantorId, amount, note)); toast(`已记录让杆 ${amount} 分`); }} onCorrect={(eventId) => { onChange(correctScoreEvent(match, eventId, "手动更正")); toast("已追加更正事件，原流水保持不变"); }} onUndo={() => { onChange(undoLastScore(match)); toast("已撤销上一笔计分"); }} />}
      {match.cards && <CardBoard match={match} onChange={onChange} toast={toast} />}
      <div className="match-dock"><button disabled={!match.scoreEvents.length} onClick={() => onChange(undoLastScore(match))}>↶<span>撤销</span></button><button className="dock-main" onClick={() => match.cards ? document.querySelector(".card-board")?.scrollIntoView({ behavior: "smooth" }) : document.querySelector(".scoring-panel")?.scrollIntoView({ behavior: "smooth" })}>{match.cards ? "抽牌" : "记分"}</button><button onClick={() => setMoreOpen(!moreOpen)}>•••<span>更多</span></button></div>
    </div>
  );
}

function PlayPage({ onStart, onStartEight }: { onStart: (mode: MatchMode) => void; onStartEight: () => void }) {
  return <div className="content-page page-shell"><header className="page-title"><p className="kicker">PLAY MODES</p><h1>今天想怎么玩？</h1><p>从轻松抽牌到完整追分，每种玩法都能独立开始，也能自由组合。</p></header><div className="mode-grid">
    <article className="mode-card featured"><span className="mode-number">00</span><div className="mode-symbol score">8</div><p className="kicker">CHINESE EIGHT</p><h2>中八双人赛</h2><p>红蓝二等分计分板，记录普胜、炸清、接清、犯规和逐局可追溯流水。</p><ul><li>2 人</li><li>抢 N / 自由局</li><li>离线可用</li></ul><div><button className="primary" onClick={onStartEight}>开始中八设置 <span>→</span></button></div></article>
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

function EightBallSetupDialog({ defaultLayout, onClose, onStart }: { defaultLayout: EightBallLayout; onClose: () => void; onStart: (draft: EightBallDraft) => void }) {
  const [names, setNames] = useState<[string, string]>(["玩家 A", "玩家 B"]);
  const [raceMode, setRaceMode] = useState<"race" | "free">("race");
  const [raceTo, setRaceTo] = useState(5);
  const [firstServer, setFirstServer] = useState<0 | 1>(0);
  const [serveRule, setServeRule] = useState<EightBallServeRule>("alternate");
  const [layout, setLayout] = useState<EightBallLayout>(defaultLayout);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const valid = names.every((name) => name.trim()) && (raceMode === "free" || (Number.isInteger(raceTo) && raceTo >= 1 && raceTo <= 99));
  return <div className="modal-backdrop"><section className="setup-modal eight-setup" role="dialog" aria-modal="true"><header className="modal-heading"><div><p className="kicker">CHINESE EIGHT · NEW MATCH</p><h2>创建中八比赛</h2></div><button className="icon-button" onClick={onClose}>×</button></header><div className="setup-body"><section className="setup-section"><div className="setup-title"><span>01</span><div><b>双方选手</b><small>稳定选手 ID，不受比赛中改名影响</small></div></div><div className="player-inputs">{names.map((name, index) => <label className="player-input" key={index}><span>{index ? "蓝" : "红"}</span><input aria-label={`中八玩家 ${index + 1} 姓名`} maxLength={16} value={name} onChange={(event) => setNames(names.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as [string, string])} /></label>)}</div></section><section className="setup-section"><div className="setup-title"><span>02</span><div><b>赛制与开球</b><small>达到目标后仍由你确认结束</small></div></div><div className="eight-form-grid"><label><span>赛制</span><select value={raceMode} onChange={(event) => setRaceMode(event.target.value as "race" | "free")}><option value="race">抢 N 局</option><option value="free">自由计分</option></select></label>{raceMode === "race" && <label><span>抢几局</span><input type="number" min="1" max="99" value={raceTo} onChange={(event) => setRaceTo(Number(event.target.value))} /></label>}<label><span>先开球</span><select value={firstServer} onChange={(event) => setFirstServer(Number(event.target.value) as 0 | 1)}><option value={0}>{names[0] || "玩家 A"}</option><option value={1}>{names[1] || "玩家 B"}</option></select></label><label><span>后续开球</span><select value={serveRule} onChange={(event) => setServeRule(event.target.value as EightBallServeRule)}><option value="alternate">轮流开球</option><option value="winner">胜者开球</option></select></label><label><span>计分板布局</span><select value={layout} onChange={(event) => setLayout(event.target.value as EightBallLayout)}><option value="stacked">上下二等分</option><option value="split">左右二等分</option></select></label></div></section><section className="setup-section"><div className="setup-title"><span>03</span><div><b>比赛资料</b><small>全部可选，将进入战绩导出</small></div></div><div className="eight-form-grid"><label><span>比赛名称</span><input maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span>地点</span><input maxLength={40} value={location} onChange={(event) => setLocation(event.target.value)} /></label><label className="wide"><span>备注</span><input maxLength={120} value={note} onChange={(event) => setNote(event.target.value)} /></label></div></section></div><footer className="modal-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!valid} onClick={() => onStart({ playerNames: names, raceTo: raceMode === "race" ? raceTo : null, firstServer, serveRule, layout, title, location, note })}>确认并开始 <span>→</span></button></footer></section></div>;
}

function durationLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function exportEightBallJson(match: EightBallMatch) {
  const payload = { exportVersion: 1, exportedAt: new Date().toISOString(), match, effectiveRounds: getEffectiveEightBallRounds(match), stats: calculateEightBallStats(match) };
  downloadText(`中八战绩-${match.id}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function printEightBall(match: EightBallMatch) {
  const stats = calculateEightBallStats(match); const rounds = getEffectiveEightBallRounds(match);
  const popup = window.open("", "_blank", "noopener,noreferrer"); if (!popup) return;
  popup.document.write(`<!doctype html><meta charset="utf-8"><title>中八战绩</title><style>body{font-family:system-ui;padding:32px;color:#17231d}h1{margin-bottom:4px}.score{display:flex;gap:30px;font-size:28px;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}@media print{button{display:none}}</style><h1>${match.title || "中八双人赛"}</h1><p>${match.location || "未填写地点"} · ${new Date(match.startedAt).toLocaleString("zh-CN")} · ${match.raceTo ? `抢 ${match.raceTo} 局` : "自由局"}</p><div class="score">${match.players.map((p) => `<span>${p.name} ${stats[p.id].score}</span>`).join("")}</div><table><thead><tr><th>局</th><th>开球</th><th>胜者</th><th>胜法</th><th>犯规</th><th>比分</th><th>用时</th><th>备注</th></tr></thead><tbody>${rounds.map((r, i) => `<tr><td>${i + 1}</td><td>${match.players.find(p => p.id === r.serverId)?.name}</td><td>${match.players.find(p => p.id === r.winnerId)?.name}</td><td>${EIGHT_BALL_WIN_LABELS[r.winType]}</td><td>${match.players.map(p => `${p.name} ${r.fouls[p.id] ?? 0}`).join(" / ")}</td><td>${match.players.map(p => r.after[p.id] ?? 0).join(" : ")}</td><td>${durationLabel(r.confirmedAt-r.startedAt)}</td><td>${r.note}</td></tr>`).join("")}</tbody></table><p>事件 ${match.events.length} 条 · match_version ${match.matchVersion}</p><button onclick="print()">打印 / 另存 PDF</button>`); popup.document.close();
}

function exportEightBallImage(match: EightBallMatch) {
  const stats = calculateEightBallStats(match); const rounds = getEffectiveEightBallRounds(match); const height = 360 + rounds.length * 44;
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  const rows = rounds.map((round, index) => `<text x="50" y="${330 + index * 44}" class="row">${index + 1}. ${escape(match.players.find((p) => p.id === round.winnerId)?.name ?? "")} · ${EIGHT_BALL_WIN_LABELS[round.winType]} · ${match.players.map((p) => round.after[p.id] ?? 0).join(" : ")} · ${escape(round.note)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><style>.title{font:700 38px system-ui;fill:#eff8f2}.meta{font:18px system-ui;fill:#91a89d}.score{font:700 60px system-ui;fill:#76e6ad}.row{font:20px system-ui;fill:#dce9e1}</style><rect width="100%" height="100%" fill="#09120f"/><text x="50" y="65" class="title">${escape(match.title || "中八双人赛")}</text><text x="50" y="105" class="meta">${escape(match.location || "本地比赛")} · ${match.raceTo ? `抢 ${match.raceTo} 局` : "自由局"}</text><text x="50" y="190" class="score">${escape(match.players[0].name)} ${stats[match.players[0].id].score}  :  ${stats[match.players[1].id].score} ${escape(match.players[1].name)}</text><text x="50" y="240" class="meta">普胜 / 炸清 / 接清 / 犯规：${match.players.map(p => `${escape(p.name)} ${stats[p.id].normal}/${stats[p.id].breakClear}/${stats[p.id].runout}/${stats[p.id].fouls}`).join("　")}</text><text x="50" y="290" class="meta">逐局流水</text>${rows}</svg>`;
  downloadText(`中八战绩-${match.id}.svg`, svg, "image/svg+xml");
}

function EightBallBoard({ match, onChange, onFinish, toast }: { match: EightBallMatch; onChange: (match: EightBallMatch) => void; onFinish: () => void; toast: (message: string) => void }) {
  const [, tick] = useState(0); const [winnerId, setWinnerId] = useState(match.players[0].id); const [winType, setWinType] = useState<EightBallWinType>("normal"); const [fouls, setFouls] = useState<Record<string, number>>({}); const [note, setNote] = useState(""); const [roundStartedAt, setRoundStartedAt] = useState(() => Date.now()); const [editingEventId, setEditingEventId] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => tick((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const stats = calculateEightBallStats(match); const rounds = getEffectiveEightBallRounds(match); const reached = match.raceTo && match.players.some((player) => stats[player.id].score >= match.raceTo!);
  const confirm = () => { const round = { winnerId, winType, fouls: Object.fromEntries(match.players.map((p) => [p.id, Math.max(0, Math.trunc(fouls[p.id] ?? 0))])), note, startedAt: roundStartedAt }; const updated = editingEventId ? correctEightBallRound(match, editingEventId, { ...round, confirmedAt: Date.now() }) : recordEightBallRound(match, round); onChange(updated); setFouls({}); setNote(""); setRoundStartedAt(Date.now()); setEditingEventId(null); toast(editingEventId ? "已追加更正事件并重新计算全部统计" : "本局已记录并自动保存"); };
  return <div className="eight-page page-shell"><section className="eight-topbar"><div><span className="live-label"><i /> 中八比赛进行中</span><h1>{match.title || `第 ${rounds.length + 1} 局`}</h1><p>第 {rounds.length + 1} 局 · {durationLabel(eightBallElapsedMs(match))}{match.raceTo ? ` · 抢 ${match.raceTo} 局` : " · 自由局"}</p></div><div><button onClick={() => onChange({ ...match, layout: match.layout === "stacked" ? "split" : "stacked" })}>{match.layout === "stacked" ? "切换左右" : "切换上下"}</button><button onClick={() => onChange(match.pausedAt ? resumeEightBallMatch(match) : pauseEightBallMatch(match))}>{match.pausedAt ? "继续计时" : "暂停计时"}</button><button className="danger-text" onClick={onFinish}>结束比赛</button></div></section>{match.pausedAt && <div className="eight-paused">比赛已暂停，计时和逐局录入已停止。</div>}{reached && <div className="target-notice">已达到目标局数；比赛不会自动锁死，请确认无误后手动结束。</div>}<section className={`eight-scoreboard ${match.layout}`}>{match.players.map((player, index) => <article key={player.id} className={index ? "blue" : "red"}><div><input aria-label={`${player.name}姓名`} value={player.name} onChange={(event) => onChange(renameEightBallPlayer(match, player.id, event.target.value))} /><small>{index ? "BLUE" : "RED"}</small></div><strong>{stats[player.id].score}</strong><dl><div><dt>普胜</dt><dd>{stats[player.id].normal}</dd></div><div><dt>炸清</dt><dd>{stats[player.id].breakClear}</dd></div><div><dt>接清</dt><dd>{stats[player.id].runout}</dd></div><div><dt>犯规</dt><dd>{stats[player.id].fouls}</dd></div></dl></article>)}</section><section className="eight-round-panel"><div className="section-heading"><div><p className="kicker">ROUND {rounds.length + 1}</p><h2>记录本局结果</h2></div><button className="text-button" disabled={!rounds.length} onClick={() => { onChange(undoLastEightBallRound(match)); toast("已追加撤销事件，原流水保留"); }}>↶ 撤销上一局</button></div><div className="eight-winner-picker">{match.players.map((player) => <button key={player.id} className={winnerId === player.id ? "active" : ""} onClick={() => setWinnerId(player.id)}>{player.name} 获胜</button>)}</div><div className="segmented">{Object.entries(EIGHT_BALL_WIN_LABELS).map(([id, label]) => <button key={id} className={winType === id ? "active" : ""} onClick={() => setWinType(id as EightBallWinType)}>{label}</button>)}</div><div className="eight-fouls">{match.players.map((player) => <label key={player.id}><span>{player.name} 本局犯规</span><input type="number" min="0" inputMode="numeric" value={fouls[player.id] ?? 0} onChange={(event) => setFouls({ ...fouls, [player.id]: Number(event.target.value) })} /></label>)}</div><label className="score-note"><span>本局备注</span><input maxLength={120} placeholder="可选" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary eight-confirm" disabled={!!match.pausedAt} onClick={confirm}>确认本局并进入下一局</button></section><section className="eight-ledger"><div className="section-heading"><div><p className="kicker">APPEND-ONLY LEDGER</p><h2>逐局流水</h2></div><span>{match.events.length} 条原始事件</span></div>{[...rounds].reverse().map((round, reverseIndex) => <article key={round.eventId}><span>第 {rounds.length - reverseIndex} 局</span><div><b>{match.players.find((p) => p.id === round.winnerId)?.name} · {EIGHT_BALL_WIN_LABELS[round.winType]}</b><small>开球：{match.players.find((p) => p.id === round.serverId)?.name} · 犯规 {match.players.map((p) => `${p.name} ${round.fouls[p.id] ?? 0}`).join(" / ")} · {durationLabel(round.confirmedAt - round.startedAt)}{round.note ? ` · ${round.note}` : ""}</small></div><strong>{match.players.map((p) => round.after[p.id] ?? 0).join(" : ")}</strong><button onClick={() => { const other = match.players.find((p) => p.id !== round.winnerId)!; onChange(correctEightBallRound(match, round.eventId, { ...round, winnerId: other.id })); toast("已追加更正事件并重新计算全部统计"); }}>改判胜者</button></article>)}</section></div>;
}

function HistoryCorrectionDock({ match, onChange }: { match: BilliardsMatch; onChange: (match: BilliardsMatch) => void }) {
  const [enabled, setEnabled] = useState(false);
  const correctable = match.scoreEvents.filter((event) => event.type !== "correction" && !match.scoreEvents.some((item) => item.correctsEventId === event.id));
  return <aside className={`history-correction ${enabled ? "enabled" : ""}`}><div><b>{enabled ? "受控纠错模式已开启" : "已结束对局默认只读"}</b><small>{enabled ? "更正会追加反向事件，原流水不会删除。" : "仅在确认需要修正结算时开启。"}</small></div><button className={enabled ? "danger-button" : "secondary"} onClick={() => setEnabled(!enabled)}>{enabled ? "退出纠错" : "进入纠错模式"}</button>{enabled && <div className="history-correction-events">{correctable.length ? correctable.slice(0, 8).map((event) => <button key={event.id} onClick={() => { onChange(correctScoreEvent(match, event.id, "结束局受控更正", Date.now(), true)); setEnabled(false); }}>更正：{match.players.find((player) => player.id === event.playerId)?.name} · {event.label}</button>) : <small>当前没有可更正的计分事件。</small>}</div>}</aside>;
}

function scoreMatchTimeline(match: BilliardsMatch) {
  return [
    ...match.scoreEvents.map((event) => ({ id: event.id, kind: "积分", at: event.occurredAt, label: event.label, player: match.players.find((player) => player.id === event.playerId)?.name ?? event.playerId, detail: Object.entries(event.changes).map(([id, value]) => `${match.players.find((p) => p.id === id)?.name ?? id} ${value > 0 ? "+" : ""}${value}`).join(" / "), note: event.note ?? "", linkedId: event.linkedCardEventId })),
    ...(match.cards?.events ?? []).map((event) => ({ id: event.id, kind: "卡牌", at: event.occurredAt, label: event.label, player: event.handId === "shared" ? "共用手牌" : match.players.find((player) => player.id === event.handId)?.name ?? event.handId, detail: event.card?.title ?? "", note: "", linkedId: event.relatedScoreEventId })),
  ].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function exportScoreJson(match: BilliardsMatch) {
  downloadText(`追分战绩-${match.id}.json`, JSON.stringify({ exportVersion: 1, exportedAt: new Date().toISOString(), match, rankings: getRankings(match), timeline: scoreMatchTimeline(match) }, null, 2), "application/json");
}

function printScoreMatch(match: BilliardsMatch) {
  const timeline = scoreMatchTimeline(match); const popup = window.open("", "_blank", "noopener,noreferrer"); if (!popup) return;
  popup.document.write(`<!doctype html><meta charset="utf-8"><title>追分战绩</title><style>body{font-family:system-ui;padding:32px;color:#17231d}h1{margin-bottom:4px}.score{display:flex;gap:24px;font-size:24px;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}@media print{button{display:none}}</style><h1>${match.mode === "cards" ? "奇招卡牌局" : "追分战绩"}</h1><p>${new Date(match.startedAt).toLocaleString("zh-CN")} · ${formatDuration(match.startedAt, match.endedAt)}</p><div class="score">${getRankings(match).map((p, i) => `<span>${i + 1}. ${p.name} ${p.score} 分（开局 ${p.initialScore}）</span>`).join("")}</div><table><thead><tr><th>时间</th><th>类型</th><th>玩家</th><th>事件</th><th>变化 / 卡牌</th><th>备注</th><th>关联</th></tr></thead><tbody>${timeline.map((e) => `<tr><td>${new Date(e.at).toLocaleTimeString("zh-CN")}</td><td>${e.kind}</td><td>${e.player}</td><td>${e.label}</td><td>${e.detail}</td><td>${e.note}</td><td>${e.linkedId ?? ""}</td></tr>`).join("")}</tbody></table><button onclick="print()">打印 / 另存 PDF</button>`); popup.document.close();
}

function exportScoreImage(match: BilliardsMatch) {
  const timeline = scoreMatchTimeline(match); const rankings = getRankings(match); const timelineStart = 205 + rankings.length * 38; const height = timelineStart + 70 + timeline.length * 40; const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  const rows = timeline.map((event, index) => `<text x="45" y="${timelineStart + 40 + index * 40}" class="row">${escape(new Date(event.at).toLocaleTimeString("zh-CN"))} · ${event.kind} · ${escape(event.player)} · ${escape(event.label)} · ${escape(event.detail)} ${escape(event.note)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><style>.title{font:700 38px system-ui;fill:#eff8f2}.meta{font:18px system-ui;fill:#91a89d}.score{font:700 34px system-ui;fill:#76e6ad}.row{font:18px system-ui;fill:#dce9e1}</style><rect width="100%" height="100%" fill="#09120f"/><text x="45" y="62" class="title">追分战绩</text><text x="45" y="100" class="meta">${escape(new Date(match.startedAt).toLocaleString("zh-CN"))} · ${escape(formatDuration(match.startedAt, match.endedAt))}</text>${rankings.map((p, i) => `<text x="45" y="${155 + i * 38}" class="score">${i + 1}. ${escape(p.name)} ${p.initialScore} → ${p.score} 分</text>`).join("")}<text x="45" y="${timelineStart}" class="meta">完整事件流水</text>${rows}</svg>`;
  downloadText(`追分战绩-${match.id}.svg`, svg, "image/svg+xml");
}

function UnifiedHistoryPage({ history, eightBallHistory, selectedId, onSelect }: { history: BilliardsMatch[]; eightBallHistory: EightBallMatch[]; selectedId?: string; onSelect: (id: string) => void }) {
  const selected = history.find((match) => match.id === selectedId);
  if (!selected) {
    const all = [...history.map((match) => ({ at: match.endedAt ?? match.startedAt, kind: "legacy" as const, match })), ...eightBallHistory.map((match) => ({ at: match.endedAt ?? match.startedAt, kind: "eight" as const, match }))].sort((a, b) => b.at - a.at);
    return <div className="content-page page-shell"><header className="page-title"><p className="kicker">MATCH HISTORY</p><h1>战绩</h1><p>中八与追分使用统一的战绩入口，可查看完整流水并导出。</p></header>{all.length ? <div className="history-grid">{all.map((item) => { if (item.kind === "eight") { const match = item.match; const stats = calculateEightBallStats(match); const winner = [...match.players].sort((a, b) => stats[b.id].score - stats[a.id].score)[0]; return <button key={match.id} onClick={() => onSelect(match.id)}><span className="history-type eight">中八双人赛</span><b>{match.players.map((player) => player.name).join(" · ")}</b><small>{formatTime(match.startedAt)} · {durationLabel(eightBallElapsedMs(match))}</small><div><span>获胜者</span><strong>{winner.name} · {match.players.map((p) => stats[p.id].score).join(" : ")}</strong><i>→</i></div></button>; } const match = item.match; const winner = getRankings(match)[0]; return <button key={match.id} onClick={() => onSelect(match.id)}><span className="history-type">{match.mode === "cards" ? "奇招牌" : match.mode === "score_cards" ? "追分 + 奇招牌" : "多人追分"}</span><b>{match.players.map((player) => player.name).join(" · ")}</b><small>{formatTime(match.startedAt)} · {formatDuration(match.startedAt, match.endedAt)}</small><div><span>第一名</span><strong>{winner?.name}{match.mode !== "cards" && ` · ${winner?.score} 分`}</strong><i>→</i></div></button>; })}</div> : <div className="large-empty"><span>⌁</span><h2>还没有战绩</h2><p>完成第一场比赛后，逐局流水会保存在这里。</p></div>}</div>;
  }
  const rankings = getRankings(selected);
  const timeline = [
    ...selected.scoreEvents.map((event) => ({ id: event.id, kind: "score" as const, at: event.occurredAt, label: `${selected.players.find((player) => player.id === event.playerId)?.name} · ${event.label}`, value: event.changes[event.playerId], note: event.note, linkedId: event.linkedCardEventId })),
    ...(selected.cards?.events ?? []).map((event) => ({ id: event.id, kind: "card" as const, at: event.occurredAt, label: event.label, value: undefined, note: undefined, linkedId: event.relatedScoreEventId })),
  ].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const jumpTo = (id: string) => document.getElementById(`timeline-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return <div className="content-page page-shell"><button className="back-link" onClick={() => onSelect("")}>← 返回战绩</button><header className="page-title split"><div><p className="kicker">MATCH DETAIL</p><h1>{selected.mode === "cards" ? "奇招卡牌局" : "追分结算"}</h1><p>{formatTime(selected.startedAt)} · {formatDuration(selected.startedAt, selected.endedAt)}</p></div><div className="export-actions"><button onClick={() => exportScoreImage(selected)}>战绩长图</button><button onClick={() => printScoreMatch(selected)}>打印 / PDF</button><button onClick={() => exportScoreJson(selected)}>JSON 备份</button></div></header><section className="result-podium">{rankings.map((player, index) => <div key={player.id}><span>{index + 1}</span><b>{player.name}</b><strong>{player.score}<small> 分</small></strong><small>较开局 {player.score - player.initialScore >= 0 ? "+" : ""}{player.score - player.initialScore}</small></div>)}</section><section className="event-stats"><div><strong>{selected.scoreEvents.length}</strong><span>计分事件</span></div><div><strong>{selected.cards?.events.length ?? 0}</strong><span>卡牌事件</span></div><div><strong>{timeline.filter((event) => event.linkedId).length / 2}</strong><span>牌分联动</span></div></section><section className="history-detail"><div className="section-heading"><div><p className="kicker">UNIFIED TIMELINE</p><h2>真实发生顺序</h2></div></div>{timeline.map((event) => <div className={`timeline-row unified ${event.kind}`} id={`timeline-${event.id}`} key={event.id}><span>{formatTime(event.at)}</span><div><b><i>{event.kind === "score" ? "积分" : "卡牌"}</i>{event.label}</b>{event.note && <small>{event.note}</small>}{event.linkedId && <button onClick={() => jumpTo(event.linkedId!)}>查看关联{event.kind === "score" ? "卡牌" : "积分"} ↕</button>}</div>{event.value !== undefined && <strong className={event.value < 0 ? "negative" : "positive"}>{event.value > 0 ? "+" : ""}{event.value}</strong>}</div>)}</section></div>;
}

function EightBallHistoryDetail({ match, onBack }: { match: EightBallMatch; onBack: () => void }) {
  const stats = calculateEightBallStats(match); const rounds = getEffectiveEightBallRounds(match);
  return <div className="content-page page-shell"><button className="back-link" onClick={onBack}>← 返回战绩</button><header className="page-title split"><div><p className="kicker">CHINESE EIGHT · MATCH REPORT</p><h1>{match.title || "中八双人赛"}</h1><p>{formatTime(match.startedAt)} · {durationLabel(eightBallElapsedMs(match))}{match.location ? ` · ${match.location}` : ""}</p></div><div className="export-actions"><button onClick={() => exportEightBallImage(match)}>战绩长图</button><button onClick={() => printEightBall(match)}>打印 / PDF</button><button onClick={() => exportEightBallJson(match)}>JSON 备份</button></div></header><section className="eight-result">{match.players.map((player) => <article key={player.id}><b>{player.name}</b><strong>{stats[player.id].score}</strong><small>普胜 {stats[player.id].normal} · 炸清 {stats[player.id].breakClear} · 接清 {stats[player.id].runout} · 犯规 {stats[player.id].fouls}</small></article>)}</section><section className="eight-ledger history"><div className="section-heading"><div><p className="kicker">FULL ROUND LOG</p><h2>逐局完整流水</h2></div><span>原始事件 {match.events.length} 条 · 版本 {match.matchVersion}</span></div>{rounds.map((round, index) => <article key={round.eventId}><span>第 {index + 1} 局</span><div><b>{match.players.find((p) => p.id === round.winnerId)?.name} · {EIGHT_BALL_WIN_LABELS[round.winType]}</b><small>开球：{match.players.find((p) => p.id === round.serverId)?.name} · 犯规 {match.players.map((p) => `${p.name} ${round.fouls[p.id] ?? 0}`).join(" / ")} · {durationLabel(round.confirmedAt - round.startedAt)}{round.note ? ` · ${round.note}` : ""}</small></div><strong>{match.players.map((p) => round.after[p.id] ?? 0).join(" : ")}</strong></article>)}</section><details className="raw-events"><summary>查看追加式原始事件与更正记录（{match.events.length}）</summary>{match.events.map((event) => <pre key={event.id}>{JSON.stringify(event, null, 2)}</pre>)}</details></div>;
}

function LocalMigrationPanel() {
  const [migration, setMigration] = useState<PreparedLocalMigration | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scan = async () => {
    setBusy(true); setMessage(""); setConfirmed(false); setBackupDownloaded(false);
    try { setMigration(await prepareLocalMigration(browserStore())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "本机数据扫描失败"); }
    finally { setBusy(false); }
  };
  const backup = () => {
    if (!migration) return;
    downloadMigrationBackup(migration); setBackupDownloaded(true);
    setMessage("完整 JSON 备份已下载，请妥善保存后再确认迁移");
  };
  const upload = async () => {
    if (!migration || !confirmed || !backupDownloaded) return;
    setBusy(true); setMessage("正在连接账号并迁移…");
    try {
      const store = browserStore();
      let deviceKey = store.getRaw(SYNC_DEVICE_KEY);
      if (!deviceKey) { deviceKey = crypto.randomUUID(); store.setRaw(SYNC_DEVICE_KEY, deviceKey); }
      const response = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey, name: navigator.platform || "浏览器设备" }) });
      const payload = await response.json() as { device?: { id: string }; error?: string };
      if (!response.ok || !payload.device) throw new Error(payload.error ?? "请先登录账号后再迁移");
      const result = await uploadLocalMigration(migration, { deviceId: payload.device.id });
      recordMigrationUpload(store, result);
      setMessage(`迁移完成：成功 ${result.summary.accepted}，已存在 ${result.summary.duplicate}，失败 ${result.summary.failed}，取消 ${result.summary.cancelled}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "迁移失败，可保留当前备份后重试"); }
    finally { setBusy(false); }
  };
  return <section className="migration-panel"><header><p className="kicker">R3 · LOCAL MIGRATION</p><h2>本机数据迁移</h2><p>扫描只读取本机存档；下载完整备份并明确确认前，不会注册设备、上传或修改原始数据。</p></header>{!migration ? <button className="primary" disabled={busy} onClick={scan}>{busy ? "正在扫描…" : "扫描本机数据"}</button> : <><div className="migration-counts"><span><b>{migration.preview.players}</b>玩家</span><span><b>{migration.preview.presets}</b>预设</span><span><b>{migration.preview.decks}</b>牌组</span><span><b>{migration.preview.matches}</b>对局</span><span><b>{migration.preview.eightBallRounds}</b>中八流水</span></div><small className="migration-checksum">备份校验和：{migration.backup.checksum}</small><div className="migration-actions"><button className="secondary" onClick={scan} disabled={busy}>重新扫描</button><button className="secondary" onClick={backup} disabled={busy}>下载完整 JSON 备份</button></div><label className="migration-confirm"><input type="checkbox" checked={confirmed} disabled={!backupDownloaded || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已保存备份，并确认把以上数据迁移到当前登录账号</span></label><button className="primary" disabled={!confirmed || !backupDownloaded || busy || migration.resources.length === 0} onClick={upload}>{busy ? "正在迁移…" : "确认并开始迁移"}</button></>}{message && <p className="migration-message" role="status">{message}</p>}</section>;
}

function ProfilePage({ history }: { history: BilliardsMatch[] }) {
  return <div className="content-page page-shell"><header className="profile-hero"><span className="profile-avatar">游</span><div><p className="kicker">LOCAL GUEST · V{APP_VERSION}</p><h1>游客模式</h1><p>R2 本地核心功能版，核心能力无需注册，本机数据会持续保存。</p></div><button className="secondary" disabled>登录 / 注册 · 即将开放</button></header><section className="local-stats"><div><strong>{history.length}</strong><span>已完成对局</span></div><div><strong>{history.reduce((sum, match) => sum + match.scoreEvents.length, 0)}</strong><span>计分流水</span></div><div><strong>{history.reduce((sum, match) => sum + (match.cards?.events.length ?? 0), 0)}</strong><span>卡牌事件</span></div></section><section className="settings-list"><header><p className="kicker">LOCAL DATA</p><h2>本机资料</h2></header><div><span>4</span><p><b>R2 应用版本</b><small>当前预览版本 v{APP_VERSION}</small></p><strong className="state-good">预览中</strong></div><div><span>◎</span><p><b>本地自动保存</b><small>刷新页面仍可恢复未结束对局</small></p><strong className="state-good">已开启</strong></div><div><span>⇅</span><p><b>云端同步</b><small>账户与跨设备同步将在认证阶段开放</small></p><strong>未连接</strong></div><div><span>○</span><p><b>常用球友</b><small>登录后保存注册玩家与临时球友</small></p><strong>即将开放</strong></div></section><LocalMigrationPanel /></div>;
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
  const [eightSetupOpen, setEightSetupOpen] = useState(false);
  const [eightDefaultLayout, setEightDefaultLayout] = useState<EightBallLayout>("stacked");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingMode, setPendingMode] = useState<MatchMode | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadAppData(browserStore());
      setData(loaded.value);
      setStorageIssue(loaded.issue ?? null);
      setPath(window.location.pathname || "/");
      setEightDefaultLayout(browserStore().getRaw(EIGHT_BALL_LAYOUT_KEY) === "split" ? "split" : "stacked");
      setReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (ready && !storageIssue) browserStore().write(APP_DATA_CODEC, data);
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

  const start = (draft: MatchDraft, scorePresets: ScorePreset[]) => {
    if (data.activeMatch) return;
    const match = createMatch(draft);
    setData({ ...data, activeMatch: match, savedRules: draft.rules, scorePresets });
    setSetupMode(null);
    navigate("/");
    setStatus("新对局已开始并保存到本机");
  };

  const updateActive = (match: BilliardsMatch) => setData((current) => ({ ...current, activeMatch: match }));
  const updateEight = (match: EightBallMatch) => {
    browserStore().setRaw(EIGHT_BALL_LAYOUT_KEY, match.layout);
    setEightDefaultLayout(match.layout);
    setData((current) => ({ ...current, activeEightBallMatch: match }));
  };
  const complete = () => {
    if (!data.activeMatch) return;
    const completed = finishMatch(data.activeMatch);
    setData({ ...data, activeMatch: null, history: [completed, ...data.history] });
    setConfirmEnd(false);
    navigate(`/history/${completed.id}`);
    setStatus("对局已结束，完整战绩已保存");
  };

  const completeEight = () => {
    if (!data.activeEightBallMatch) return;
    const completed = finishEightBallMatch(data.activeEightBallMatch);
    setData({ ...data, activeEightBallMatch: null, eightBallHistory: [completed, ...data.eightBallHistory] });
    setConfirmEnd(false);
    navigate(`/history/${completed.id}`);
    setStatus("中八比赛已结束，完整逐局战绩已保存");
  };

  const startEight = (draft: EightBallDraft) => {
    if (data.activeMatch || data.activeEightBallMatch) return;
    const match = createEightBallMatch(draft);
    browserStore().setRaw(EIGHT_BALL_LAYOUT_KEY, match.layout);
    setData({ ...data, activeEightBallMatch: match });
    setEightSetupOpen(false);
    navigate("/");
    setStatus("中八比赛已开始并保存到本机");
  };

  const openEightSetup = () => {
    if (data.activeMatch || data.activeEightBallMatch) { setStatus("请先结束或保存当前对局，再创建中八比赛"); navigate("/"); return; }
    setEightSetupOpen(true);
  };

  const openSetup = (mode: MatchMode) => {
    if (data.activeEightBallMatch) { setStatus("请先结束当前中八比赛，再创建其他对局"); navigate("/"); return; }
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
    const loaded = loadAppData(browserStore());
    setData(loaded.value);
    setStorageIssue(loaded.issue ?? null);
    if (!loaded.issue) setStatus("本机数据已恢复");
  };
  const resetStorage = () => {
    if (!storageIssue) return;
    const store = browserStore();
    store.setRaw(`${APP_STORAGE_KEY}:corrupt-backup:${Date.now()}`, storageIssue.raw);
    store.remove(APP_STORAGE_KEY);
    setData(EMPTY_DATA);
    setStorageIssue(null);
    setStatus("原始数据已备份，本机数据已安全重置");
  };

  const page = (() => {
    if (path === "/") return data.activeEightBallMatch
      ? <EightBallBoard match={data.activeEightBallMatch} onChange={updateEight} onFinish={() => setConfirmEnd(true)} toast={setStatus} />
      : data.activeMatch
        ? <ActiveMatchView match={data.activeMatch} onChange={updateActive} onFinish={() => setConfirmEnd(true)} toast={setStatus} />
        : <EmptyHome onStart={openSetup} onStartEight={openEightSetup} onNavigate={navigate} onResume={resumePaused} recent={data.history[0]} paused={data.pausedMatches} />;
    if (path === "/play") return <PlayPage onStart={openSetup} onStartEight={openEightSetup} />;
    if (path === "/decks") return <DecksPage />;
    if (path.startsWith("/history")) {
      const selectedId = path.split("/")[2];
      const selectedMatch = data.history.find((match) => match.id === selectedId);
      const selectedEight = data.eightBallHistory.find((match) => match.id === selectedId);
      if (selectedEight) return <EightBallHistoryDetail match={selectedEight} onBack={() => navigate("/history")} />;
      return <><UnifiedHistoryPage history={data.history} eightBallHistory={data.eightBallHistory} selectedId={selectedId} onSelect={(id) => navigate(id ? `/history/${id}` : "/history")} />{selectedMatch && selectedMatch.scoreEvents.length > 0 && <HistoryCorrectionDock match={selectedMatch} onChange={(updated) => setData({ ...data, history: data.history.map((match) => match.id === updated.id ? updated : match) })} />}</>;
    }
    if (path === "/profile") return <ProfilePage history={data.history} />;
    return <div className="large-empty page-shell"><span>404</span><h2>页面不存在</h2><button className="primary" onClick={() => navigate("/")}>返回对局</button></div>;
  })();

  if (!ready) return <main className="loading-screen"><span>8</span><p>正在恢复本机对局…</p></main>;

  return (
    <main className="app-root">
      <AppHeader path={path} active={!!data.activeMatch || !!data.activeEightBallMatch} onNavigate={navigate} />
      {page}
      {setupMode && <SetupDialog initialMode={setupMode} savedRules={data.savedRules} scorePresets={data.scorePresets} onClose={() => setSetupMode(null)} onStart={start} />}
      {eightSetupOpen && <EightBallSetupDialog defaultLayout={eightDefaultLayout} onClose={() => setEightSetupOpen(false)} onStart={startEight} />}
      {confirmEnd && <ConfirmDialog title="结束本场对局？" body="系统会保存最终结果、完整流水和更正记录。结束后仍可导出战绩。" onCancel={() => setConfirmEnd(false)} onConfirm={data.activeEightBallMatch ? completeEight : complete} />}
      {pendingMode && data.activeMatch && <ActiveMatchProtectionDialog match={data.activeMatch} discardArmed={discardArmed} onContinue={continueActive} onSave={saveActiveAndCreate} onArmDiscard={() => setDiscardArmed(true)} onDiscard={abandonActiveAndCreate} />}
      {storageIssue && <StorageRecoveryDialog issue={storageIssue} onRetry={retryStorage} onReset={resetStorage} />}
      {status && <div className="status-toast" role="status"><span>✓</span>{status}</div>}
    </main>
  );
}
