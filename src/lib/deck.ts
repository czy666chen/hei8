import { CARD_DEFINITIONS } from "../data/cards";

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  title: string;
  effect: string;
}

export interface GameState {
  remaining: CardInstance[];
  hand: CardInstance[];
  used: CardInstance[];
}

export const createDeck = (): CardInstance[] =>
  CARD_DEFINITIONS.flatMap((item) =>
    Array.from({ length: item.count }, (_, index) => ({
      instanceId: `${item.id}-${index + 1}`,
      definitionId: item.id,
      title: item.title,
      effect: item.effect,
    })),
  );

export const resetGame = (): GameState => ({ remaining: createDeck(), hand: [], used: [] });

export function secureRandomIndex(max: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new Error("随机范围必须为正整数");
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.getRandomValues) return Math.floor(Math.random() * max);
  const limit = Math.floor(0x100000000 / max) * max;
  const values = new Uint32Array(1);
  do cryptoObject.getRandomValues(values); while (values[0] >= limit);
  return values[0] % max;
}

export function drawCards(state: GameState, count: number, randomIndex = secureRandomIndex): GameState {
  if (!Number.isInteger(count) || count < 1 || count > state.remaining.length) {
    throw new Error("抽卡数量超出剩余卡牌范围");
  }
  const remaining = [...state.remaining];
  const drawn: CardInstance[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = randomIndex(remaining.length);
    drawn.push(remaining[index]);
    remaining[index] = remaining[remaining.length - 1];
    remaining.pop();
  }
  return { remaining, hand: [...drawn, ...state.hand], used: state.used };
}

export function useCard(state: GameState, instanceId: string): GameState {
  const target = state.hand.find((item) => item.instanceId === instanceId);
  if (!target) return state;
  return {
    remaining: state.remaining,
    hand: state.hand.filter((item) => item.instanceId !== instanceId),
    used: [target, ...state.used],
  };
}
