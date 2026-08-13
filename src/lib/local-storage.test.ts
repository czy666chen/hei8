import { describe, expect, it } from "vitest";
import {
  APP_DATA_CODEC,
  APP_STORAGE_KEY,
  EMPTY_APP_DATA,
  MemoryStorageAdapter,
  VersionedLocalStore,
} from "./local-storage";

describe("versioned local storage", () => {
  it("reads and writes the existing v1 app archive without changing its schema", () => {
    const existing = { ...EMPTY_APP_DATA, scorePresets: [{ id: "friday", name: "周五", rules: [] }] };
    const adapter = new MemoryStorageAdapter({ [APP_STORAGE_KEY]: JSON.stringify(existing) });
    const store = new VersionedLocalStore(adapter);

    expect(store.read(APP_DATA_CODEC)).toEqual({ value: existing });

    store.write(APP_DATA_CODEC, { ...existing, activeMatch: null });
    expect(JSON.parse(adapter.get(APP_STORAGE_KEY) ?? "")).toEqual(existing);
  });

  it("reports corrupt data without overwriting the original archive", () => {
    const adapter = new MemoryStorageAdapter({ [APP_STORAGE_KEY]: "{broken" });
    const store = new VersionedLocalStore(adapter);

    expect(store.read(APP_DATA_CODEC)).toEqual({
      value: EMPTY_APP_DATA,
      issue: { message: "数据格式或版本无法识别", raw: "{broken" },
    });
    expect(adapter.get(APP_STORAGE_KEY)).toBe("{broken");
  });
});
