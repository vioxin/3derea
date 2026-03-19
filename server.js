const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/ping', (req, res) => res.send('Awake!'));

const rooms = {};

// カードの名前
const cardNames = { 1: "⚔️斬撃", 2: "🛡️防御", 3: "🔨崩し", 4: "🦇呪い", 0: "🪞反射" };

// 全組み合わせの勝敗ロジック [P1ダメージ, P2ダメージ, P1回復, P2回復, メッセージ]
const matrix = {
  '1-1': [0, 0, 0, 0, "⚔️ 斬撃同士が激突！相殺！"],
  '1-2': [1, 0, 0, 0, "🛡️ 防御成功！攻撃側にカウンター1ダメージ！"],
  '1-3': [0, 3, 0, 0, "⚔️ 斬撃が崩しに打ち勝った！3ダメージ！"],
  '1-4': [1, 3, 0, 1, "⚔️ 斬撃ヒット！しかし呪いも発動！"],
  '1-0': [3, 0, 0, 0, "🪞 反射成功！斬撃が跳ね返った！"],

  '2-1': [0, 1, 0, 0, "🛡️ 防御成功！攻撃側にカウンター1ダメージ！"],
  '2-2': [0, 0, 0, 0, "🛡️ お互いに様子見..."],
  '2-3': [3, 0, 0, 0, "🔨 シールドブレイク！！3ダメージ！"],
  '2-4': [1, 0, 0, 1, "🛡️ 防御貫通！呪いがじわじわ効く..."],
  '2-0': [0, 2, 0, 0, "🪞 反射空振り！隙を突かれて2ダメージ！"],

  '3-1': [3, 0, 0, 0, "⚔️ 斬撃が崩しに打ち勝った！3ダメージ！"],
  '3-2': [0, 3, 0, 0, "🔨 シールドブレイク！！3ダメージ！"],
  '3-3': [0, 0, 0, 0, "🔨 崩し同士が激突！相殺！"],
  '3-4': [1, 3, 0, 1, "🔨 崩しヒット！しかし呪いも発動！"],
  '3-0': [3, 0, 0, 0, "🪞 反射成功！崩しが跳ね返った！"],

  '4-1': [3, 1, 1, 0, "⚔️ 斬撃ヒット！しかし呪いも発動！"],
  '4-2': [0, 1, 1, 0, "🛡️ 防御貫通！呪いがじわじわ効く..."],
  '4-3': [3, 1, 1, 0, "🔨 崩しヒット！しかし呪いも発動！"],
  '4-4': [1, 1, 1, 1, "🦇 お互いに呪いを掛け合う..."],
  '4-0': [0, 3, 1, 0, "🦇 反射空振り！呪い＋隙で計3ダメージ！"],

  '0-1': [0, 3, 0, 0, "🪞 反射成功！斬撃が跳ね返った！"],
  '0-2': [2, 0, 0, 0, "🪞 反射空振り！隙を突かれて2ダメージ！"],
  '0-3': [0, 3, 0, 0, "🪞 反射成功！崩しが跳ね返った！"],
  '0-4': [3, 0, 0, 1, "🦇 反射空振り！呪い＋隙で計3ダメージ！"],
  '0-0': [0, 0, 0, 0, "🪞 お互いに隙を窺っている..."]
};

io.on('connection', (socket) => {
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: null, p1Hp: 10, p2Hp: 10, p1Card: null, p2Card: null, isCpu: false };
    socket.emit('roomCreated', roomId);
  });

  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].p2) {
      socket.join(roomId);
      rooms[roomId].p2 = socket.id;
      io.to(roomId).emit('gameStart', '対人戦が始まりました！');
    } else {
      socket.emit('errorMsg', '部屋がないか、満室です');
    }
  });

  socket.on('playCPU', () => {
    const roomId = 'CPU_' + socket.id;
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: 'CPU', p1Hp: 10, p2Hp: 10, p1Card: null, p2Card: null, isCpu: true };
    socket.emit('gameStart', 'CPU戦が始まりました！');
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (socket.id === room.p1) room.p1Card = card;
    if (socket.id === room.p2) room.p2Card = card;

    if (room.isCpu && socket.id === room.p1) {
      const cpuCards = [0, 1, 2, 3, 4];
      room.p2Card = cpuCards[Math.floor(Math.random() * cpuCards.length)];
    }

    if (room.p1Card !== null && room.p2Card !== null) {
      resolveTurn(roomId);
    }
  });

  function resolveTurn(roomId) {
    const room = rooms[roomId];
    const c1 = room.p1Card; 
    const c2 = room.p2Card;
    
    // マトリックスから結果を取得
    const result = matrix[`${c1}-${c2}`];
    const p1Dmg = result[0];
    const p2Dmg = result[1];
    const p1Heal = result[2];
    const p2Heal = result[3];
    const msg = result[4];

    // HP計算（最大10）
    room.p1Hp = Math.min(10, room.p1Hp - p1Dmg + p1Heal);
    room.p2Hp = Math.min(10, room.p2Hp - p2Dmg + p2Heal);

    // 文字列としてカード名を送信（main.jsの書き換えを不要にするため）
    io.to(roomId).emit('turnResult', {
      p1Card: cardNames[c1], 
      p2Card: cardNames[c2], 
      p1Hp: room.p1Hp, 
      p2Hp: room.p2Hp, 
      message: msg
    });

    if (room.p1Hp <= 0 || room.p2Hp <= 0) {
      let winner = room.p1Hp > 0 ? 'P1' : (room.p2Hp > 0 ? 'P2' : 'Draw');
      io.to(roomId).emit('gameOver', winner);
      delete rooms[roomId];
    } else {
      room.p1Card = null; room.p2Card = null;
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動: ポート${PORT}`);
});
