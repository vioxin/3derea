const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Renderのスリープ防止用エンドポイント (GASがここを叩きます)
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! Server is awake.');
});
const io = new Server(server, {
    cors: {
        // "あなたのユーザー名" の部分を実際のGitHubのものに変更してください。
        // （テスト中は "*" にするとどこからでも繋がりますが、本番はURLを指定するのが安全です）
        origin: "https://あなたのユーザー名.github.io", 
        methods: ["GET", "POST"]
    }
});

// Renderのスリープ防止用エンドポイント
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! Server is awake.');
});
// 静的ファイルの提供 (publicフォルダ内のindex.htmlを読み込む)
app.use(express.static('public'));

const COLORS = ['桃色', '青色', '緑色', '黄色'];
const SYMBOLS = ['ハティロン(ピラミッド)', 'アノン(目玉)', 'ドーン(太陽)', 'ヤール(アミュレット)'];
const NUMBERS = [1, 2, 3, 4, 5];
const DIRECTIONS = ['N(ニルポ)', 'E(エルポ)', 'S(サルポ)', 'W(ワルポ)'];

// ルーム管理
const rooms = {};

// デッキ生成
function createDeck() {
    let deck = [];
    COLORS.forEach(c => SYMBOLS.forEach(s => NUMBERS.forEach(n => deck.push({ color: c, symbol: s, number: n }))));
    return deck.sort(() => Math.random() - 0.5); // シャッフル
}

io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], deck: createDeck(), fieldCard: null, turnIndex: 0, isForan: false };
            rooms[roomId].fieldCard = rooms[roomId].deck.pop(); // 最初の中央カード
        }

        const room = rooms[roomId];
        const dir = DIRECTIONS[room.players.length % 4];
        
        // プレイヤー追加
        room.players.push({
            id: socket.id,
            isCpu: false,
            direction: dir,
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0
        });

        io.to(roomId).emit('systemMessage', `🟢 プレイヤーが ${dir} の位置で参加しました。`);
        
        // 4人に満たない場合、CPUを追加して開始
        if (room.players.length === 1) {
            setTimeout(() => fillWithCPU(roomId), 2000);
        }
        
        updateClientState(roomId);
    });

    socket.on('chatCommand', ({ roomId, message }) => {
        const msg = message.trim();
        const room = rooms[roomId];
        if (!room) return;

        // コマンド判定ロジック (簡易版)
        if (msg.match(/^(ラトン|フォラン|ムー|ラトムー|フォラムー|ムールガイ)$/)) {
            io.to(roomId).emit('systemMessage', `🗣️ ${socket.id.substring(0,4)} が詠唱: 「${msg}」`);
            
            // 状態の切り替え
            if (msg === 'フォラン') {
                room.isForan = !room.isForan;
                io.to(roomId).emit('systemMessage', `🌌 場が ${room.isForan ? '【冥界(フォラン)】' : '【現世(未フォラン)】'} になりました！`);
            }
            if (msg.includes('ムー')) {
                nextTurn(roomId); // ターン終了
            }
            updateClientState(roomId);
        } else {
            socket.emit('systemMessage', `❌ 無効なコマンド: ${msg}`);
        }
    });

    socket.on('callAshuratteru', (roomId) => {
        // アシュラッテル判定
        const room = rooms[roomId];
        let correct = room.players.some(p => p.id !== socket.id && p.hand.reduce((a, b) => a + b.number, 0) === 10);
        if (correct) {
            io.to(roomId).emit('systemMessage', `⚡ アシュラッテル成功！ ${socket.id.substring(0,4)} がポイント獲得！`);
        } else {
            socket.emit('systemMessage', `❌ アシュラッテル失敗...該当者なし。`);
        }
    });
});

function fillWithCPU(roomId) {
    const room = rooms[roomId];
    while (room.players.length < 4) {
        room.players.push({
            id: `CPU_${room.players.length}`,
            isCpu: true,
            direction: DIRECTIONS[room.players.length],
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0
        });
    }
    io.to(roomId).emit('systemMessage', `🤖 人数が足りないため、CPUが参加しました。ゲーム開始！`);
    updateClientState(roomId);
    runCpuTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    room.turnIndex = (room.turnIndex + 1) % 4;
    io.to(roomId).emit('systemMessage', `➡️ 次は ${room.players[room.turnIndex].direction} のターンです。`);
    runCpuTurn(roomId);
}

function runCpuTurn(roomId) {
    const room = rooms[roomId];
    const currentPlayer = room.players[room.turnIndex];
    if (currentPlayer.isCpu) {
        setTimeout(() => {
            // CPUはとりあえず「ムー」でターンを回す（拡張可能）
            io.to(roomId).emit('systemMessage', `🗣️ ${currentPlayer.direction}(CPU) が詠唱: 「ムー」`);
            nextTurn(roomId);
            updateClientState(roomId);
        }, 3000);
    }
}

function updateClientState(roomId) {
    const room = rooms[roomId];
    io.to(roomId).emit('updateState', { 
        isForan: room.isForan,
        players: room.players,
        fieldCard: room.fieldCard
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
