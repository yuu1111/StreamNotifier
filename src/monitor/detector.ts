import { type ChangeType, ChangeTypes } from "../config/schema";
import type { StreamerState } from "./state";

/**
 * @description 検出された変更イベント
 * @property type - 変更の種類
 * @property streamer - 配信者のユーザー名
 * @property oldValue - 変更前の値 @optional
 * @property newValue - 変更後の値 @optional
 * @property oldTitle - 変更前のタイトル @optional
 * @property newTitle - 変更後のタイトル @optional
 * @property oldGame - 変更前のゲーム @optional
 * @property newGame - 変更後のゲーム @optional
 * @property streamStartedAt - 配信開始日時 @optional
 * @property vodUrl - VOD URL @optional
 * @property vodThumbnailUrl - VODサムネイルURL @optional
 * @property currentState - 現在の配信者状態
 */
export interface DetectedChange {
  type: ChangeType;
  streamer: string;
  oldValue?: string | undefined;
  newValue?: string | undefined;
  oldTitle?: string | undefined;
  newTitle?: string | undefined;
  oldGame?: string | undefined;
  newGame?: string | undefined;
  streamStartedAt?: string | undefined;
  vodUrl?: string | undefined;
  vodThumbnailUrl?: string | undefined;
  currentState: StreamerState;
}

/**
 * @description 新旧状態を比較して変更を検出
 * @param oldState - 前回の状態(初回はundefined)
 * @param newState - 現在の状態
 * @returns 検出された変更の配列
 */
export function detectChanges(
  oldState: StreamerState | undefined,
  newState: StreamerState
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // 初回は変更なしとして扱う(Pollerで初回ライブ検出を行う)
  if (!oldState) {
    return [];
  }

  if (!oldState.isLive && newState.isLive) {
    changes.push({
      type: ChangeTypes.Online,
      streamer: newState.username,
      currentState: newState,
    });
  }

  if (oldState.isLive && !newState.isLive) {
    changes.push({
      type: ChangeTypes.Offline,
      streamer: newState.username,
      streamStartedAt: oldState.startedAt ?? undefined,
      currentState: newState,
    });
  }

  if (oldState.title !== newState.title && newState.title) {
    changes.push({
      type: ChangeTypes.TitleChange,
      streamer: newState.username,
      oldValue: oldState.title,
      newValue: newState.title,
      currentState: newState,
    });
  }

  if (oldState.gameId !== newState.gameId) {
    changes.push({
      type: ChangeTypes.GameChange,
      streamer: newState.username,
      oldValue: oldState.gameName,
      newValue: newState.gameName,
      currentState: newState,
    });
  }

  return changes;
}
