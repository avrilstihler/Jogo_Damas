const BOARD_SIZE = 8;
const EMPTY = 0;
const P1 = 1; // Player 1 (Red, starts bottom)
const P2 = 2; // Player 2 (Black, starts top)
const P1_KING = 3;
const P2_KING = 4;

const PIECE_TYPES = { EMPTY, P1, P2, P1_KING, P2_KING };

let boardData = [];
let currentPlayer = P1;
let selectedPiece = null; // { r, c, pieceVal, element }
let p1Score = 0;
let p2Score = 0;
let gameMode = 'pvp'; // 'pvp' or 'pvm' - default, will be set from start screen
let isGameOver = false;

let currentMandatoryJumps = []; // Stores { fromR, fromC, toR, toC, isJump, jumped: {r, c} }
let activePieceHighlightedMoves = []; // Moves highlighted for the selectedPiece

// --- Audio ---
let audioContext = null; // Initialize as null
let moveSoundBuffer, captureSoundBuffer, kingSoundBuffer, winSoundBuffer, loseSoundBuffer;
let soundsLoaded = false;

async function initAudio() {
    if (audioContext) return; // Already initialized
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioContext) {
        console.warn("Web Audio API not supported.");
        return;
    }
     // Resume context on first user interaction if needed (though startGame is already a user interaction)
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        [moveSoundBuffer, captureSoundBuffer, kingSoundBuffer, winSoundBuffer, loseSoundBuffer] = await Promise.all([
            loadSound('move_piece.mp3'),
            loadSound('capture_piece.mp3'),
            loadSound('king_promote.mp3'),
            loadSound('game_win.mp3'),
            loadSound('game_lose.mp3')
        ]);
        soundsLoaded = true;
        console.log("Sounds loaded (or attempted).");
    } catch (error) {
        console.error("Error loading one or more sounds:", error);
    }
}

async function loadSound(url) {
    if (!audioContext) return null;
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.error(`Error loading sound ${url}:`, error);
        return null;
    }
}

function playSound(buffer) {
    if (!buffer || !audioContext || audioContext.state === 'suspended' || !soundsLoaded) return;
    // It's good practice to ensure context is running, though initAudio should handle initial resume.
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
}

// --- Game Logic ---
function initializeBoard() {
    boardData = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        boardData[r] = new Array(BOARD_SIZE).fill(EMPTY);
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) { // Dark squares
                if (r < 3) boardData[r][c] = P2;       // Player 2 (Black) pieces
                else if (r > 4) boardData[r][c] = P1;  // Player 1 (Red) pieces
            }
        }
    }
}

function resetGame() {
    isGameOver = false;
    currentPlayer = P1;
    selectedPiece = null;
    p1Score = 0;
    p2Score = 0;
    activePieceHighlightedMoves = [];
    currentMandatoryJumps = []; // Ensure this is cleared on reset
    initializeBoard();
    calculateInitialMoves(); // Calculate moves for the starting player
    renderBoard();
    updateInfoDisplay();
    document.getElementById('message-area').textContent = '';
    document.getElementById('board').classList.remove('ai-thinking');
    
    // gameMode is already set by startGame or by start screen listeners before this.
    // If PvM and AI is P2 (starts second), P1 will make first move.
    // If PvM and AI is P1 (e.g. if sides were switchable), then AI would start.
    // Current setup: P1 (human) always starts.
}

function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = ''; // Clear existing board

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const squareDiv = document.createElement('div');
            squareDiv.classList.add('square');
            squareDiv.classList.add((r + c) % 2 === 0 ? 'light' : 'dark');
            squareDiv.dataset.r = r;
            squareDiv.dataset.c = c;

            const pieceVal = boardData[r][c];
            if (pieceVal !== EMPTY) {
                const pieceDiv = document.createElement('div');
                pieceDiv.classList.add('piece');
                if (pieceVal === P1) pieceDiv.classList.add('p1-piece');
                else if (pieceVal === P2) pieceDiv.classList.add('p2-piece');
                else if (pieceVal === P1_KING) pieceDiv.classList.add('p1-piece', 'king');
                else if (pieceVal === P2_KING) pieceDiv.classList.add('p2-piece', 'king');
                
                squareDiv.appendChild(pieceDiv);

                if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                    pieceDiv.classList.add('selected-piece-highlight');
                }
                // Highlight pieces that must jump if mandatory jumps exist
                if (currentMandatoryJumps.length > 0 && currentMandatoryJumps.some(jump => jump.fromR === r && jump.fromC === c)) {
                    squareDiv.classList.add('must-move-piece'); // Highlight the square or piece
                }
            }
            
            // Highlight valid moves for the selected piece
            const isActiveMove = activePieceHighlightedMoves.find(move => move.toR === r && move.toC === c);
            if (isActiveMove) {
                squareDiv.classList.add(isActiveMove.isJump ? 'valid-jump-highlight' : 'valid-move-highlight');
            }
            
            squareDiv.addEventListener('click', () => handleSquareClick(r, c));
            boardElement.appendChild(squareDiv);
        }
    }
}

