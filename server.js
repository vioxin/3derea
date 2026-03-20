const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/ping', (req, res) => res.status(200).send('Pong!'));
app.use(express.static('public'));

const COLORS = ['桃色', '青色', '緑色', '黄色'];
const SYMBOLS = ['ハティロン', 'アノン', 'ドーン', 'ヤール'];
const NUMBERS = [1, 2, 3, 4, 5];
const DIRECTIONS = ['N', 'E', 'S', 'W'];
const DIR_VOCAB = { 'ニルポ': 'N', 'エルポ': 'E', 'サルポ': 'S', 'ワルポ': 'W' };

const rooms = {};

function createDeck() {
    let deck = [];
    COLORS.forEach(c => SYMBOLS.forEach(s => NUMBERS.forEach(n => deck.push({ color: c, symbol: s, number: n }))));
    return deck.sort(() => Math.random() - 0.5); 
}

function calculateScore(hand, isForan) {
    if (isForan) {
        return hand.reduce((sum, card) => sum + card.number, 0);
    } else {
        let score = 0;
        const nums = hand.map(c => c.number).sort((a,b) => a-b);
        const cols = hand.map(c => c.color);
        if (nums[0] + 1 === nums[1] && nums[1] + 1 === nums[2]) score += 1;
        if (nums[0] === nums[1] && nums[1] === nums[2]) score += 2;
        else if (nums[0] === nums[1] || nums[1] === nums[2]) score += 1;
        if (cols[0] === cols[1] && cols[1] === cols[2]) score += 2;
        else if (cols[0] === cols[1] || cols[1] === cols[2] || cols[0] === cols[2]) score += 1;
        return score;
    }
}

