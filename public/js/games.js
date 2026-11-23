// Curated catalogue of web games for the Games portal (views/play.js). They open through the proxy,
// so they work on locked-down networks. Real logos load via siteLogo() (/api/favicon); compatibility varies.
// Each entry: [name, url]. Categories are shown in this order. Keep names short — they sit under a 38px logo.

export const GAME_CATS = [
  ['io', 'io Games', 'target', [
    ['Krunker', 'https://krunker.io/'], ['Shell Shockers', 'https://shellshock.io/'], ['Slither.io', 'https://slither.io/'],
    ['Paper.io', 'https://paper-io.com/'], ['Agar.io', 'https://agar.io/'], ['Diep.io', 'https://diep.io/'],
    ['Zombs Royale', 'https://zombsroyale.io/'], ['Taming.io', 'https://taming.io/'], ['Smash Karts', 'https://smashkarts.io/'],
    ['1v1.LOL', 'https://1v1.lol/'], ['Skribbl', 'https://skribbl.io/'], ['Gartic.io', 'https://gartic.io/'],
  ]],
  ['puzzle', 'Puzzle & Brain', 'puzzle', [
    ['2048', 'https://play2048.co/'], ['Sudoku', 'https://sudoku.com/'], ['Wordle', 'https://www.nytimes.com/games/wordle/index.html'],
    ['Tetris', 'https://tetr.io/'], ['Hextris', 'https://hextris.io/'], ['Little Alchemy 2', 'https://littlealchemy2.com/'],
    ['Flow Free', 'https://www.coolmathgames.com/0-flow-free'], ['Mahjong', 'https://www.mahjong.com/'],
  ]],
  ['board', 'Classic & Board', 'crown', [
    ['Lichess', 'https://lichess.org/'], ['Chess.com', 'https://www.chess.com/play'], ['Checkers', 'https://www.coolmathgames.com/0-checkers'],
    ['Solitaire', 'https://www.solitr.com/'], ['Backgammon', 'https://www.cardgames.io/backgammon/'], ['Uno', 'https://www.cardgames.io/unoonline/'],
  ]],
  ['retro', 'Arcade & Retro', 'bolt', [
    ['Snake', 'https://playsnake.org/'], ['Pac-Man', 'https://www.google.com/logos/2010/pacman10-i.html'],
    ['Flappy Bird', 'https://flappybird.io/'], ['Pong', 'https://www.ponggame.org/'], ['Space Invaders', 'https://www.freeinvaders.org/'],
    ['Pinball', 'https://www.coolmathgames.com/0-pinball'],
  ]],
  ['action', 'Racing & Sports', 'zap', [
    ['Moto X3M', 'https://www.coolmathgames.com/0-moto-x3m'], ['Madalin Stunt', 'https://madalingames.com/madalin-stunt-cars-2'],
    ['Basketball Stars', 'https://www.coolmathgames.com/0-basketball-stars'], ['Retro Bowl', 'https://retrobowl.me/'],
    ['8 Ball Pool', 'https://www.coolmathgames.com/0-8-ball-pool'], ['Subway Surfers', 'https://poki.com/en/g/subway-surfers'],
  ]],
  ['geo', 'Geo & Trivia', 'globe', [
    ['GeoGuessr', 'https://www.geoguessr.com/'], ['Globle', 'https://globle-game.com/'], ['Worldle', 'https://worldle.teuteuf.fr/'],
    ['Sporcle', 'https://www.sporcle.com/'], ['Quizlet', 'https://quizlet.com/'],
  ]],
  ['portals', 'More games', 'grid', [
    ['Poki', 'https://poki.com/'], ['CrazyGames', 'https://www.crazygames.com/'], ['Coolmath Games', 'https://www.coolmathgames.com/'],
    ['itch.io', 'https://itch.io/games/html5'], ['Y8', 'https://www.y8.com/'], ['Miniclip', 'https://www.miniclip.com/games/en/'],
    ['Addicting Games', 'https://www.addictinggames.com/'], ['Armor Games', 'https://armorgames.com/'],
    ['Kongregate', 'https://www.kongregate.com/'], ['GameJolt', 'https://gamejolt.com/games'],
  ]],
];

// Flat lookup: url -> { name, cat } for the search / favorites / recent rows.
export const GAME_BY_URL = new Map();
for (const [, , , list] of GAME_CATS) for (const [name, url] of list) GAME_BY_URL.set(url, { name });
