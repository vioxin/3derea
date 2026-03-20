const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 🌐 CORS設定 (GitHub Pagesと通信するための許可)
const io = new Server(server, {
    cors: {
        origin: "*", // テスト用。本番では "https://あなたのユーザー名.github.io" を指定推奨
        methods: ["GET", "POST"]
    }
});

// 🔌 Renderのスリープ防止用エンドポイント (重複分を削除してスッキリさせました)
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! Server is awake.');
});

// 静的ファイルの提供
app.use(express.static('public'));

const COLORS = ['桃色', '青色', '緑色', '黄色'];
const SYMBOLS = ['ハティロン(ピラミッド)', 'アノン(目玉)', 'ドーン(太陽)', 'ヤール(アミュレット)'];
const NUMBERS = [1, 2, 3, 4, 5];
const DIRECTIONS = ['N(ニルポ)', 'E(エルポ)', 'S(サルポ)', 'W(ワルポ)'];

// ルーム管理
const rooms = {};

// デッキ生成とシャッフル
function createDeck() {
    let deck = [];
    COLORS.forEach(c => SYMBOLS.forEach(s => NUMBERS.forEach(n => deck.push({ color: c, symbol: s, number: n }))));
    return deck.sort(() => Math.random() - 0.5); 
}

io.on('connection', (socket) => {
    
    // 🚪 1. ルーム入室（名前を受け取り、待機ロビーに入れるように変更）
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            // gameState: 'lobby' を追加して、待機中であることを管理
            rooms[roomId] = { players: [], deck: createDeck(), fieldCard: null, turnIndex: 0, isForan: false, gameState: 'lobby' };
            rooms[roomId].fieldCard = rooms[roomId].deck.pop(); 
        }

        const room = rooms[roomId];
        
        // エラーチェック（すでにゲーム中、または満員なら弾く）
        if (room.gameState !== 'lobby') return socket.emit('errorMsg', 'すでにゲームが開始されています。');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'ルームが満員です。');

        const dir = DIRECTIONS[room.players.length];
        
        // プレイヤーデータの拡張
        room.players.push({
            id: socket.id,
            name: playerName || `探求者${socket.id.substring(0,4)}`, // 画面で入力した名前を設定
            isCpu: false,
            direction: dir,
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0,
            hasRedstone: true // UIのランプ表示用
        });

        io.to(roomId).emit('systemMessage', `🟢 ${room.players.at(-1).name} が入室しました。`);
        updateClientState(roomId);
    });

    // ⚔️ 2. ゲーム開始処理（ホストがボタンを押したら開始するように変更）
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players[0].id !== socket.id) return; // 1番目の人(ホスト)以外は無視
        
        room.gameState = 'playing'; // 状態をゲーム中に変更
        
        if (room.players.length < 4) {
            fillWithCPU(roomId); // 4人未満ならCPUで埋める
        } else {
            io.to(roomId).emit('systemMessage', `⚔️ 儀式開始！ 最初は ${room.players[0].name} のターンです。`);
            updateClientState(roomId);
            runCpuTurn(roomId);
        }
    });

    // 🗣️ 3. チャットコマンド（ゲーム中のみ反応するように変更）
    socket.on('chatCommand', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing') return; 

        const msg = message.trim();
        const player = room.players.find(p => p.id === socket.id);

        if (msg.match(/^(ラトン|フォラン|ムー|ラトムー|フォラムー|ムールガイ)$/)) {
            io.to(roomId).emit('systemMessage', `🗣️ ${player.name} が詠唱: 「${msg}」`);
            
            if (msg === 'フォラン') {
                room.isForan = !room.isForan;
                io.to(roomId).emit('systemMessage', `🌌 場が ${room.isForan ? '【冥界(フォラン)】' : '【現世(未フォラン)】'} になりました！`);
            }
            if (msg.includes('ムー')) {
                nextTurn(roomId); 
            }
            updateClientState(roomId);
        } else {
            socket.emit('systemMessage', `❌ 無効なコマンド: ${msg}`);
        }
    });

    // ⚡ 4. アシュラッテル（スコア加算処理を追加）
    socket.on('callAshuratteru', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        let correct = room.players.some(p => p.id !== socket.id && p.hand.reduce((a, b) => a + b.number, 0) === 10);
        
        if (correct) {
            player.score += 1; // 正解ならスコアをプラス
            io.to(roomId).emit('systemMessage', `⚡ アシュラッテル成功！ ${player.name} がポイントを獲得しました！`);
        } else {
            socket.emit('systemMessage', `❌ アシュラッテル失敗...条件を満たす者はいません。`);
        }
        updateClientState(roomId);
    });
});

// 🤖 CPUの補充と行動（名前をかっこよくしました）
function fillWithCPU(roomId) {
    const room = rooms[roomId];
    while (room.players.length < 4) {
        room.players.push({
            id: `CPU_${room.players.length}`,
            name: `🤖 自動人形 ${DIRECTIONS[room.players.length]}`,
            isCpu: true,
            direction: DIRECTIONS[room.players.length],
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0,
            hasRedstone: true
        });
    }
    io.to(roomId).emit('systemMessage', `🤖 人数が足りないため、自動人形が参加しました。儀式開始！`);
    updateClientState(roomId);
    runCpuTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    room.turnIndex = (room.turnIndex + 1) % 4;
    io.to(roomId).emit('systemMessage', `➡️ 次は ${room.players[room.turnIndex].name} のターンです。`);
    runCpuTurn(roomId);
}

function runCpuTurn(roomId) {
    const room = rooms[roomId];
    const currentPlayer = room.players[room.turnIndex];
    if (currentPlayer.isCpu && room.gameState === 'playing') {
        setTimeout(() => {
            io.to(roomId).emit('systemMessage', `🗣️ ${currentPlayer.name} が詠唱: 「ムー」`);
            nextTurn(roomId);
            updateClientState(roomId);
        }, 3000);
    }
}

// 📡 画面側に最新データを送る処理（誰のターンかの情報等を追加）
function updateClientState(roomId) {
    const room = rooms[roomId];
    io.to(roomId).emit('updateState', { 
        gameState: room.gameState, 
        isForan: room.isForan,
        players: room.players,
        fieldCard: room.fieldCard,
        turnIndex: room.turnIndex
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
