// Wires the framework-independent room manager to persistence. Imported by API routes only.
import { getRoomManager, type RoomManager } from "./rooms";
import { persistMatch } from "./persist";

const g = globalThis as unknown as { __fmHooked?: boolean };

export function rooms(): RoomManager {
  const m = getRoomManager();
  if (!g.__fmHooked) {
    g.__fmHooked = true;
    m.hooks.onFinish = async (room, result) => {
      await persistMatch({
        roomCode: room.code,
        mode: room.settings.mode,
        stadium: room.settings.stadium,
        teamNames: [room.kits[0].name, room.kits[1].name],
        result,
      });
    };
  }
  return m;
}
