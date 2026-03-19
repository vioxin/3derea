const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/ping', (req, res) => res.send('Awake!'));

const rooms = {};

io.on('connection', (socket) => {
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: null, p1Hp: 3, p2Hp: 3, p1Card: null, p2Card: null, p1Judge: null, p2Judge: null, isCpu: false };
    socket.emit('roomCreated', roomId);
  });

  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].p2) {
      socket.join(roomId);
      rooms[roomId].p2 = socket.id;
      io.to(roomId).emit('gameStart', '審判の時が来た。真実か嘘かを見破れ。');
    } else {
      socket.emit('errorMsg', '部屋がないか、満室です');
    }
  });

  socket.on('playCPU', () => {
    const roomId = 'CPU_' + socket.id;
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: 'CPU', p1Hp: 3, p2Hp: 3, p1Card: null, p2Card: null, p1Judge: null, p2Judge: null, isCpu: true };
    socket.emit('gameStart', 'CPUとの審判が始まった...。');
  });

  // ① カードを伏せるフェーズ
  socket.on('faceDownCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id === room.p1) room.p1Card = parseInt(card); // 0=Bluff, 1=Attack
    if (socket.id === room.p2) room.p2Card = parseInt(card);

    if (room.isCpu && socket.id === room.p1) {
      room.p2Card = Math.floor(Math.random() * 2); // CPUはランダムに伏せる
    }

    // 両者が伏せたら、判定フェーズへ移行
    if (room.p1Card !== null && room.p2Card !== null) {
      io.to(roomId).emit('judgementPhase');
    }
  });

  // ② 判定（真実か嘘か）を送るフェーズ
  socket.on('submitJudgement', ({ roomId, judgement }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id === room.p1) room.p1Judge = parseInt(judgement); // 1=Truth, 0=Lie
    if (socket.id === room.p2) room.p2Judge = parseInt(judgement);

    if (room.isCpu && socket.id === room.p1) {
      room.p2Judge = Math.floor(Math.random() * 2); // CPUはランダムに判定
    }

    // 両者が判定を送ったら、解決フェーズへ移行
    if (room.p1Judge !== null && room.p2Judge !== null) {
      resolveTurn(roomId);
    }
  });

  function resolveTurn(roomId) {
    const room = rooms[roomId];
    const c1 = room.p1Card; const c2 = room.p2Card;
    const j1 = room.p1Judge; const j2 = room.p2Judge;
    let p1Dmg = 0; let p2Dmg = 0;
    let m = "";

    // 勝敗判定ロジック（マトリックス）
    
    // P1の判定結果 (相手のカードc2をどう読んだかj1)
    if (j1 === 1) { // P1「相手c2は『真実』だ！」
      if (c2 === 1) { p2Dmg += 1; m += "⚔️P1カウンター成功！ "; } // 当たり
      else { p1Dmg += 1; m += "💀P1はブラフに釣られた！ "; } // ハズレ
    } else { // P1「相手c2は『嘘』だ！」
      if (c2 === 0) { p2Dmg += 1; m += "🧠P1は嘘を見破った！ "; } // 当たり
      else { p1Dmg += 1; m += "🗡️P1は正直な攻撃を受けた！ "; } // ハズレ
    }

    // P2の判定結果 (相手のカードc1をどう読んだかj2)
    if (j2 === 1) { // P2「相手c1は『真実』だ！」
      if (c1 === 1) { p1Dmg += 1; m += "⚔️P2カウンター成功！ "; } // 当たり
      else { p2Dmg += 1; m += "💀P2はブラフに釣られた！ "; } // ハズレ
    } else { // P2「相手c1は『嘘』だ！」
      if (c1 === 0) { p1Dmg += 1; m += "🧠P2は嘘を見破った！ "; } // 当たり
      else { p2Dmg += 1; m += "🗡️P2は正直な攻撃を受けた！ "; } // ハズレ
    }

    room.p1Hp -= p1Dmg;
    room.p2Hp -= p2Dmg;

    // HP表示をハートのアイコンで送信
    const p1HpHeart = "❤️".repeat(Math.max(0, room.p1Hp)) + "🖤".repeat(Math.max(0, 3 - room.p1Hp));
    const p2HpHeart = "❤️".repeat(Math.max(0, room.p2Hp)) + "🖤".repeat(Math.max(0, 3 - room.p2Hp));

    // 結果を送信（カード名は送らず、画像で表示するためIDのみ送る）
    io.to(roomId).emit('turnResult', {
      p1Card: c1, p2Card: c2,
      p1Judge: j1, p2Judge: j2,
      p1Hp: p1HpHeart, p2Hp: p2HpHeart, message: m
    });

    if (room.p1Hp <= 0 || room.p2Hp <= 0) {
      let winner = room.p1Hp > 0 ? 'P1' : (room.p2Hp > 0 ? 'P2' : 'Draw');
      io.to(roomId).emit('gameOver', winner);
      delete rooms[roomId];
    } else {
      // リセットして次のターンへ
      room.p1Card = null; room.p2Card = null;
      room.p1Judge = null; room.p2Judge = null;
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`JUDGEMENT起動: ${PORT}`));
