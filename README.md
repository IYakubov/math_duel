# Math Duel — v3.0 (Shared Couch restyle, English UI)

A survival math game for 1 or 2 players on a big screen, using their phones as controllers.
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
2. Phones scan the code and auto-join.
   - **2 players:** both tap **Ready**.
   - **1 player:** a phone that is alone in the room also sees **Play solo**.
3. The phones switch to the joystick and the screen shows **Choose a level**.
   The arrows move the highlight and the round button selects.
4. **Survival.** After a 3-2-1 countdown the questions keep coming. Each player has
   **3 lives**, and a wrong answer or no answer costs one. The timer starts at 8 s and
   loses 0.25 s per question, down to 3 s. When everyone has answered, the answer is
   revealed straight away.
   - A pick shows at once as a ring in the player's colour (A black, B navy) with an A/B tag.
     If both pick the same tile, the second player's ring goes around the first one's.
   - The correct tile then fills bright green with a shine.
5. **Game over:**
   - **2 players:** the last one standing wins. If both lose their last life on the same
     question, the one with more correct answers wins, and equal counts are a draw.
   - **1 player:** the score is the number of correct answers. The best score per level is
     saved in the big screen's browser.
   - End menu: Play again / Change level / Back to lobby, driven from the phones.

Menus ignore input for 0.9 s after opening, so a held button doesn't skip through them.

## Menu button

Every phone has a **Menu** button (top-right of the joystick). The big screen also has one
(bottom-right corner, clickable), and **Esc** works too. It pauses the game (the timer
and music stop) and shows **Resume / Back to lobby / Game catalog**, driven from the phones.
- **Back to lobby** keeps the phones connected and returns them to the Ready screen.
- **Game catalog** sends the big screen to the Shared Couch catalog (`/#games` behind the
  front door, or `https://sharedcouch.online/#games` when the game runs on its own).
  Phones are told the host left and to scan the next game's QR code.

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
| player_solo | phone→server | only when that phone is alone in the room |
| game_event `lobby_ready_update` | server→all | `{A, B, readyA, readyB}` |
| game_start | server→all | `{players:['A','B']}` or `{players:['A']}` for solo |
| ctrl_input | phone→host | `{slot, dir, pressed}`: answers or moves the menu |
| ctrl_fire | phone→host | `{slot}`: selects in menus |
| host_ui | host→server→phones | `{phase, menu, items, focus, status:{A,B}, caption}` |
| host_back_to_lobby → back_to_lobby | host→server→phones | |
| ctrl_menu | phone→host | `{slot}`: toggles the pause menu |
| host_exit | host→server→phones | host left for the game catalog |
| player_joined, player_left, host_disconnected | server→clients | |

The slot is taken from the server-side socket, never from the payload. Each phone keeps
a `clientId` in localStorage (`mathduel_client`), so re-opening the link keeps its slot,
and the older tab gets `replaced`.
"# math_duel" 
