(function() {
    'use strict';

    // -- PLANCK.JS & ALIASES --
    const pl = planck;
    const Vec2 = pl.Vec2;

    // -- CONFIGURATION --
    const Config = {
        PPM: 100,
        GRAVITY: -16,
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
        BALL_DAMP: 0.3,
        BALL_VMAX: 12,
        BLOB_R: 0.38,
        BLOB_DENS: 1.0,
        BLOB_REST: 0.2,
        BLOB_FRIC: 0.9,
        BLOB_DAMP: 2.0,
        MOVE_FORCE: 15.0,
        JUMP_IMPULSE: 5.2,
        SERVE_TOSS_L: { vx: 1.8, vy: 2.8 },
        SERVE_TOSS_R: { vx: -1.8, vy: 2.8 },
        MANUAL_SERVE_IMPULSE: { vx: 1.0, vy: 4.5 },
        AI_REACTION_DELAY: { Easy: 0.2, Normal: 0.12, Hard: 0.06 },
        AI_FORCE_SCALE: { Easy: 0.8, Normal: 1.0, Hard: 1.2 },
        AI_JUMP_RANDOM: { Easy: 0.1, Normal: 0.06, Hard: 0.02 },
    };

    // LiveConfig will be modified by the UI, initialized from defaults.
    let LiveConfig = {};

    const PhysicsPresets = {
        Default: { GRAVITY: -16, BALL_REST: 0.78, BALL_VMAX: 12 },
        Floaty: { GRAVITY: -8, BALL_REST: 0.85, BALL_VMAX: 10 },
        Fast: { GRAVITY: -22, BALL_REST: 0.70, BALL_VMAX: 18 },
    };

    // -- GAME STATE --
    const State = {
        world: null,
        bodies: { ball: null, blob1: null, blob2: null, ground: null, net: null },
        scores: { left: 0, right: 0 },
        servingSide: 'left',
        lastTouch: null,
        touchCount: 0,
        rallyStarted: false,
        inputFrozen: true,
        mode: '1P',
        difficulty: 'Normal',
        useTouchLimit: true,
        winScore: 11,
        isPaused: true,
        showDebug: false,
        serveMode: { active: false, player: null },
        timers: { scoreDebounce: 0, resetCountdown: 0, autoServe: 0 },
        keysPressed: new Set(),
        ai: { targetX: Config.COURT_W * 0.75, reactionTimer: 0 },
        render: { ballTrail: [], blob1Scale: { x: 1, y: 1 }, blob2Scale: { x: 1, y: 1 }, contactEffects: [] },
    };

    // -- DOM ELEMENTS --
    let canvas, ctx, panel, scoreEl, serverEl, messageEl, debugEl, actionBtn, settingsBtn, physicsPresetEl, gravitySlider, gravityValue, bounceSlider, bounceValue, speedSlider, speedValue;

    // -- UTILITIES --
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
    const lerp = (a, b, t) => a + (b - a) * t;
    const worldToScreen = (pos) => ({ x: pos.x * Config.PPM, y: canvas.height - (pos.y * Config.PPM) });

    // -- INITIALIZATION --
    window.addEventListener('load', () => {
        Object.assign(LiveConfig, Config); // Initialize live config
        
        canvas = document.getElementById('game');
        ctx = canvas.getContext('2d');
        panel = document.getElementById('panel');
        scoreEl = document.getElementById('score');
        serverEl = document.getElementById('server-indicator');
        messageEl = document.getElementById('message');
        debugEl = document.getElementById('debug-info');
        actionBtn = document.getElementById('action-btn');
        settingsBtn = document.getElementById('settings-btn');
        
        // Physics UI elements
        physicsPresetEl = document.getElementById('physics-preset');
        gravitySlider = document.getElementById('gravity-slider');
        gravityValue = document.getElementById('gravity-value');
        bounceSlider = document.getElementById('bounce-slider');
        bounceValue = document.getElementById('bounce-value');
        speedSlider = document.getElementById('speed-slider');
        speedValue = document.getElementById('speed-value');

        setupUI();
        setupInputListeners();
        initWorld();
        
        let lastTime = 0, accumulator = 0;
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
        State.world = pl.World({ gravity: Vec2(0, LiveConfig.GRAVITY), allowSleep: true });
        
        const ground = State.world.createBody({type: 'static', position: Vec2(0, 0)});
        ground.createFixture(pl.Edge(Vec2(0, 0), Vec2(Config.COURT_W, 0)), { restitution: 0.2, friction: 0.8 });
        ground.getFixtureList().setUserData({ type: 'ground' });
        State.bodies.ground = ground;

        const leftWall = State.world.createBody({type: 'static'});
        leftWall.createFixture(pl.Edge(Vec2(0, 0), Vec2(0, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });
        
        const rightWall = State.world.createBody({type: 'static'});
        rightWall.createFixture(pl.Edge(Vec2(Config.COURT_W, 0), Vec2(Config.COURT_W, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });
        
        const topWall = State.world.createBody({type: 'static'});
        topWall.createFixture(pl.Edge(Vec2(0, Config.COURT_H), Vec2(Config.COURT_W, Config.COURT_H)), { restitution: 0.2, friction: 0.8 });

        const net = State.world.createBody({type: 'static', position: Vec2(Config.COURT_W / 2, Config.NET_H / 2)});
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
            restitution: LiveConfig.BALL_REST,
            friction: Config.BALL_FRIC,
        });
        State.bodies.ball.setUserData({ type: 'ball' });

        setupContactListener();
    }
    
    function createBlob(x, side) { /* unchanged */ const blob=State.world.createDynamicBody({position:Vec2(x,Config.BLOB_R),linearDamping:Config.BLOB_DAMP,fixedRotation:!0});blob.createFixture(pl.Circle(Config.BLOB_R),{density:Config.BLOB_DENS,restitution:Config.BLOB_REST,friction:Config.BLOB_FRIC});blob.setUserData({type:"blob",side:side});return blob}

    // -- GAME LOGIC --
    function update(dt) {
        handleTimers(dt);
        if (State.serveMode.active) {
            const player = State.serveMode.player;
            const playerPos = player.getPosition();
            State.bodies.ball.setPosition(Vec2(playerPos.x, playerPos.y + Config.BLOB_R + Config.BALL_R + 0.1));
            State.bodies.ball.setLinearVelocity(Vec2(0, 0));
        }

        if (!State.inputFrozen) applyInputs();
        if (State.mode === '1P' && !State.inputFrozen) stepAI(dt);
        
        State.world.step(dt, Config.VEL_ITERS, Config.POS_ITERS);
        
        const ballVel = State.bodies.ball.getLinearVelocity();
        if (ballVel.lengthSquared() > LiveConfig.BALL_VMAX * LiveConfig.BALL_VMAX) {
            ballVel.normalize();
            ballVel.mul(LiveConfig.BALL_VMAX);
            State.bodies.ball.setLinearVelocity(ballVel);
        }
    }
    
    function handleTimers(dt) { /* unchanged */ for(const key in State.timers)State.timers[key]>0&&(State.timers[key]-=dt);State.timers.resetCountdown>0&&State.timers.resetCountdown-dt<=0&&serveBall();State.timers.autoServe>0&&State.timers.autoServe-dt<=0&&!State.rallyStarted&&serveBall()}

    function applyInputs() {
        // Player 1
        const blob1 = State.bodies.blob1;
        let force1 = 0;
        if (State.keysPressed.has('a')) force1 -= Config.MOVE_FORCE;
        if (State.keysPressed.has('d')) force1 += Config.MOVE_FORCE;
        blob1.applyForceToCenter(Vec2(force1, 0), true);

        if (State.keysPressed.has('w')) { tryJump(blob1); State.keysPressed.delete('w'); }
        if (State.keysPressed.has('s') && !State.serveMode.active && isBlobTouchingGroundedBall(blob1, State.bodies.ball)) {
            enterServeMode(blob1);
        }

        // Player 2
        if (State.mode === '2P') {
            const blob2 = State.bodies.blob2;
            let force2 = 0;
            if (State.keysPressed.has('arrowleft')) force2 -= Config.MOVE_FORCE;
            if (State.keysPressed.has('arrowright')) force2 += Config.MOVE_FORCE;
            blob2.applyForceToCenter(Vec2(force2, 0), true);
            if (State.keysPressed.has('arrowup')) { tryJump(blob2); State.keysPressed.delete('arrowup'); }
            if (State.keysPressed.has('arrowdown') && !State.serveMode.active && isBlobTouchingGroundedBall(blob2, State.bodies.ball)) {
                enterServeMode(blob2);
            }
        }
    }
    
    function isBlobTouchingGroundedBall(blob, ball) {
        if (ball.getPosition().y > Config.BALL_R + 0.05) return false; // Ball not grounded
        const distSq = Vec2.distanceSquared(blob.getPosition(), ball.getPosition());
        const radiusSum = Config.BLOB_R + Config.BALL_R;
        return distSq < (radiusSum * radiusSum);
    }
    
    function enterServeMode(player) {
        State.serveMode.active = true;
        State.serveMode.player = player;
        State.bodies.ball.setType('kinematic');
        State.rallyStarted = false; // Pause rally timers etc.
        State.lastTouch = null;
        State.touchCount = 0;
        messageEl.textContent = '... SET ...';
    }

    function launchManualServe() {
        if (!State.serveMode.active) return;
        
        const player = State.serveMode.player;
        const side = player.getUserData().side;
        
        State.bodies.ball.setType('dynamic');
        
        let impulse = Vec2(LiveConfig.MANUAL_SERVE_IMPULSE.vx, LiveConfig.MANUAL_SERVE_IMPULSE.vy);
        if (side === 'right') impulse.x *= -1;
        
        State.bodies.ball.applyLinearImpulse(impulse, State.bodies.ball.getPosition(), true);
        
        State.lastTouch = side;
        State.touchCount = 1;
        State.serveMode = { active: false, player: null };
        State.rallyStarted = true;
        messageEl.textContent = '';
    }

    function isGrounded(blob) { /* unchanged */ const pos=blob.getPosition();let isGrounded=!1;State.world.rayCast(Vec2(pos.x,pos.y),Vec2(pos.x,pos.y-Config.BLOB_R-.05),fixture=>{if(fixture.getBody()===State.bodies.ground)return isGrounded=!0,0;return-1});return isGrounded}
    function tryJump(blob) { /* unchanged */ Math.abs(blob.getLinearVelocity().y)<.1&&isGrounded(blob)&&blob.applyLinearImpulse(Vec2(0,LiveConfig.JUMP_IMPULSE),blob.getPosition(),!0)}
    function awardPoint(side) { /* unchanged */ if(State.timers.scoreDebounce>0)return;side==="left"?State.scores.left++:State.scores.right++;updateScoreDisplay();if(checkWinCondition())endMatch(side);else State.servingSide=side==="left"?"right":"left",resetRally();State.timers.scoreDebounce=.5}
    function checkWinCondition() { /* unchanged */ const{left:left,right:right}=State.scores;return(left>=State.winScore||right>=State.winScore)&&Math.abs(left-right)>=2}
    function endMatch(winner) { /* unchanged */ State.isPaused=!0;panel.classList.remove("hidden");messageEl.textContent=`${winner.toUpperCase()} WINS!`;actionBtn.textContent="New Match"}
    function startNewMatch() { /* unchanged */ State.scores.left=0;State.scores.right=0;updateScoreDisplay();State.servingSide=Math.random()<.5?"left":"right";State.isPaused=!1;panel.classList.add("hidden");actionBtn.textContent="Resume";resetRally()}
    function resetRally() { State.rallyStarted=!1,State.inputFrozen=!0,State.lastTouch=null,State.touchCount=0,State.timers.resetCountdown=3,State.timers.autoServe=5;const ball=State.bodies.ball,serveX=State.servingSide==="left"?Config.COURT_W*.25:Config.COURT_W*.75;ball.setType("dynamic");ball.setPosition(Vec2(serveX,Config.COURT_H*.7));ball.setLinearVelocity(Vec2(0,0));ball.setAngularVelocity(0);State.bodies.blob1.setPosition(Vec2(Config.COURT_W*.25,Config.BLOB_R));State.bodies.blob1.setLinearVelocity(Vec2(0,0));State.bodies.blob2.setPosition(Vec2(Config.COURT_W*.75,Config.BLOB_R));State.bodies.blob2.setLinearVelocity(Vec2(0,0))}
    function serveBall() { /* unchanged */ if(State.rallyStarted)return;State.rallyStarted=!0,State.inputFrozen=!1,State.timers.resetCountdown=0,messageEl.textContent="";const ball=State.bodies.ball,toss=State.servingSide==="left"?Config.SERVE_TOSS_L:Config.SERVE_TOSS_R;ball.applyLinearImpulse(Vec2(toss.vx,toss.vy),ball.getPosition(),!0)}
    function setupContactListener() { /* unchanged */ State.world.on("begin-contact",contact=>{const bodyA=contact.getFixtureA().getBody(),bodyB=contact.getFixtureB().getBody(),dataA=bodyA.getUserData()||{},dataB=bodyB.getUserData()||{},ball=dataA.type==="ball"?bodyA:dataB.type==="ball"?bodyB:null;if(!ball)return;const otherData=dataA.type==="ball"?dataB:dataA;if(otherData.type==="ground")awardPoint(ball.getPosition().x<Config.COURT_W/2?"right":"left");else if(otherData.type==="blob"){State.lastTouch!==otherData.side?State.touchCount=1:State.touchCount++;State.lastTouch=otherData.side;State.useTouchLimit&&State.touchCount>3&&awardPoint(otherData.side==="left"?"right":"left");State.render.contactEffects.push({pos:ball.getPosition(),radius:0,alpha:1})}})}
    function stepAI(dt) { /* unchanged */ State.ai.reactionTimer-=dt;if(State.ai.reactionTimer>0)return;State.ai.reactionTimer=Config.AI_REACTION_DELAY[State.difficulty];const ball=State.bodies.ball,aiBlob=State.bodies.blob2,ballPos=ball.getPosition(),blobPos=aiBlob.getPosition();if(!State.rallyStarted&&State.servingSide==="right"){if(ballPos.y<blobPos.y+Config.BLOB_R*2.5){State.ai.targetX=ballPos.x+.1;if(Math.abs(blobPos.x-ballPos.x)<.2)tryJump(aiBlob)}}else if(ballPos.x>Config.COURT_W/2){const prediction=predictBallLanding();State.ai.targetX=prediction.pos.x-.2;const shouldJump=ball.getLinearVelocity().y<-1&&Math.abs(ballPos.x-blobPos.x)<Config.BLOB_R*1.5&&ballPos.y-blobPos.y<Config.BLOB_R*2.5&&ballPos.y>blobPos.y;if(shouldJump&&Math.random()>Config.AI_JUMP_RANDOM[State.difficulty])tryJump(aiBlob)}else State.ai.targetX=Config.COURT_W*.75;State.ai.targetX=clamp(State.ai.targetX,Config.COURT_W/2+Config.NET_T+Config.BLOB_R,Config.COURT_W-Config.BLOB_R);const error=State.ai.targetX-blobPos.x,force=clamp(error*10,-Config.MOVE_FORCE,Config.MOVE_FORCE)*Config.AI_FORCE_SCALE[State.difficulty];aiBlob.applyForceToCenter(Vec2(force,0),!0)}
    function predictBallLanding() { /* unchanged */ let pos=State.bodies.ball.getPosition().clone(),vel=State.bodies.ball.getLinearVelocity().clone();const dt=1/60;for(let i=0;i<120;i++){vel.y+=LiveConfig.GRAVITY*dt;vel.mul(1-Config.BALL_DAMP*dt);pos.add(vel.clone().mul(dt));if(pos.x>Config.COURT_W/2&&vel.y<0)return{pos:pos,time:i*dt};if(pos.y<Config.BALL_R)return{pos:pos,time:i*dt};if(pos.x<Config.BALL_R||pos.x>Config.COURT_W-Config.BALL_R)return{pos:pos,time:i*dt};if(pos.y>Config.COURT_H-Config.BALL_R)return{pos:pos,time:i*dt}}return{pos:Vec2(Config.COURT_W*.75,0),time:2}}
    function render() { /* unchanged */ ctx.clearRect(0,0,1600,900);ctx.save();drawCourt();if(State.bodies.ball){drawBallTrail();drawBody(State.bodies.ball,getComputedStyle(document.body).getPropertyValue("--ball-color"));drawBlob(State.bodies.blob1,getComputedStyle(document.body).getPropertyValue("--blob1-color"),"blob1Scale");drawBlob(State.bodies.blob2,getComputedStyle(document.body).getPropertyValue("--blob2-color"),"blob2Scale");drawContactEffects()}ctx.restore()}
    function drawCourt() { /* unchanged */ ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--court-bg");ctx.fillRect(0,0,1600,900);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--court-line");ctx.fillRect(0,900-5,1600,5);const netScreenPos=worldToScreen(State.bodies.net.getPosition()),netWidth=Config.NET_T*Config.PPM,netHeight=Config.NET_H*Config.PPM;ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--net-color");ctx.fillRect(netScreenPos.x-netWidth/2,netScreenPos.y-netHeight/2,netWidth,netHeight)}
    function drawBody(body,color) { /* unchanged */ const pos=worldToScreen(body.getPosition()),fixture=body.getFixtureList();if(!fixture)return;const radius=fixture.getShape().m_radius*Config.PPM;ctx.beginPath();ctx.arc(pos.x,pos.y,radius,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()}
    function drawBlob(body,color,scaleKey) { /* unchanged */ const pos=worldToScreen(body.getPosition()),vel=body.getLinearVelocity(),radius=body.getFixtureList().getShape().m_radius*Config.PPM,targetScaleX=1+.08*clamp(vel.x/6,-1,1),targetScaleY=1-.12*clamp(Math.abs(vel.y)/8,0,1);State.render[scaleKey].x=lerp(State.render[scaleKey].x,targetScaleX,.2);State.render[scaleKey].y=lerp(State.render[scaleKey].y,targetScaleY,.2);ctx.save();ctx.translate(pos.x,pos.y);ctx.scale(State.render[scaleKey].x,State.render[scaleKey].y);ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.beginPath();const eyeSide=body.getUserData().side==="left"?1:-1,eyeX=radius*.4*eyeSide/State.render[scaleKey].x,eyeY=-radius*.2/State.render[scaleKey].y;ctx.arc(eyeX,eyeY,radius*.15,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();ctx.restore()}
    function drawBallTrail() { /* unchanged */ const trail=State.render.ballTrail;trail.push(State.bodies.ball.getPosition().clone());if(trail.length>10)trail.shift();const color=getComputedStyle(document.body).getPropertyValue("--ball-color");for(let i=0;i<trail.length;i++){const screenPos=worldToScreen(trail[i]),radius=Config.BALL_R*Config.PPM*(i/trail.length);ctx.beginPath();ctx.arc(screenPos.x,screenPos.y,radius,0,Math.PI*2);ctx.fillStyle=color;ctx.globalAlpha=.5*(i/trail.length);ctx.fill()}ctx.globalAlpha=1}
    function drawContactEffects() { /* unchanged */ ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--text-color");ctx.lineWidth=2;State.render.contactEffects=State.render.contactEffects.filter(effect=>{effect.radius+=2;effect.alpha-=.05;if(effect.alpha<=0)return!1;const screenPos=worldToScreen(effect.pos);ctx.globalAlpha=effect.alpha;ctx.beginPath();ctx.arc(screenPos.x,screenPos.y,effect.radius,0,Math.PI*2);ctx.stroke();return!0});ctx.globalAlpha=1}
    function updateHUD(dt) { /* unchanged */ if(State.showDebug){frameCount++;lastFpsUpdate+=dt;if(lastFpsUpdate>=1){debugEl.textContent=`FPS: ${frameCount}`;frameCount=0;lastFpsUpdate=0}}if(State.timers.resetCountdown>0&&!State.isPaused)messageEl.textContent=`... ${Math.ceil(State.timers.resetCountdown)} ...`;else if(State.isPaused&&panel.classList.contains("hidden"))messageEl.textContent="PAUSED";else if(!State.rallyStarted&&!State.isPaused&&!State.serveMode.active)messageEl.textContent="... SERVE ...";else if(!panel.classList.contains("hidden"));else State.serveMode.active||(messageEl.textContent="");updateScoreDisplay()}
    function updateScoreDisplay() { /* unchanged */ scoreEl.textContent=`L ${State.scores.left} - ${State.scores.right} R`;const servingText=State.servingSide==="left"?"\u25c0 SERVE":"SERVE \u25b6";serverEl.textContent=State.rallyStarted||State.isPaused||State.serveMode.active?"":servingText}
    
    // -- UI & INPUT --
    function setupUI() {
        document.querySelectorAll('input[name="mode"]').forEach(el => el.addEventListener('change', (e) => State.mode = e.target.value));
        document.querySelectorAll('input[name="difficulty"]').forEach(el => el.addEventListener('change', (e) => State.difficulty = e.target.value));
        document.querySelectorAll('input[name="win-score"]').forEach(el => el.addEventListener('change', (e) => State.winScore = parseInt(e.target.value, 10)));
        document.querySelectorAll('input[name="touch-limit"]').forEach(el => el.addEventListener('change', (e) => State.useTouchLimit = e.target.value === 'true'));
        
        actionBtn.addEventListener('click', () => {
            const text = actionBtn.textContent;
            if (text === 'Start Game' || text === 'New Match') startNewMatch();
            else if (text === 'Resume') togglePause();
        });

        settingsBtn.addEventListener('click', togglePause);
        document.getElementById('theme-btn').addEventListener('click', () => document.body.classList.toggle('dark'));

        // Physics UI Listeners
        physicsPresetEl.addEventListener('change', (e) => {
            if (e.target.value !== 'Custom') {
                applyPhysicsPreset(e.target.value);
            }
        });

        gravitySlider.addEventListener('input', handleSliderChange);
        bounceSlider.addEventListener('input', handleSliderChange);
        speedSlider.addEventListener('input', handleSliderChange);

        initPhysicsUI();
    }
    
    function initPhysicsUI() {
        gravitySlider.value = -LiveConfig.GRAVITY;
        gravityValue.textContent = (-LiveConfig.GRAVITY).toFixed(1);
        bounceSlider.value = LiveConfig.BALL_REST;
        bounceValue.textContent = LiveConfig.BALL_REST.toFixed(2);
        speedSlider.value = LiveConfig.BALL_VMAX;
        speedValue.textContent = LiveConfig.BALL_VMAX.toFixed(1);
        physicsPresetEl.value = "Default";
    }

    function applyPhysicsPreset(presetName) {
        const preset = PhysicsPresets[presetName];
        if (!preset) return;
        
        LiveConfig.GRAVITY = preset.GRAVITY;
        LiveConfig.BALL_REST = preset.BALL_REST;
        LiveConfig.BALL_VMAX = preset.BALL_VMAX;
        
        initPhysicsUI();
        updateLivePhysicsProperties();
    }
    
    function handleSliderChange(e) {
        physicsPresetEl.value = 'Custom';
        const val = parseFloat(e.target.value);
        if (e.target === gravitySlider) {
            LiveConfig.GRAVITY = -val;
            gravityValue.textContent = val.toFixed(1);
        } else if (e.target === bounceSlider) {
            LiveConfig.BALL_REST = val;
            bounceValue.textContent = val.toFixed(2);
        } else if (e.target === speedSlider) {
            LiveConfig.BALL_VMAX = val;
            speedValue.textContent = val.toFixed(1);
        }
        updateLivePhysicsProperties();
    }
    
    function updateLivePhysicsProperties() {
        if (!State.world) return;
        State.world.setGravity(Vec2(0, LiveConfig.GRAVITY));
        if (State.bodies.ball) {
            State.bodies.ball.getFixtureList().setRestitution(LiveConfig.BALL_REST);
        }
    }

    function togglePause() {
        if (actionBtn.textContent === 'Start Game') return;
        State.isPaused = !State.isPaused;
        panel.classList.toggle('hidden', !State.isPaused);
        if (actionBtn.textContent !== 'New Match') actionBtn.textContent = State.isPaused ? 'Resume' : 'Pause';
    }

    function setupInputListeners() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'p') togglePause();
            if (key === 'f3') { e.preventDefault(); State.showDebug = !State.showDebug; debugEl.style.display = State.showDebug ? 'block' : 'none'; }
            
            const relevantKeys = ['w', 'a', 'd', 's', 'arrowup', 'arrowleft', 'arrowright', 'arrowdown'];
            if (relevantKeys.includes(key)) {
                e.preventDefault();
                State.keysPressed.add(key);
                if (State.bodies.blob1) State.bodies.blob1.setAwake(true);
                if (State.bodies.blob2) State.bodies.blob2.setAwake(true);
            }
        });
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            State.keysPressed.delete(key);
            
            // Handle serve on key release
            if (State.serveMode.active) {
                const side = State.serveMode.player.getUserData().side;
                if ((key === 's' && side === 'left') || (key === 'arrowdown' && side === 'right')) {
                    launchManualServe();
                }
            }
        });
    }
})();
