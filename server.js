const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/ping', (req, res) => res.status(200).send('Pong!'));
app.use(express.static('public'));

const COLORS = ['桃色', '青色', '緑色', '黄色'];
const SYMBOLS = ['ハティロン', 'アノン', 'ドーン', 'ヤール']; // 判定しやすく簡略化
const NUMBERS = [1, 2, 3, 4, 5];
const DIRECTIONS = ['N', 'E', 'S', 'W'];
const DIR_VOCAB = { 'ニルポ': 'N', 'エルポ': 'E', 'サルポ': 'S', 'ワルポ': 'W' };

const rooms = {};

function createDeck() {
    let deck = [];
    COLORS.forEach(c => SYMBOLS.forEach(s => NUMBERS.forEach(n => deck.push({ color: c, symbol: s, number: n }))));
    return deck.sort(() => Math.random() - 0.5); 
}

// 🧮 スコア計算ロジック
function calculateScore(hand, isForan) {
    if (isForan) {
        return hand.reduce((sum, card) => sum + card.number, 0);
    } else {
        let score = 0;
        const nums = hand.map(c => c.number).sort((a,b) => a-b);
        const cols = hand.map(c => c.color);
        
        // 階段
        if (nums[0] + 1 === nums[1] && nums[1] + 1 === nums[2]) score += 1;
        // 数字一致
        if (nums[0] === nums[1] && nums[1] === nums[2]) score += 2;
        else if (nums[0] === nums[1] || nums[1] === nums[2]) score += 1;
        // 色一致
        if (cols[0] === cols[1] && cols[1] === cols[2]) score += 2;
        else if (cols[0] === cols[1] || cols[1] === cols[2] || cols[0] === cols[2]) score += 1;
        
        return score;
    }
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], deck: createDeck(), 
                fieldCards: { N: null, E: null, S: null, W: null },
                turnIndex: 0, isForan: false, gameState: 'lobby', redstoneActive: true,
                murugaiTriggerId: null // ムールガイ発動者の記憶用
            };
            DIRECTIONS.forEach(dir => rooms[roomId].fieldCards[dir] = rooms[roomId].deck.pop());
        }

        const room = rooms[roomId];
        if (room.gameState !== 'lobby') return socket.emit('errorMsg', 'すでにゲームが開始されています。');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'ルームが満員です。');

        const dir = DIRECTIONS[room.players.length];
        room.players.push({
            id: socket.id, name: playerName || `探求者${socket.id.substring(0,4)}`,
            isCpu: false, direction: dir,
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0, commandState: 'idle', ratonHandIndex: -1
        });

        io.to(roomId).emit('systemMessage', `🟢 ${room.players.at(-1).name} (${dir}) が入室しました。`);
        updateClientState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players[0].id !== socket.id) return; 
        room.gameState = 'playing';
        io.to(roomId).emit('systemMessage', `⚔️ 儀式開始！ 最初は ${room.players[0].name} のターンです。`);
        updateClientState(roomId);
    });

    // 🖱️ 右クリックでのカード選択 (ラトン時のみ有効)
    socket.on('rightClickHand', ({ roomId, index }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);

        if (player.commandState === 'awaiting_raton_click') {
            player.ratonHandIndex = index;
            player.commandState = 'awaiting_raton_dir';
            socket.emit('systemMessage', `【ラトン継続】手札が選択されました。交換する場の方角（ニルポ/サルポ/ワルポ/エルポ）を詠唱してください。`);
            updateClientState(roomId);
        }
    });

    socket.on('chatCommand', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing') return; 
        
        const msg = message.trim();
        const player = room.players.find(p => p.id === socket.id);
        const isMyTurn = room.players[room.turnIndex].id === socket.id;

        io.to(roomId).emit('systemMessage', `🗣️ ${player.name} : 「${msg}」`);

        // 自分のターンでない時の発言は基本無視（チャットとしては流れる）
        if (!isMyTurn && !msg.startsWith('タッパー') && !msg.startsWith('ハムサハム')) return;

        // 🌟 ラトンの処理ルート
        // 🌟 ラトンの処理ルート
        if (player.commandState === 'awaiting_raton_dir') {
            const dir = DIR_VOCAB[msg];
            if (dir) {
                const handIdx = player.ratonHandIndex;
                
                // 🌟 ① アニメーションの合図を全員に送る
                io.to(roomId).emit('animateSwap', { 
                    playerId: player.id, 
                    playerDir: player.direction, 
                    handIndex: handIdx, 
                    targetDir: dir 
                });

                // 実際のデータ交換
                const temp = player.hand[handIdx];
                player.hand[handIdx] = room.fieldCards[dir];
                room.fieldCards[dir] = temp;
                
                player.commandState = 'awaiting_ratomu';
                socket.emit('systemMessage', `【交換完了】続けて「ラトムー」と詠唱してターンを終了してください。`);
                
                // 🌟 ② アニメーションが終わるまで（0.6秒）画面の更新を待つ
                setTimeout(() => {
                    updateClientState(roomId);
                }, 600);
            }
            return;
        }

        if (player.commandState === 'awaiting_ratomu' && msg === 'ラトムー') {
            player.commandState = 'idle';
            nextTurn(roomId);
            return;
        }

        if (player.commandState === 'awaiting_foramu' && msg === 'フォラムー') {
            player.commandState = 'idle';
            nextTurn(roomId);
            return;
        }

        // 🌟 基本詠唱
        if (msg === 'ラトン') {
            player.commandState = 'awaiting_raton_click';
            socket.emit('systemMessage', `【ラトン発動】交換したい手札を「右クリック」してください。`);
            updateClientState(roomId);
        }
        else if (msg === 'フォラン') {
            room.isForan = !room.isForan;
            player.commandState = 'awaiting_foramu';
            io.to(roomId).emit('systemMessage', `🌌 場が ${room.isForan ? '【冥界】' : '【現世】'} に反転した！「フォラムー」と詠唱してください。`);
            updateClientState(roomId);
        }
        else if (msg === 'ムー') {
            nextTurn(roomId);
        }
        else if (msg === 'ムールガイ') {
            room.murugaiTriggerId = socket.id;
            io.to(roomId).emit('systemMessage', `⚠️ 【ムールガイ発動】次回の ${player.name} のターン開始時に儀式は終了する...！`);
            nextTurn(roomId);
        }
        // 🌟 レッドストーン消費技
        else if (msg.startsWith('タッパー')) {
            if (!room.redstoneActive) return socket.emit('systemMessage', '❌ レッドストーンはすでに消費されています。');
            const targetSymbol = SYMBOLS.find(s => msg.includes(s));
            if (targetSymbol) {
                room.redstoneActive = false; // 消費
                io.to(roomId).emit('systemMessage', `💥 【タッパー発動】全ての手札の ${targetSymbol} がランダムなカードに変異した！`);
                // 全員の対象カードをすり替える処理
                room.players.forEach(p => {
                    p.hand = p.hand.map(c => c.symbol === targetSymbol ? room.deck.pop() : c);
                });
                updateClientState(roomId);
            }
        }
        else if (msg.startsWith('ハムサハム')) {
            if (!room.redstoneActive) return socket.emit('systemMessage', '❌ レッドストーンはすでに消費されています。');
            room.redstoneActive = false; // 消費
            io.to(roomId).emit('systemMessage', `👁️ 【ハムサハム発動】${player.name} から時計回りに、手札の最大数値を宣言せよ！`);
            updateClientState(roomId);
        }
    });

    socket.on('callAshuratteru', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'gameover') return; // 終了時のみ可能
        const player = room.players.find(p => p.id === socket.id);
        let correct = room.players.some(p => p.id !== socket.id && p.hand.reduce((a, b) => a + b.number, 0) === 10);
        
        if (correct) {
            player.score += 1;
            io.to(roomId).emit('systemMessage', `⚡ アシュラッテル成功！ ${player.name} が1点獲得！`);
            updateClientState(roomId);
        } else {
            socket.emit('systemMessage', `❌ 失敗。合計10の者はいなかった。`);
        }
    });
});

function nextTurn(roomId) {
    const room = rooms[roomId];
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    
    // ムールガイ発動者が再びターンを迎えたらゲーム終了
    if (room.players[room.turnIndex].id === room.murugaiTriggerId) {
        room.gameState = 'gameover';
        io.to(roomId).emit('systemMessage', `🛑 儀式終了！ 全員の手札を公開せよ！`);
        
        // 全員のスコア計算
        room.players.forEach(p => {
            p.score += calculateScore(p.hand, room.isForan);
        });
        updateClientState(roomId);
        return;
    }
    
    io.to(roomId).emit('systemMessage', `➡️ ${room.players[room.turnIndex].name} のターン。`);
    updateClientState(roomId);
}

function updateClientState(roomId) {
    const room = rooms[roomId];
    io.to(roomId).emit('updateState', { 
        gameState: room.gameState, 
        isForan: room.isForan,
        players: room.players.map(p => ({ ...p, commandState: p.commandState, hand: (room.gameState === 'gameover' || p.id === io.sockets.sockets.keys().next().value) ? p.hand : [null, null, null] })), // 自分以外は裏向きにする(簡易実装)
        fieldCards: room.fieldCards,
        turnIndex: room.turnIndex,
        redstoneActive: room.redstoneActive 
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
