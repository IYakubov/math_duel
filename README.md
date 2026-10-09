# Math Duel — v2.2 (Shared Couch restyle, English UI)

Two players race to solve arithmetic on a big screen, using their phones as controllers.
v2 uses the Tank War design: Unbounded font, a grayscale soil/ink palette, a lobby that
shows only the QR code, menus driven from the phones, and one phone per slot.

## Run

```
npm install
npm start
```

Open `http://localhost:3000` on the TV/PC and choose **Create game**. The server prints
the LAN address, and the QR code always points at that address (never `localhost`), so
phones on the same Wi-Fi can scan it directly.

## Flow

1. **Lobby** shows only the controller QR code, the room number (small) and the A/B slots.
2. Phones scan the code, auto-join and tap **Ready**.
3. When both are ready, the phones switch to the joystick and the screen shows **Choose a level**.
   The arrows move the highlight and the round button selects. Either phone can drive it.
4. A 3-2-1 countdown, then 10 questions of 8 s each. The D-pad picks a tile.
   Picks stay hidden until time runs out, then both are revealed with their times.
   The fastest correct answer scores.
5. **End screen:** Play again / Change level / Back to lobby, driven from the phones.
   "Back to lobby" keeps the phones connected and resets ready state and score.

Menus ignore input for 0.9 s after opening, so a held button doesn't skip through them.

## Files

- `server.js`: rooms, slots, LAN QR code, input relay.
- `public/host.html`: the big screen. Sounds are embedded as base64. The background track (`math.mp3`, 2:17) loops from the countdown until the end screen.
- `public/controller.html`: the phone (join, lobby, joystick, mirrored menu).
- `public/index.html`: landing page.
- `public/fonts/`: Unbounded variable font (SIL OFL, `OFL.txt`).

## Socket protocol

| Event | Direction | Payload |
|---|---|---|
| create_game → game_created | host↔server | → `{code, joinUrl, qrSvg}` |
| join_game → joined / join_error | phone↔server | `{code, clientId}` → `{slot, code, started, ready}` |
| rejoin_game | phone→server | `{code, slot, clientId}` |
| replaced | server→old phone tab | |
| player_ready | phone→server | |
| game_event `lobby_ready_update` | server→all | `{A, B, readyA, readyB}` |
| game_start | server→all | sent when both phones are ready |
| ctrl_input | phone→host | `{slot, dir, pressed}`: answers or moves the menu |
| ctrl_fire | phone→host | `{slot}`: selects in menus |
| host_ui | host→server→phones | `{phase, menu, items, focus, status:{A,B}, caption}` |
| host_back_to_lobby → back_to_lobby | host→server→phones | |
| player_joined, player_left, host_disconnected | server→clients | |

The slot is taken from the server-side socket, never from the payload. Each phone keeps
a `clientId` in localStorage (`mathduel_client`), so re-opening the link keeps its slot,
and the older tab gets `replaced`.
"# math_duel" 