function isPlayerPiece(pieceVal, player) {
    if (player === P1) return pieceVal === P1 || pieceVal === P1_KING;
    if (player === P2) return pieceVal === P2 || pieceVal === P2_KING;
    return false;
}

function isOpponentPiece(pieceVal, player) {
    if (player === P1) return pieceVal === P2 || pieceVal === P2_KING;
    if (player === P2) return pieceVal === P1 || pieceVal === P1_KING;
    return false;
}

function isKing(pieceVal) {
    return pieceVal === P1_KING || pieceVal === P2_KING;
}

function getPieceMoves(r, c, pieceVal, boardState) { // Pass boardState for hypothetical checks
    const moves = [];
    const jumps = [];
    const player = (pieceVal === P1 || pieceVal === P1_KING) ? P1 : P2;
    
    let directions = [];
    if (pieceVal === P1) directions = [-1]; // P1 normal moves "up" (decreasing row index)
    else if (pieceVal === P2) directions = [1];  // P2 normal moves "down" (increasing row index)
    else if (isKing(pieceVal)) directions = [-1, 1]; // Kings move both ways

    for (const dr of directions) {
        for (const dc of [-1, 1]) { // Check left and right diagonals
            const nextR = r + dr;
            const nextC = c + dc;

            if (nextR >= 0 && nextR < BOARD_SIZE && nextC >= 0 && nextC < BOARD_SIZE) { // Is valid square
                if (boardState[nextR][nextC] === EMPTY) {
                    moves.push({ fromR:r, fromC:c, toR: nextR, toC: nextC, isJump: false, jumped: null });
                } else if (isOpponentPiece(boardState[nextR][nextC], player)) {
                    const jumpR = r + 2 * dr;
                    const jumpC = c + 2 * dc;
                    if (jumpR >= 0 && jumpR < BOARD_SIZE && jumpC >= 0 && jumpC < BOARD_SIZE && boardState[jumpR][jumpC] === EMPTY) {
                        jumps.push({ 
                            fromR:r, fromC:c, toR: jumpR, toC: jumpC, isJump: true, 
                            jumped: { r: nextR, c: nextC } 
                        });
                    }
                }
            }
        }
    }
    // Standard checkers: if jumps are available for this piece, only they are valid.
    return jumps.length > 0 ? jumps : moves;
}

function findAllPlayerMoves(player, boardState) {
    let allMoves = [];
    let hasJumps = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const pieceVal = boardState[r][c];
            if (isPlayerPiece(pieceVal, player)) {
                const pieceSpecificMoves = getPieceMoves(r, c, pieceVal, boardState);
                if (pieceSpecificMoves.some(m => m.isJump)) {
                    hasJumps = true;
                }
                allMoves.push(...pieceSpecificMoves);
            }
        }
    }
    if (hasJumps) {
        return allMoves.filter(m => m.isJump);
    }
    return allMoves;
}

function handleSquareClick(r, c) {
    if (isGameOver) return;
    // AI turn blocking is handled by `currentPlayer === P2` condition now.
    if (gameMode === 'pvm' && currentPlayer === P2 && !selectedPiece?.continuingJump) { 
         return;
    }
    // Resume audio context on user interaction if needed
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const clickedPieceVal = boardData[r][c];

    if (selectedPiece) { // A piece is already selected
        const targetMove = activePieceHighlightedMoves.find(move => move.toR === r && move.toC === c);
        if (targetMove) {
            makeMove(selectedPiece.r, selectedPiece.c, targetMove.toR, targetMove.toC, targetMove.jumped, targetMove.isJump);
        } else if (isPlayerPiece(clickedPieceVal, currentPlayer) && (!currentMandatoryJumps.length || currentMandatoryJumps.some(jump => jump.fromR === r && jump.fromC === c))) {
            // Clicked on another of own pieces. If mandatory jumps exist, new piece must be one of them.
            selectPiece(r, c, clickedPieceVal);
        } else {
            deselectPiece();
        }
    } else { // No piece selected, try to select one
        if (isPlayerPiece(clickedPieceVal, currentPlayer)) {
            if (currentMandatoryJumps.length > 0) {
                if (currentMandatoryJumps.some(jump => jump.fromR === r && jump.fromC === c)) {
                    selectPiece(r, c, clickedPieceVal);
                } else {
                    document.getElementById('message-area').textContent = "Salto obrigatório! Selecione uma peça destacada.";
                }
            } else {
                 selectPiece(r, c, clickedPieceVal);
            }
        }
    }
    renderBoard(); // Re-render to show selection/deselection or move highlights
}

