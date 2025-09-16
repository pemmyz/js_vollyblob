(function() {
    'use strict';

    // -- PLANCK.JS & ALIASES --
    const pl = planck;
    const Vec2 = pl.Vec2;

    // -- CONFIGURATION --
    const Config = {
        PPM: 100,
        GRAVITY: -15,
        DT: 1 / 60,
        VEL_ITERS: 8,
        POS_ITERS: 3,

        COURT_W: 9.0,
        COURT_H: 6.0,
        NET_H: 3.0,
        NET_T: 0.08,

        BALL_R: 0.16,
        BALL_DENS: 0.6,
        BALL_REST: 0.78,
        BALL_FRIC: 0.15,
        BALL_DAMP: 0.02,
        BALL_VMAX: 18,

        BLOB_R: 0.38,
        BLOB_DENS: 1.0,
        BLOB_REST: 0.2,
        BLOB_FRIC: 0.9,
        BLOB_DAMP: 2.0,
        MOVE_FORCE: 15.0,
        JUMP_IMPULSE: 5.5,

        // CHANGE: Significantly reduced vertical serve impulse for a gentler, playable serve.
        SERVE_TOSS_L: { vx: 1.8, vy: 2.8 },
        SERVE_TOSS_R: { vx: -1.8, vy: 2.8 },

        AI_REACTION_DELAY: { Easy: 0.2, Normal: 0.12, Hard: 0.06 },
        AI_FORCE_SCALE: { Easy: 0.8, Normal: 1.0, Hard: 1.2 },
        AI_JUMP_RANDOM: { Easy: 0.1, Normal: 0.06, Hard: 0.02 },
    };

    // -- GAME STATE --
    const State = {
        world: null,
        bodies: {
            ball: null,
            blob1: null,
            blob2: null,
            ground: null,
            net: null,
        },
        scores: { left: 0, right: 0 },
        servingSide: 'left',
        lastTouch: null, // 'left' or 'right'
        touchCount: 0,
        rallyStarted: false,
        inputFrozen: true,

        // UI & Game Options
        mode: '1P', // '1P' or '2P'
        difficulty: 'Normal',
        useTouchLimit: true,
        winScore: 11,

        isPaused: true,
        showDebug: false,
        
        // Timers
        timers: {
            scoreDebounce: 0,
            resetCountdown: 0,
            autoServe: 0,
        },

        // Input
        keysPressed: new Set(),

        // AI state
        ai: {
            targetX: Config.COURT_W * 0.75,
            reactionTimer: 0,
        },

        // Rendering state
        render: {
            ballTrail: [],
            blob1Scale: { x: 1, y: 1 },
            blob2Scale: { x: 1, y: 1 },
            contactEffects: [],
        },
    };

    // -- DOM ELEMENTS --
    let canvas, ctx, hud, panel, scoreEl, serverEl, messageEl, debugEl, pauseBtn;

    // -- UTILITIES --
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
    const lerp = (a, b, t) => a + (b - a) * t;
    const worldToScreen = (pos) => ({
        x: pos.x * Config.PPM,
        y: canvas.height - (pos.y * Config.PPM)
    });

    // -- INITIALIZATION --
    window.addEventListener('load', () => {
        canvas = document.getElementById('game');
        ctx = canvas.getContext('2d');

        hud = document.getElementById('hud');
        panel = document.getElementById('panel');
        scoreEl = document.getElementById('score');
        serverEl = document.getElementById('server-indicator');
        messageEl = document.getElementById('message');
        debugEl = document.getElementById('debug-info');
        pauseBtn = document.getElementById('pause-btn');

        setupUI();
        setupInputListeners();
        
        initWorld();
        
        let lastTime = 0;
        let accumulator = 0;
        
        function gameLoop(currentTime) {
            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            if (!State.isPaused) {
                accumulator += deltaTime;
                let steps = 0;
                while (accumulator >= Config.DT && steps < 5) {
                    update(Config.DT);
                    accumulator -= Config.DT;
                    steps++;
                }
            }

            render();
            updateHUD(deltaTime);

            requestAnimationFrame(gameLoop);
        }

        requestAnimationFrame(gameLoop);
    });

    function initWorld() {
        State.world = pl.World({ 
            gravity: Vec2(0, Config.GRAVITY),
            allowSleep: true,
        });
        
        // Create boundaries
        const ground = State.world.createBody({type: 'static', position: Vec2(0, 0)});
        ground.createFixture(pl.Edge(Vec2(0, 0), Vec2(Config.COURT_W, 0)), { restitution: 0.2, friction: 0.8 });
        ground.getFixtureList().setUserData({ type: 'ground' });
        State.bodies.ground = ground;

        const leftWall = State.world.createBody({type: 'static'});
        leftWall.createFixture(pl.Edge(Vec2(0, 0), Vec2(0, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });
        
        const rightWall = State.world.createBody({type: 'static'});
        rightWall.createFixture(pl.Edge(Vec2(Config.COURT_W, 0), Vec2(Config.COURT_W, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });
        
        // CHANGE: Added a ceiling to prevent the ball from leaving the play area.
        const topWall = State.world.createBody({type: 'static'});
        topWall.createFixture(pl.Edge(Vec2(0, Config.COURT_H), Vec2(Config.COURT_W, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });

        // Create net
        // The net's body is positioned by its center. COURT_W / 2 is the exact horizontal center of the world.
        const netPos = Vec2(Config.COURT_W / 2, Config.NET_H / 2);
        const net = State.world.createBody({type: 'static', position: netPos});
        net.createFixture(pl.Box(Config.NET_T / 2, Config.NET_H / 2), {restitution: 0.2, friction: 0.1});
        net.createFixture(pl.Circle(Vec2(0, Config.NET_H / 2), Config.NET_T / 2), {restitution: 0.2, friction: 0.1});
        net.getFixtureList().setUserData({ type: 'net' });
        State.bodies.net = net;

        State.bodies.blob1 = createBlob(Config.COURT_W * 0.25, 'left');
        State.bodies.blob2 = createBlob(Config.COURT_W * 0.75, 'right');

        State.bodies.ball = State.world.createDynamicBody({
            position: Vec2(Config.COURT_W / 2, Config.COURT_H * 0.7),
            linearDamping: Config.BALL_DAMP,
            bullet: true,
        });
        State.bodies.ball.createFixture(pl.Circle(Config.BALL_R), {
            density: Config.BALL_DENS,
            restitution: Config.BALL_REST,
            friction: Config.BALL_FRIC,
        });
        State.bodies.ball.setUserData({ type: 'ball' });

        setupContactListener();
    }

    function createBlob(x, side) {
        const blob = State.world.createDynamicBody({
            position: Vec2(x, Config.BLOB_R),
            linearDamping: Config.BLOB_DAMP,
            fixedRotation: true,
        });
        blob.createFixture(pl.Circle(Config.BLOB_R), {
            density: Config.BLOB_DENS,
            restitution: Config.BLOB_REST,
            friction: Config.BLOB_FRIC,
        });
        blob.setUserData({ type: 'blob', side: side });
        return blob;
    }

    // -- GAME LOGIC --
    function update(dt) {
        handleTimers(dt);

        if (!State.inputFrozen) {
            applyInputs();
            if (State.mode === '1P') {
                stepAI(dt);
            }
        }
        
        State.world.step(dt, Config.VEL_ITERS, Config.POS_ITERS);
        
        const ballVel = State.bodies.ball.getLinearVelocity();
        if (ballVel.lengthSquared() > Config.BALL_VMAX * Config.BALL_VMAX) {
            ballVel.normalize();
            ballVel.mul(Config.BALL_VMAX);
            State.bodies.ball.setLinearVelocity(ballVel);
        }
    }

    function handleTimers(dt) {
        for (const key in State.timers) {
            if (State.timers[key] > 0) {
                State.timers[key] -= dt;
            }
        }

        if (State.timers.resetCountdown > 0 && State.timers.resetCountdown - dt <= 0) {
            serveBall();
        }

        if (State.timers.autoServe > 0 && State.timers.autoServe - dt <= 0) {
            if (!State.rallyStarted) serveBall();
        }
    }
    
    function applyInputs() {
        const blob1 = State.bodies.blob1;
        let force1 = 0;
        if (State.keysPressed.has('a')) force1 -= Config.MOVE_FORCE;
        if (State.keysPressed.has('d')) force1 += Config.MOVE_FORCE;
        blob1.applyForceToCenter(Vec2(force1, 0), true);

        if (State.keysPressed.has('w')) {
            tryJump(blob1);
            State.keysPressed.delete('w');
        }

        if (State.mode === '2P') {
            const blob2 = State.bodies.blob2;
            let force2 = 0;
            if (State.keysPressed.has('arrowleft')) force2 -= Config.MOVE_FORCE;
            if (State.keysPressed.has('arrowright')) force2 += Config.MOVE_FORCE;
            blob2.applyForceToCenter(Vec2(force2, 0), true);

            if (State.keysPressed.has('arrowup')) {
                tryJump(blob2);
                State.keysPressed.delete('arrowup');
            }
        }
    }

    function isGrounded(blob) {
        const pos = blob.getPosition();
        const rayStart = Vec2(pos.x, pos.y);
        const rayEnd = Vec2(pos.x, pos.y - Config.BLOB_R - 0.05);
        let isGrounded = false;

        State.world.rayCast(rayStart, rayEnd, (fixture) => {
            if (fixture.getBody() === State.bodies.ground) {
                isGrounded = true;
                return 0;
            }
            return -1;
        });
        return isGrounded;
    }

    function tryJump(blob) {
        if (Math.abs(blob.getLinearVelocity().y) < 0.1 && isGrounded(blob)) {
            blob.applyLinearImpulse(Vec2(0, Config.JUMP_IMPULSE), blob.getPosition(), true);
        }
    }

    function awardPoint(side) {
        if (State.timers.scoreDebounce > 0) return;
        
        if (side === 'left') State.scores.left++;
        else State.scores.right++;

        updateScoreDisplay();

        if (checkWinCondition()) {
            endMatch(side);
        } else {
            State.servingSide = (side === 'left') ? 'right' : 'left';
            resetRally();
        }
        State.timers.scoreDebounce = 0.5;
    }

    function checkWinCondition() {
        const { left, right } = State.scores;
        return (left >= State.winScore || right >= State.winScore) && Math.abs(left - right) >= 2;
    }

    function endMatch(winner) {
        State.isPaused = true;
        panel.classList.remove('hidden');
        messageEl.textContent = `${winner.toUpperCase()} WINS!`;
        pauseBtn.textContent = 'New Match';
    }
    
    function startNewMatch() {
        State.scores.left = 0;
        State.scores.right = 0;
        updateScoreDisplay();
        State.servingSide = Math.random() < 0.5 ? 'left' : 'right';
        
        State.isPaused = false;
        panel.classList.add('hidden');
        pauseBtn.textContent = 'Pause';
        
        resetRally();
    }

    function resetRally() {
        State.rallyStarted = false;
        State.inputFrozen = true;
        State.lastTouch = null;
        State.touchCount = 0;
        State.timers.resetCountdown = 3.0;
        State.timers.autoServe = 5.0;

        const ball = State.bodies.ball;
        const serveX = State.servingSide === 'left' ? Config.COURT_W * 0.25 : Config.COURT_W * 0.75;
        ball.setPosition(Vec2(serveX, Config.COURT_H * 0.7));
        ball.setLinearVelocity(Vec2(0, 0));
        ball.setAngularVelocity(0);

        State.bodies.blob1.setPosition(Vec2(Config.COURT_W * 0.25, Config.BLOB_R));
        State.bodies.blob1.setLinearVelocity(Vec2(0, 0));
        State.bodies.blob2.setPosition(Vec2(Config.COURT_W * 0.75, Config.BLOB_R));
        State.bodies.blob2.setLinearVelocity(Vec2(0, 0));
    }

    function serveBall() {
        if (State.rallyStarted) return;
        
        State.rallyStarted = true;
        State.inputFrozen = false;
        State.timers.resetCountdown = 0;
        messageEl.textContent = '';
        
        const ball = State.bodies.ball;
        const toss = State.servingSide === 'left' ? Config.SERVE_TOSS_L : Config.SERVE_TOSS_R;
        ball.applyLinearImpulse(Vec2(toss.vx, toss.vy), ball.getPosition(), true);
    }
    
    // -- CONTACT LISTENER --
    function setupContactListener() {
        State.world.on('begin-contact', (contact) => {
            const bodyA = contact.getFixtureA().getBody();
            const bodyB = contact.getFixtureB().getBody();
            const dataA = bodyA.getUserData() || {};
            const dataB = bodyB.getUserData() || {};

            const ball = dataA.type === 'ball' ? bodyA : (dataB.type === 'ball' ? bodyB : null);
            if (!ball) return;
            
            const otherData = dataA.type === 'ball' ? dataB : dataA;

            if (otherData.type === 'ground') {
                const ballPos = ball.getPosition();
                awardPoint(ballPos.x < Config.COURT_W / 2 ? 'right' : 'left');
            } else if (otherData.type === 'blob') {
                if(State.lastTouch !== otherData.side) {
                    State.touchCount = 1;
                } else {
                    State.touchCount++;
                }
                State.lastTouch = otherData.side;
                
                if(State.useTouchLimit && State.touchCount > 3) {
                     awardPoint(otherData.side === 'left' ? 'right' : 'left');
                }

                State.render.contactEffects.push({
                    pos: ball.getPosition(),
                    radius: 0,
                    alpha: 1
                });
            }
        });
    }

    // -- AI LOGIC --
    function stepAI(dt) {
        State.ai.reactionTimer -= dt;
        if (State.ai.reactionTimer > 0) return;
        
        State.ai.reactionTimer = Config.AI_REACTION_DELAY[State.difficulty];
        
        const ball = State.bodies.ball;
        const aiBlob = State.bodies.blob2;
        const ballPos = ball.getPosition();
        const blobPos = aiBlob.getPosition();

        if (!State.rallyStarted && State.servingSide === 'right') {
            if (ballPos.y < blobPos.y + Config.BLOB_R * 2.5) {
                State.ai.targetX = ballPos.x + 0.1;
                if (Math.abs(blobPos.x - ballPos.x) < 0.2) tryJump(aiBlob);
            }
        }
        else if (ballPos.x > Config.COURT_W / 2) {
            const prediction = predictBallLanding();
            State.ai.targetX = prediction.pos.x - 0.2;
            
            const shouldJump = 
                ball.getLinearVelocity().y < -1.0 &&
                Math.abs(ballPos.x - blobPos.x) < Config.BLOB_R * 1.5 &&
                ballPos.y - blobPos.y < Config.BLOB_R * 2.5 && ballPos.y > blobPos.y;

            if (shouldJump && Math.random() > Config.AI_JUMP_RANDOM[State.difficulty]) {
               tryJump(aiBlob);
            }
        } else {
            State.ai.targetX = Config.COURT_W * 0.75;
        }

        State.ai.targetX = clamp(State.ai.targetX, Config.COURT_W / 2 + Config.NET_T + Config.BLOB_R, Config.COURT_W - Config.BLOB_R);
        const error = State.ai.targetX - blobPos.x;
        const force = clamp(error * 10, -Config.MOVE_FORCE, Config.MOVE_FORCE) * Config.AI_FORCE_SCALE[State.difficulty];
        aiBlob.applyForceToCenter(Vec2(force, 0), true);
    }

    function predictBallLanding() {
        let pos = State.bodies.ball.getPosition().clone();
        let vel = State.bodies.ball.getLinearVelocity().clone();
        const dt = 1/60;
        
        for(let i=0; i<120; i++) {
            vel.y += Config.GRAVITY * dt;
            vel.mul(1 - (Config.BALL_DAMP * dt));
            pos.add(vel.clone().mul(dt));

            if (pos.x > Config.COURT_W / 2 && vel.y < 0) {
                return { pos: pos, time: i * dt };
            }
            if (pos.y < Config.BALL_R) {
                return { pos: pos, time: i * dt };
            }
            if (pos.x < Config.BALL_R || pos.x > Config.COURT_W - Config.BALL_R) {
                 return { pos: pos, time: i * dt };
            }
            if (pos.y > Config.COURT_H - Config.BALL_R) {
                 return { pos: pos, time: i * dt };
            }
        }
        return { pos: Vec2(Config.COURT_W * 0.75, 0), time: 2.0 };
    }

    // -- RENDERING --
    function render() {
        ctx.clearRect(0, 0, 1600, 900);
        ctx.save();
        
        drawCourt();
        
        if (State.bodies.ball) {
            drawBallTrail();
            drawBody(State.bodies.ball, getComputedStyle(document.body).getPropertyValue('--ball-color'));
            drawBlob(State.bodies.blob1, getComputedStyle(document.body).getPropertyValue('--blob1-color'), 'blob1Scale');
            drawBlob(State.bodies.blob2, getComputedStyle(document.body).getPropertyValue('--blob2-color'), 'blob2Scale');
            drawContactEffects();
        }
        
        ctx.restore();
    }
    
    function drawCourt() {
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--court-bg');
        ctx.fillRect(0, 0, 1600, 900);

        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--court-line');
        ctx.fillRect(0, 900 - 5, 1600, 5);
        
        const netScreenPos = worldToScreen(State.bodies.net.getPosition());
        const netWidth = Config.NET_T * Config.PPM;
        const netHeight = Config.NET_H * Config.PPM;
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--net-color');
        ctx.fillRect(netScreenPos.x - netWidth / 2, netScreenPos.y - netHeight / 2, netWidth, netHeight);
    }
    
    function drawBody(body, color) {
        const pos = worldToScreen(body.getPosition());
        const fixture = body.getFixtureList();
        if (!fixture) return;
        const radius = fixture.getShape().m_radius * Config.PPM;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    function drawBlob(body, color, scaleKey) {
        const pos = worldToScreen(body.getPosition());
        const vel = body.getLinearVelocity();
        const radius = body.getFixtureList().getShape().m_radius * Config.PPM;

        const targetScaleX = 1 + 0.08 * clamp(vel.x / 6, -1, 1);
        const targetScaleY = 1 - 0.12 * clamp(Math.abs(vel.y) / 8, 0, 1);
        
        State.render[scaleKey].x = lerp(State.render[scaleKey].x, targetScaleX, 0.2);
        State.render[scaleKey].y = lerp(State.render[scaleKey].y, targetScaleY, 0.2);
        
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.scale(State.render[scaleKey].x, State.render[scaleKey].y);
        
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        
        ctx.beginPath();
        const eyeSide = body.getUserData().side === 'left' ? 1 : -1;
        const eyeX = radius * 0.4 * eyeSide / State.render[scaleKey].x;
        const eyeY = -radius * 0.2 / State.render[scaleKey].y;
        ctx.arc(eyeX, eyeY, radius * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.restore();
    }

    function drawBallTrail() {
        const trail = State.render.ballTrail;
        trail.push(State.bodies.ball.getPosition().clone());
        if (trail.length > 10) trail.shift();

        const color = getComputedStyle(document.body).getPropertyValue('--ball-color');
        for (let i = 0; i < trail.length; i++) {
            const screenPos = worldToScreen(trail[i]);
            const radius = Config.BALL_R * Config.PPM * (i / trail.length);
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.5 * (i / trail.length);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }

    function drawContactEffects() {
        ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--text-color');
        ctx.lineWidth = 2;
        State.render.contactEffects = State.render.contactEffects.filter(effect => {
            effect.radius += 2;
            effect.alpha -= 0.05;
            if (effect.alpha <= 0) return false;
            
            const screenPos = worldToScreen(effect.pos);
            ctx.globalAlpha = effect.alpha;
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, effect.radius, 0, Math.PI * 2);
            ctx.stroke();
            return true;
        });
        ctx.globalAlpha = 1.0;
    }

    // -- UI & INPUT --
    let frameCount = 0;
    let lastFpsUpdate = 0;
    function updateHUD(dt) {
        if(State.showDebug) {
            frameCount++;
            lastFpsUpdate += dt;
            if (lastFpsUpdate >= 1) {
                debugEl.textContent = `FPS: ${frameCount}`;
                frameCount = 0;
                lastFpsUpdate = 0;
            }
        }
        
        if (State.timers.resetCountdown > 0 && !State.isPaused) {
            const count = Math.ceil(State.timers.resetCountdown);
            messageEl.textContent = `... ${count} ...`;
        } else if (State.isPaused && panel.classList.contains('hidden')) {
            messageEl.textContent = 'PAUSED';
        } else if(!State.rallyStarted && !State.isPaused) {
             messageEl.textContent = `... SERVE ...`;
        } else if (State.isPaused && panel.classList.contains('hidden') === false) {
            // Message is handled by endMatch, do nothing here to avoid override
        } else {
            messageEl.textContent = '';
        }
        updateScoreDisplay();
    }

    function updateScoreDisplay() {
        scoreEl.textContent = `L ${State.scores.left} - ${State.scores.right} R`;
        const servingText = State.servingSide === 'left' ? '◀ SERVE' : 'SERVE ▶';
        serverEl.textContent = State.rallyStarted || State.isPaused ? '' : servingText;
    }

    function setupUI() {
        document.querySelectorAll('input[name="mode"]').forEach(el => {
            el.addEventListener('change', (e) => State.mode = e.target.value);
        });
        document.querySelectorAll('input[name="difficulty"]').forEach(el => {
            el.addEventListener('change', (e) => State.difficulty = e.target.value);
        });
        document.querySelectorAll('input[name="win-score"]').forEach(el => {
            el.addEventListener('change', (e) => State.winScore = parseInt(e.target.value, 10));
        });
        document.querySelectorAll('input[name="touch-limit"]').forEach(el => {
            el.addEventListener('change', (e) => State.useTouchLimit = e.target.value === 'true');
        });
        
        pauseBtn.addEventListener('click', () => {
            if (pauseBtn.textContent === 'Start Game' || pauseBtn.textContent === 'New Match') {
                startNewMatch();
            } else {
                togglePause();
            }
        });

        document.getElementById('theme-btn').addEventListener('click', () => {
            document.body.classList.toggle('dark');
        });
    }
    
    function togglePause() {
        State.isPaused = !State.isPaused;
        panel.classList.toggle('hidden', !State.isPaused);
        pauseBtn.textContent = State.isPaused ? 'Resume' : 'Pause';
    }

    function setupInputListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                if (pauseBtn.textContent !== 'Start Game' && pauseBtn.textContent !== 'New Match') {
                    togglePause();
                }
            }
            if (e.key === 'F3') {
                e.preventDefault();
                State.showDebug = !State.showDebug;
                debugEl.style.display = State.showDebug ? 'block' : 'none';
            }
            if (['w', 'a', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                State.keysPressed.add(e.key.toLowerCase());
                if (State.bodies.blob1) State.bodies.blob1.setAwake(true);
                if (State.bodies.blob2) State.bodies.blob2.setAwake(true);
            }
        });
        window.addEventListener('keyup', (e) => {
            State.keysPressed.delete(e.key.toLowerCase());
        });
    }

})();