io.on('connection', (socket) => {
    // 🚪 ルーム作成
    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁のランダム番号
        joinRoomLogic(socket, roomId, playerName);
        socket.emit('roomCreated', roomId); // 作成者に番号を教える
    });

    // 🚪 ルーム参加
    socket.on('joinRoom', ({ roomId, playerName }) => {
        if (!rooms[roomId]) return socket.emit('errorMsg', 'そのルームは存在しません。');
        joinRoomLogic(socket, roomId, playerName);
    });

    function joinRoomLogic(socket, roomId, playerName) {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], deck: createDeck(), 
                fieldCards: { N: null, E: null, S: null, W: null },
                turnIndex: 0, isForan: false, gameState: 'lobby', redstoneActive: true, murugaiTriggerId: null
            };
            DIRECTIONS.forEach(dir => rooms[roomId].fieldCards[dir] = rooms[roomId].deck.pop());
        }

        const room = rooms[roomId];
        if (room.gameState !== 'lobby') return socket.emit('errorMsg', 'すでに開始されています。');
        if (room.players.length >= 4) return socket.emit('errorMsg', '満員です。');

        const dir = DIRECTIONS[room.players.length];
        room.players.push({
            id: socket.id, name: playerName || `探求者${socket.id.substring(0,4)}`,
            isCpu: false, direction: dir,
            hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
            score: 0, commandState: 'idle', ratonHandIndex: -1
        });

        io.to(roomId).emit('systemMessage', `🟢 ${room.players.at(-1).name} が参加しました。`);
        updateClientState(roomId);
    }

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players[0].id !== socket.id) return; 
        
        // 足りない人数をCPUで埋める
        while (room.players.length < 4) {
            const dir = DIRECTIONS[room.players.length];
            room.players.push({
                id: `CPU_${Math.random()}`, name: `CPU_${dir}`,
                isCpu: true, direction: dir,
                hand: [room.deck.pop(), room.deck.pop(), room.deck.pop()],
                score: 0, commandState: 'idle', ratonHandIndex: -1
            });
        }
        
        room.gameState = 'playing';
        io.to(roomId).emit('systemMessage', `⚔️ 儀式開始！ 最初は ${room.players[0].name} のターンです。`);
        updateClientState(roomId);
        
        // もし最初の人がCPUなら動かす
        if (room.players[0].isCpu) setTimeout(() => runCpuTurn(roomId, room.players[0]), 2000);
    });

    socket.on('rightClickHand', ({ roomId, index }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);

        if (player && player.commandState === 'awaiting_raton_click') {
            player.ratonHandIndex = index;
            player.commandState = 'awaiting_raton_dir';
            socket.emit('systemMessage', `【ラトン継続】交換する場の方角（ニルポ/サルポ/ワルポ/エルポ）を詠唱せよ。`);
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

        if (!isMyTurn && !msg.startsWith('タッパー') && !msg.startsWith('ハムサハム')) return;

        if (player.commandState === 'awaiting_raton_dir') {
            const dir = DIR_VOCAB[msg];
            if (dir) {
                const handIdx = player.ratonHandIndex;
                io.to(roomId).emit('animateSwap', { playerId: player.id, playerDir: player.direction, handIndex: handIdx, targetDir: dir });
                
                const temp = player.hand[handIdx];
                player.hand[handIdx] = room.fieldCards[dir];
                room.fieldCards[dir] = temp;
                
                player.commandState = 'awaiting_ratomu';
                socket.emit('systemMessage', `【交換完了】「ラトムー」と詠唱せよ。`);
                setTimeout(() => updateClientState(roomId), 600);
            }
            return;
        }

        if (player.commandState === 'awaiting_ratomu' && msg === 'ラトムー') {
            player.commandState = 'idle'; nextTurn(roomId); return;
        }

        if (player.commandState === 'awaiting_foramu' && msg === 'フォラムー') {
            player.commandState = 'idle'; nextTurn(roomId); return;
        }

        if (msg === 'ラトン') {
            player.commandState = 'awaiting_raton_click';
            socket.emit('systemMessage', `【ラトン】手札を「右クリック」せよ。`);
            updateClientState(roomId);
        }
        else if (msg === 'フォラン') {
            room.isForan = !room.isForan;
            player.commandState = 'awaiting_foramu';
            io.to(roomId).emit('systemMessage', `🌌 場が ${room.isForan ? '【冥界】' : '【現世】'} に反転した！「フォラムー」と詠唱せよ。`);
            updateClientState(roomId);
        }
        else if (msg === 'ムー') nextTurn(roomId);
        else if (msg === 'ムールガイ') {
            room.murugaiTriggerId = socket.id;
            io.to(roomId).emit('systemMessage', `⚠️ 【ムールガイ発動】次回 ${player.name} のターン開始時に儀式終了！`);
            nextTurn(roomId);
        }
        else if (msg.startsWith('タッパー')) {
            if (!room.redstoneActive) return socket.emit('systemMessage', '❌ レッドストーンは消費済み。');
            const targetSymbol = SYMBOLS.find(s => msg.includes(s));
            if (targetSymbol) {
                room.redstoneActive = false;
                io.to(roomId).emit('systemMessage', `💥 【タッパー】全ての手札の ${targetSymbol} が変異した！`);
                room.players.forEach(p => p.hand = p.hand.map(c => c.symbol === targetSymbol ? room.deck.pop() : c));
                updateClientState(roomId);
            }
        }
        else if (msg.startsWith('ハムサハム')) {
            if (!room.redstoneActive) return socket.emit('systemMessage', '❌ レッドストーンは消費済み。');
            room.redstoneActive = false;
            io.to(roomId).emit('systemMessage', `👁️ 【ハムサハム】${player.name} から時計回りに最大数を宣言せよ！`);
            updateClientState(roomId);
        }
    });

    function nextTurn(roomId) {
        const room = rooms[roomId];
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const activePlayer = room.players[room.turnIndex];
        
        if (activePlayer.id === room.murugaiTriggerId) {
            room.gameState = 'gameover';
            io.to(roomId).emit('systemMessage', `🛑 儀式終了！ 全員の手札を公開せよ！`);
            room.players.forEach(p => p.score += calculateScore(p.hand, room.isForan));
            updateClientState(roomId);
            return;
        }
        
        io.to(roomId).emit('systemMessage', `➡️ ${activePlayer.name} のターン。`);
        updateClientState(roomId);

        // CPUのターンの場合、自動で動かす
        if (activePlayer.isCpu) setTimeout(() => runCpuTurn(roomId, activePlayer), 2000);
    }

    function runCpuTurn(roomId, cpu) {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'playing' || room.players[room.turnIndex].id !== cpu.id) return;

        // 簡単なAI: 70%でムー、30%でラトン
        const isRaton = Math.random() < 0.3;
        
        if (isRaton) {
            io.to(roomId).emit('systemMessage', `🤖 ${cpu.name} : 「ラトン」`);
            setTimeout(() => {
                const handIdx = Math.floor(Math.random() * 3);
                const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
                
                io.to(roomId).emit('animateSwap', { playerId: cpu.id, playerDir: cpu.direction, handIndex: handIdx, targetDir: dir });
                const temp = cpu.hand[handIdx];
                cpu.hand[handIdx] = room.fieldCards[dir];
                room.fieldCards[dir] = temp;

                setTimeout(() => {
                    io.to(roomId).emit('systemMessage', `🤖 ${cpu.name} : 「ラトムー」`);
                    nextTurn(roomId);
                }, 1000);
            }, 1500);
        } else {
            io.to(roomId).emit('systemMessage', `🤖 ${cpu.name} : 「ムー」`);
            setTimeout(() => nextTurn(roomId), 1000);
        }
    }
});

function updateClientState(roomId) {
    const room = rooms[roomId];
    io.to(roomId).emit('updateState', { 
        gameState: room.gameState, 
        isForan: room.isForan,
        players: room.players.map(p => ({ ...p, commandState: p.commandState, hand: (room.gameState === 'gameover' || p.id === io.sockets.sockets.keys().next().value) ? p.hand : [null, null, null] })), 
        fieldCards: room.fieldCards,
        turnIndex: room.turnIndex,
        redstoneActive: room.redstoneActive 
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