function selectPiece(r, c, pieceVal) {
    selectedPiece = { r, c, pieceVal };
    // Get moves for this specific piece
    let pieceMoves = getPieceMoves(r, c, pieceVal, boardData);

    // Filter by mandatory jumps if they exist for the player AND involve this piece
    if (currentMandatoryJumps.length > 0) {
        activePieceHighlightedMoves = pieceMoves.filter(pm => 
            pm.isJump && currentMandatoryJumps.some(mj => mj.fromR === r && mj.fromC === c && mj.toR === pm.toR && mj.toC === pm.toC)
        );
    } else {
        activePieceHighlightedMoves = pieceMoves;
    }
    if(activePieceHighlightedMoves.length === 0 && pieceMoves.length > 0 && currentMandatoryJumps.length === 0){
        // this piece has moves, but none are mandatory jumps (and no mandatory jumps for player)
        // so, this piece is fine to select.
    } else if (activePieceHighlightedMoves.length === 0) {
        // This piece has no valid moves currently (e.g. blocked or only non-jumps when jump is mandatory elsewhere)
        deselectPiece(); // effectively don't select it
        return;
    }
}

function deselectPiece() {
    selectedPiece = null;
    activePieceHighlightedMoves = [];
}

function makeMove(fromR, fromC, toR, toC, jumpedCoord, isJumpMove) {
    const pieceVal = boardData[fromR][fromC];
    boardData[toR][toC] = pieceVal;
    boardData[fromR][fromC] = EMPTY;

    if (isJumpMove && jumpedCoord) {
        boardData[jumpedCoord.r][jumpedCoord.c] = EMPTY;
        if (currentPlayer === P1) p1Score++; else p2Score++;
        playSound(captureSoundBuffer);
    } else {
        playSound(moveSoundBuffer);
    }

    // Promotion
    let promoted = false;
    if (pieceVal === P1 && toR === 0) { boardData[toR][toC] = P1_KING; promoted = true; }
    if (pieceVal === P2 && toR === BOARD_SIZE - 1) { boardData[toR][toC] = P2_KING; promoted = true; }
    if (promoted) playSound(kingSoundBuffer);

    // Check for multi-jumps
    let furtherJumps = [];
    if (isJumpMove) { // Only check for multi-jumps after a jump
        furtherJumps = getPieceMoves(toR, toC, boardData[toR][toC], boardData).filter(m => m.isJump);
    }

    deselectPiece(); // Clear current selection and its highlights before switching or continuing.

    if (isJumpMove && furtherJumps.length > 0) {
        // Must continue jumping with this piece
        currentMandatoryJumps = furtherJumps; // These are the ONLY moves allowed now
        selectPiece(toR, toC, boardData[toR][toC]); // Reselect the piece at its new location
        selectedPiece.continuingJump = true; // Mark that AI is in multi-jump
        // Turn does not switch. Player (or AI) must make another jump.
        if (gameMode === 'pvm' && currentPlayer === P2) {
             // AI needs to make its next jump
             setTimeout(aiTurn, 500); // Give a slight delay
        }
    } else {
        switchTurn();
    }
    
    updateInfoDisplay();
    checkWinConditions(); // Check win after every move, including intermediate multi-jumps.
    if(!isGameOver) renderBoard(); // Render unless game over message handled it
}

function switchTurn() {
    currentPlayer = (currentPlayer === P1) ? P2 : P1;
    calculateInitialMoves(); // Calculate mandatory jumps for the new player

    if (!isGameOver) {
         updateInfoDisplay(); // Update turn display
         if (gameMode === 'pvm' && currentPlayer === P2) {
            document.getElementById('board').classList.add('ai-thinking');
            setTimeout(aiTurn, 750 + Math.random() * 500); // AI "thinking" time
        } else {
            document.getElementById('board').classList.remove('ai-thinking');
        }
    }
}

