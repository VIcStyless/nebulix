# Nebulix Game API (for Hub creators)

Every game or app you upload to Nebulix Hub runs isolated from the player's account. Nebulix injects a small
`window.Nebulix` object into its pages so it can talk to the platform. Every call returns a Promise (or `null` if the
game is opened outside Nebulix, so always check).

```js
// who is playing (never their email or account data)
const me = await Nebulix.me();             // { username, displayName, lang }

// leaderboards: each player's best score is kept, top 200 shown on the game page
await Nebulix.submitScore(1234, 'level 3'); // → { best, rank, pb }
const { board, mine } = await Nebulix.leaderboard();

// achievements: defined the first time they are unlocked (max 50 per game)
await Nebulix.unlock('first-win', 'First win', 'Win one match');  // → { unlocked: true|false }
const { list, unlocked, total } = await Nebulix.achievements();

// multiplayer rooms (up to 16 players per room, JSON messages up to 8 KB, ~30 per second)
Nebulix.room.on('joined', ({ room, me, players }) => {});
Nebulix.room.on('join', ({ user, count }) => {});
Nebulix.room.on('leave', ({ user, count }) => {});
Nebulix.room.on('message', ({ from, data }) => {});
Nebulix.room.on('error', ({ error }) => {});
await Nebulix.room.join('lobby');           // → { room, me, players } or { error }
Nebulix.room.send({ x: 10, y: 4 });         // to everyone else in the room
Nebulix.room.send({ hello: 1 }, playerId);  // to one player
Nebulix.room.leave();
```

Scores and achievements come from the game running in the player's browser, so Nebulix cannot verify them: they
never pay coins, and the game's author and the moderators can reset them.

## Device permissions (nebulix.json)

To use the camera, microphone, location or MIDI devices, add a `nebulix.json` file at the root of your upload:

```json
{ "name": "My game", "permissions": ["camera", "microphone"] }
```

Players see what the game asks for before installing or playing, and the game only gets the permissions they allow
(the browser also asks them again for camera and microphone). Allowed values: `camera`, `microphone`, `geolocation`, `midi`.
