import type { ChangeType } from "../config/schema";
import type { StreamerState } from "./state";

export interface DetectedChange {
  type: ChangeType;
  streamer: string;
  oldValue?: string;
  newValue?: string;
  currentState: StreamerState;
}

export function detectChanges(
  oldState: StreamerState | undefined,
  newState: StreamerState
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (!oldState) {
    return [];
  }

  if (!oldState.isLive && newState.isLive) {
    changes.push({
      type: "online",
      streamer: newState.username,
      currentState: newState,
    });
  }

  if (oldState.isLive && !newState.isLive) {
    changes.push({
      type: "offline",
      streamer: newState.username,
      currentState: newState,
    });
  }

  if (oldState.title !== newState.title && newState.title) {
    changes.push({
      type: "titleChange",
      streamer: newState.username,
      oldValue: oldState.title,
      newValue: newState.title,
      currentState: newState,
    });
  }

  if (oldState.gameId !== newState.gameId) {
    changes.push({
      type: "gameChange",
      streamer: newState.username,
      oldValue: oldState.gameName,
      newValue: newState.gameName,
      currentState: newState,
    });
  }

  return changes;
}