function calculateInitialMoves() {
    // This calculates all possible moves for the current player and determines mandatory jumps
    const allMovesForCurrentPlayer = findAllPlayerMoves(currentPlayer, boardData);
    currentMandatoryJumps = allMovesForCurrentPlayer.filter(m => m.isJump);
    // If no mandatory jumps, all non-jump moves are implicitly available.
    // The piece selection logic will use currentMandatoryJumps to filter.
}

function updateInfoDisplay() {
    document.getElementById('turn-display').textContent = `Vez: Jogador ${currentPlayer === P1 ? '1 (Branco)' : '2 (Preto)'}${ (gameMode === 'pvm' && currentPlayer === P2) ? ' - IA' : ''}`;
    document.getElementById('score-display').textContent = `Branco: ${p1Score} - Preto: ${p2Score}`;
}

function checkWinConditions() {
    if (isGameOver) return;

    const p1HasPieces = boardData.flat().some(p => p === P1 || p === P1_KING);
    const p2HasPieces = boardData.flat().some(p => p === P2 || p === P2_KING);
    const totalPiecesPerPlayer = 12; // Standard checkers

    // Verificar se P1 venceu
    if (!p2HasPieces || p1Score === totalPiecesPerPlayer) {
        endGame(P1); // P1 venceu
        return;
    }

    // Verificar se P2 venceu
    if (!p1HasPieces || p2Score === totalPiecesPerPlayer) {
        endGame(P2); // P2 venceu
        return;
    }

    // Verificar se P1 não tem movimentos (P2 vence)
    const p1Moves = findAllPlayerMoves(P1, boardData);
    if (p1Moves.length === 0 && p1HasPieces) { // Adicionado p1HasPieces para garantir que não é por falta de peças
        endGame(P2); // P1 não tem movimentos, P2 vence
        return;
    }

    // Verificar se P2 não tem movimentos (P1 vence)
    const p2Moves = findAllPlayerMoves(P2, boardData);
    if (p2Moves.length === 0 && p2HasPieces) { // Adicionado p2HasPieces para garantir que não é por falta de peças
        endGame(P1); // P2 não tem movimentos, P1 vence
        return;
    }
}

function endGame(winner) {
    isGameOver = true;
    let message = "";
    if (winner === P1) {
        message = "Jogador 1 (Branco) venceu!";
        playSound(winSoundBuffer);
    } else if (winner === P2) {
        message = `Jogador 2 (Preto)${gameMode === 'pvm' ? ' (IA)' : ''} venceu!`;
        if (gameMode === 'pvm') playSound(loseSoundBuffer); // P1 loses to AI
        else playSound(winSoundBuffer); // P2 wins in PvP
    } else {
        message = "Empate!"; // Not implemented, checkers usually doesn't draw this way easily.
        playSound(loseSoundBuffer); // Or a neutral end sound
    }
    document.getElementById('message-area').textContent = message;
    document.getElementById('board').classList.remove('ai-thinking'); // Ensure board is interactive for reset
    renderBoard(); // Final render to clear highlights
}

function aiTurn() {
    if (isGameOver || currentPlayer !== P2 || gameMode !== 'pvm') {
        document.getElementById('board').classList.remove('ai-thinking');
        return;
    }
    
    let movesToConsider;
    // If AI is in a multi-jump, currentMandatoryJumps will be set for THAT piece only.
    if (selectedPiece && selectedPiece.continuingJump) { // AI is in a multi-jump sequence
        movesToConsider = activePieceHighlightedMoves; // These are pre-calculated jumps for the current piece
    } else { // Standard AI turn start
        // Recalculate based on current board state for AI
        const allAIMoves = findAllPlayerMoves(P2, boardData);
        currentMandatoryJumps = allAIMoves.filter(m => m.isJump); // Update AI's mandatory jumps specifically
        if (currentMandatoryJumps.length > 0) {
            movesToConsider = currentMandatoryJumps;
        } else {
            movesToConsider = allAIMoves;
        }
    }


    if (movesToConsider.length === 0) {
        // AI has no moves. This should be caught by checkWinConditions after P1's turn.
        // If it occurs here, it's likely a state issue or P1 just won.
        document.getElementById('board').classList.remove('ai-thinking');
        checkWinConditions(); // Re-check, P1 might have won
        return;
    }

    // Simple AI: pick a random valid move
    const chosenMove = movesToConsider[Math.floor(Math.random() * movesToConsider.length)];
    
    // Simulate piece selection (visual only, selectedPiece state will be set by makeMove if multi-jump)
    // selectPiece(chosenMove.fromR, chosenMove.fromC, boardData[chosenMove.fromR][chosenMove.fromC]);
    // renderBoard(); // Show AI "thinking" or selected piece (optional, can be jerky)

    // Brief delay before AI makes its move
    // setTimeout(() => {
        makeMove(chosenMove.fromR, chosenMove.fromC, chosenMove.toR, chosenMove.toC, chosenMove.jumped, chosenMove.isJump);
        // If makeMove resulted in a multi-jump for AI, AI turn will be called again from there or switchTurn will handle it.
        // If not a multi-jump, switchTurn was called, and it will remove ai-thinking class if P1's turn.
        // If it's still AI's turn (multi-jump), ai-thinking remains.
    // }, 250); // Reduced delay as main delay is before aiTurn() call
}

