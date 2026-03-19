const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 【超重要】Xサーバー（別のURL）からの通信を許可する設定（CORS）
const io = new Server(server, {
  cors: {
    origin: "*", // ※とりあえず全許可。本番では "https://あなたのXサーバーのURL.com" にすると安全です
    methods: ["GET", "POST"]
  }
});

// ① GASからの「起きとけ！」通信を受け止めるエンドポイント
app.get('/ping', (req, res) => {
  res.send('Server is awake!');
  console.log('GASからpingを受信して起きました⏰');
});

// ② リアルタイム通信の処理（Socket.io）
io.on('connection', (socket) => {
  console.log('ユーザーが広場に入室しました: ' + socket.id);

  // クライアント（Xサーバー側の画面）から「動いたよ」というデータを受け取った時
  socket.on('move', (data) => {
    // 送り主「以外」の全員に、その動きのデータを転送する
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: data.position,
      rotation: data.rotation
    });
  });

  // ユーザーがタブを閉じるなどして切断した時
  socket.on('disconnect', () => {
    console.log('ユーザーが退室しました: ' + socket.id);
    // 残っている他のユーザーに「この人がいなくなったよ」と伝える
    io.emit('playerDisconnected', socket.id);
  });
});

// Renderが自動で割り当てるポート（または3000番）で待機
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーがポート${PORT}で起動しました🚀`);
});