// --- Event Listeners & Init ---
let selectedGameModeOnStartScreen = 'pvp'; // Default, will be updated by start screen buttons

async function startGame() {
    gameMode = selectedGameModeOnStartScreen; // Set the global gameMode from the start screen selection
    await initAudio(); // Initialize audio context and load sounds
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    // Apply pixel button class to reset button and back to menu button if not done in HTML (it is now)
    // document.getElementById('reset-button').classList.add('pixel-button');
    // document.getElementById('back-to-menu-button').classList.add('pixel-button');
    resetGame(); // Now reset the game, which includes rendering the initial board
}

document.addEventListener('DOMContentLoaded', () => {
    const startGameButton = document.getElementById('start-game-button');
    const startPvpButton = document.getElementById('start-pvp-button');
    const startPvmButton = document.getElementById('start-pvm-button');
    const resetButton = document.getElementById('reset-button');
    const backToMenuButton = document.getElementById('back-to-menu-button');
    const gameContainer = document.getElementById('game-container');
    const startScreen = document.getElementById('start-screen');

    // Apply base pixel button style to relevant buttons on start screen & game screen
    // This is now primarily handled by CSS classes directly in HTML, but this ensures it.
    [startGameButton, startPvpButton, startPvmButton, resetButton, backToMenuButton].forEach(button => {
        if (button) button.classList.add('pixel-button');
    });
    
    // Specific classes for start screen mode buttons are handled in HTML and CSS
    if (startPvpButton) startPvpButton.classList.add('start-mode-button');
    if (startPvmButton) startPvmButton.classList.add('start-mode-button');


    // Ensure game container is hidden and start screen visible initially
    gameContainer.style.display = 'none';
    startScreen.style.display = 'flex';


    startGameButton.addEventListener('click', startGame);

    startPvpButton.addEventListener('click', () => {
        selectedGameModeOnStartScreen = 'pvp';
        startPvpButton.classList.add('active');
        startPvmButton.classList.remove('active');
    });
    startPvmButton.addEventListener('click', () => {
        selectedGameModeOnStartScreen = 'pvm';
        startPvmButton.classList.add('active');
        startPvpButton.classList.remove('active');
    });

    resetButton.addEventListener('click', () => {
         // resetGame is called only after sounds are loaded (and game has started)
         if (soundsLoaded) resetGame(); // This check might be redundant if button only visible post-load
    });

    backToMenuButton.addEventListener('click', () => {
        gameContainer.style.display = 'none';
        startScreen.style.display = 'flex';
        document.getElementById('message-area').textContent = ''; // Clear game messages
        
        // Light state reset when returning to menu - current game is effectively abandoned.
        // A full resetGame() isn't strictly needed as startGame() will do it.
        deselectPiece(); 
        currentMandatoryJumps = [];
        isGameOver = false; // In case game ended, reset this so start screen options are fresh
        // No need to re-render board as it's hidden.
        document.getElementById('board').classList.remove('ai-thinking'); // Ensure AI thinking overlay is off
    });

    // Initial active state for PvP button on start screen
    if (selectedGameModeOnStartScreen === 'pvp') {
        startPvpButton.classList.add('active');
        startPvmButton.classList.remove('active');
    } else {
        startPvmButton.classList.add('active');
        startPvpButton.classList.remove('active');
    }
});