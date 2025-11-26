/**
 * BLOBBY VOLLEY 3D
 * Physics: Planck.js (2D)
 * Rendering: Three.js (3D)
 */

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const Config = {
        // Physics (Meters)
        GRAVITY: -18,
        DT: 1 / 60,
        COURT_W: 11.0,
        COURT_H: 7.0,
        NET_H: 3.2,
        NET_T: 0.1,
        BALL_R: 0.25,
        BALL_DENS: 0.5,
        BALL_REST: 0.85,
        BALL_FRIC: 0.3,
        BLOB_R: 0.55,
        BLOB_DENS: 1.2,
        BLOB_FRIC: 0.1,
        BLOB_DAMP: 1.5,
        MOVE_FORCE: 25.0,
        JUMP_IMPULSE: 7.5,
        // AI
        AI_SPEED_FAC: { Easy: 0.6, Normal: 1.0, Hard: 1.4 },
        AI_ERROR: { Easy: 0.4, Normal: 0.1, Hard: 0.02 },
        // Visuals
        COLOR_L: 0xe74c3c, // Red
        COLOR_R: 0x2ecc71, // Green
        COLOR_BALL: 0xf1c40f, // Yellow
        COLOR_COURT: 0x3498db,
        COLOR_BG_LIGHT: 0xf0f4f8,
        COLOR_BG_DARK: 0x1a202c,
    };

    let LiveConfig = { ...Config }; // Mutable config

    // --- GAME STATE ---
    const State = {
        // Physics
        world: null,
        bodies: { ball: null, blob1: null, blob2: null, ground: null },
        // Game Logic
        scores: { left: 0, right: 0 },
        servingSide: 'left',
        rallyStarted: false,
        isPaused: true,
        inputFrozen: true,
        mode: '1P',
        difficulty: 'Normal',
        winScore: 11,
        timers: { reset: 0, scoreDebounce: 0 },
        keys: new Set(),
        lastTouch: null,
        touchCount: 0,
        // AI
        ai: { targetX: 0, timer: 0 },
        // Visuals
        scene: null,
        camera: null,
        renderer: null,
        meshes: {},
        particles: []
    };

    // --- INIT ---
    window.addEventListener('load', () => {
        initThree();
        initPhysics();
        setupUI();
        setupInputs();
        
        // Animation Loop
        let lastTime = 0;
        function loop(time) {
            requestAnimationFrame(loop);
            const dt = (time - lastTime) / 1000 || 0;
            lastTime = time;

            if (!State.isPaused) {
                // Fixed time step for physics
                State.world.step(Config.DT);
                updateGameLogic(Config.DT);
            }

            updateVisuals(dt); // Interpolate/Update meshes
            State.renderer.render(State.scene, State.camera);
        }
        loop(0);
    });

    // --- THREE.JS SETUP ---
    function initThree() {
        const container = document.getElementById('game-container');
        
        // Scene
        State.scene = new THREE.Scene();
        State.scene.background = new THREE.Color(Config.COLOR_BG_LIGHT);
        State.scene.fog = new THREE.Fog(Config.COLOR_BG_LIGHT, 10, 30);

        // Camera
        State.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
        State.camera.position.set(Config.COURT_W / 2, 5, 16);
        State.camera.lookAt(Config.COURT_W / 2, 3, 0);

        // Renderer
        State.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        State.renderer.setSize(window.innerWidth, window.innerHeight);
        State.renderer.shadowMap.enabled = true;
        State.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(State.renderer.domElement);

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        State.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight.position.set(5, 15, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.left = -10;
        dirLight.shadow.camera.right = 10;
        State.scene.add(dirLight);

        // -- MESHES --

        // Materials
        const blobMatL = new THREE.MeshStandardMaterial({ color: Config.COLOR_L, roughness: 0.1, metalness: 0.1 });
        const blobMatR = new THREE.MeshStandardMaterial({ color: Config.COLOR_R, roughness: 0.1, metalness: 0.1 });
        const ballMat = new THREE.MeshStandardMaterial({ color: Config.COLOR_BALL, roughness: 0.3, metalness: 0.0 });
        const courtMat = new THREE.MeshStandardMaterial({ color: Config.COLOR_COURT, roughness: 0.8 });
        const netMat = new THREE.MeshPhongMaterial({ color: 0xffffff, opacity: 0.3, transparent: true, side: THREE.DoubleSide });

        // Floor
        const floorGeo = new THREE.PlaneGeometry(30, 20);
        const floor = new THREE.Mesh(floorGeo, courtMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        State.scene.add(floor);
        State.meshes.floor = floor;

        // Court Lines (Visual only)
        const lineGeo = new THREE.PlaneGeometry(Config.COURT_W, 0.1);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const baseline = new THREE.Mesh(lineGeo, lineMat);
        baseline.rotation.x = -Math.PI / 2;
        baseline.position.set(Config.COURT_W/2, 0.01, 0);
        State.scene.add(baseline);

        // Net
        const netGeo = new THREE.BoxGeometry(0.1, Config.NET_H, 4); // Thicker Z for 3D look
        const net = new THREE.Mesh(netGeo, netMat);
        net.position.set(Config.COURT_W / 2, Config.NET_H / 2, 0);
        net.castShadow = true;
        net.receiveShadow = true;
        State.scene.add(net);
        
        // Net Post (Top Bar)
        const netTopGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8);
        const netTop = new THREE.Mesh(netTopGeo, new THREE.MeshStandardMaterial({ color: 0x555555 }));
        netTop.rotation.x = Math.PI / 2;
        netTop.position.set(Config.COURT_W/2, Config.NET_H, 0);
        State.scene.add(netTop);

        // Blobs
        const blobGeo = new THREE.SphereGeometry(Config.BLOB_R, 32, 32);
        
        // P1
        State.meshes.blob1 = new THREE.Mesh(blobGeo, blobMatL);
        State.meshes.blob1.castShadow = true;
        addEyes(State.meshes.blob1, 1);
        State.scene.add(State.meshes.blob1);

        // P2
        State.meshes.blob2 = new THREE.Mesh(blobGeo, blobMatR);
        State.meshes.blob2.castShadow = true;
        addEyes(State.meshes.blob2, -1);
        State.scene.add(State.meshes.blob2);

        // Ball
        State.meshes.ball = new THREE.Mesh(new THREE.SphereGeometry(Config.BALL_R, 32, 32), ballMat);
        State.meshes.ball.castShadow = true;
        State.scene.add(State.meshes.ball);

        // Back Wall (Visual Context)
        const wallGeo = new THREE.PlaneGeometry(40, 20);
        const wallMat = new THREE.ShadowMaterial({ opacity: 0.1 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(Config.COURT_W/2, 5, -3);
        wall.receiveShadow = true;
        State.scene.add(wall);

        window.addEventListener('resize', onWindowResize);
    }

    function addEyes(parent, dir) {
        const whiteMat = new THREE.MeshBasicMaterial({color:0xffffff});
        const pupilMat = new THREE.MeshBasicMaterial({color:0x000000});
        
        const eyeGroup = new THREE.Group();
        const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const pupilGeo = new THREE.SphereGeometry(0.05, 8, 8);

        const eye = new THREE.Mesh(eyeGeo, whiteMat);
        eye.position.set(dir * 0.3, 0.1, 0.35);
        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.set(dir * 0.35, 0.1, 0.44);
        
        eyeGroup.add(eye);
        eyeGroup.add(pupil);
        parent.add(eyeGroup);
    }

    function onWindowResize() {
        State.camera.aspect = window.innerWidth / window.innerHeight;
        State.camera.updateProjectionMatrix();
        State.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // --- PHYSICS SETUP (Planck.js) ---
    function initPhysics() {
        const pl = planck;
        const Vec2 = pl.Vec2;

        State.world = pl.World({ gravity: Vec2(0, Config.GRAVITY) });

        // Materials
        const groundFixtureDef = { friction: 0.8, restitution: 0.2 };
        const wallFixtureDef = { friction: 0.0, restitution: 0.1 };

        // Ground
        const ground = State.world.createBody(Vec2(0, 0));
        ground.createFixture(pl.Edge(Vec2(-10, 0), Vec2(30, 0)), groundFixtureDef); // Infinite floor
        ground.setUserData({ type: 'ground' });
        State.bodies.ground = ground;

        // Walls
        const wallL = State.world.createBody(Vec2(0, 0));
        wallL.createFixture(pl.Edge(Vec2(0, 0), Vec2(0, 20)), wallFixtureDef);
        
        const wallR = State.world.createBody(Vec2(0, 0));
        wallR.createFixture(pl.Edge(Vec2(Config.COURT_W, 0), Vec2(Config.COURT_W, 20)), wallFixtureDef);

        const ceiling = State.world.createBody(Vec2(0, 0));
        ceiling.createFixture(pl.Edge(Vec2(-5, 15), Vec2(20, 15)), wallFixtureDef);

        // Net
        const netBody = State.world.createBody(Vec2(Config.COURT_W / 2, Config.NET_H / 2));
        netBody.createFixture(pl.Box(Config.NET_T / 2, Config.NET_H / 2), { friction: 0.1, restitution: 0.05 });
        netBody.createFixture(pl.Circle(Vec2(0, Config.NET_H / 2), Config.NET_T), { friction: 0.2, restitution: 0.1 }); // Top rounded
        netBody.setUserData({ type: 'net' });

        // Blobs
        function createBlob(x, side) {
            const body = State.world.createDynamicBody({
                position: Vec2(x, Config.BLOB_R),
                fixedRotation: true,
                linearDamping: Config.BLOB_DAMP
            });
            body.createFixture(pl.Circle(Config.BLOB_R), {
                density: Config.BLOB_DENS,
                friction: Config.BLOB_FRIC,
                restitution: 0.0 // No bounce on ground
            });
            body.setUserData({ type: 'blob', side: side });
            return body;
        }

        State.bodies.blob1 = createBlob(Config.COURT_W * 0.25, 'left');
        State.bodies.blob2 = createBlob(Config.COURT_W * 0.75, 'right');

        // Ball
        State.bodies.ball = State.world.createDynamicBody({
            position: Vec2(Config.COURT_W / 2, 5),
            bullet: true,
            linearDamping: 0.1
        });
        State.bodies.ball.createFixture(pl.Circle(Config.BALL_R), {
            density: Config.BALL_DENS,
            restitution: Config.BALL_REST,
            friction: Config.BALL_FRIC
        });
        State.bodies.ball.setUserData({ type: 'ball' });

        // Contacts
        State.world.on('begin-contact', (contact) => {
            const fa = contact.getFixtureA(), fb = contact.getFixtureB();
            const da = fa.getBody().getUserData(), db = fb.getBody().getUserData();
            if (!da || !db) return;

            const isBall = da.type === 'ball' || db.type === 'ball';
            if (!isBall) return;

            const other = da.type === 'ball' ? db : da;
            const ballPos = State.bodies.ball.getPosition();

            if (other.type === 'ground') {
                spawnParticles(ballPos, Config.COLOR_COURT);
                handleScore(ballPos.x < Config.COURT_W / 2 ? 'right' : 'left');
            } else if (other.type === 'blob') {
                spawnParticles(ballPos, 0xffffff);
                State.touchCount = (State.lastTouch === other.side) ? State.touchCount + 1 : 1;
                State.lastTouch = other.side;
                if (State.touchCount > 3) handleScore(other.side === 'left' ? 'right' : 'left');
            }
        });
    }

    // --- GAME LOGIC ---
    function updateGameLogic(dt) {
        // Timers
        if (State.timers.scoreDebounce > 0) State.timers.scoreDebounce -= dt;
        if (State.timers.reset > 0) {
            State.timers.reset -= dt;
            if (State.timers.reset <= 0) spawnBall();
            else updateHUDText(`... ${Math.ceil(State.timers.reset)} ...`);
        }

        if (State.inputFrozen) return;

        // Inputs P1
        const b1 = State.bodies.blob1;
        const v1 = b1.getLinearVelocity();
        let f1 = 0;
        if (State.keys.has('a')) f1 -= Config.MOVE_FORCE;
        if (State.keys.has('d')) f1 += Config.MOVE_FORCE;
        b1.applyForceToCenter(planck.Vec2(f1, 0), true);
        if (State.keys.has('w') && Math.abs(v1.y) < 0.1 && b1.getPosition().y < 2) {
            b1.applyLinearImpulse(planck.Vec2(0, Config.JUMP_IMPULSE), b1.getPosition(), true);
        }

        // P2 / AI
        const b2 = State.bodies.blob2;
        if (State.mode === '2P') {
            const v2 = b2.getLinearVelocity();
            let f2 = 0;
            if (State.keys.has('arrowleft')) f2 -= Config.MOVE_FORCE;
            if (State.keys.has('arrowright')) f2 += Config.MOVE_FORCE;
            b2.applyForceToCenter(planck.Vec2(f2, 0), true);
            if (State.keys.has('arrowup') && Math.abs(v2.y) < 0.1 && b2.getPosition().y < 2) {
                b2.applyLinearImpulse(planck.Vec2(0, Config.JUMP_IMPULSE), b2.getPosition(), true);
            }
        } else {
            updateAI(dt);
        }

        // Cap Ball Speed
        const ball = State.bodies.ball;
        const bv = ball.getLinearVelocity();
        const maxSpeed = 20;
        if (bv.lengthSquared() > maxSpeed * maxSpeed) {
            bv.normalize();
            bv.mul(maxSpeed);
            ball.setLinearVelocity(bv);
        }
    }

    function updateAI(dt) {
        const ball = State.bodies.ball;
        const b2 = State.bodies.blob2;
        const ballPos = ball.getPosition();
        const b2Pos = b2.getPosition();

        // Simple AI logic
        let targetX = Config.COURT_W * 0.75; // Default home

        // If ball is on right side or coming towards right
        if (ballPos.x > Config.COURT_W / 2 - 2 || (ball.getLinearVelocity().x > 1)) {
            // Estimate landing
            targetX = ballPos.x;
            // Add error based on difficulty
            if (Math.abs(ballPos.x - b2Pos.x) > 2) {
                // Reaction delay simulated by only updating target occasionally
            }
        }

        // Clamp target
        targetX = Math.max(Config.COURT_W/2 + 1, Math.min(Config.COURT_W - 1, targetX));

        const diff = targetX - b2Pos.x;
        const speedScale = Config.AI_SPEED_FAC[State.difficulty];

        if (Math.abs(diff) > 0.2) {
            const dir = Math.sign(diff);
            b2.applyForceToCenter(planck.Vec2(dir * Config.MOVE_FORCE * speedScale, 0), true);
        }

        // Jump logic
        if (ballPos.x > Config.COURT_W/2 && ballPos.x < b2Pos.x + 1 && ballPos.x > b2Pos.x - 1 && ballPos.y < 3.5 && ballPos.y > b2Pos.y) {
                if (Math.abs(b2.getLinearVelocity().y) < 0.1) {
                b2.applyLinearImpulse(planck.Vec2(0, Config.JUMP_IMPULSE), b2.getPosition(), true);
                }
        }
    }

    function handleScore(winnerSide) {
        if (State.timers.scoreDebounce > 0) return;
        State.timers.scoreDebounce = 1.0;

        if (winnerSide === 'left') State.scores.left++;
        else State.scores.right++;

        State.servingSide = (winnerSide === 'left') ? 'right' : 'left'; // Loser serves (standard) or winner? Standard is winner serves in some vars, but let's toggle.
        
        updateScoreBoard();

        if (State.scores.left >= State.winScore || State.scores.right >= State.winScore) {
                if (Math.abs(State.scores.left - State.scores.right) >= 2) {
                    gameOver(winnerSide);
                    return;
                }
        }

        resetRally();
    }

    function resetRally() {
        State.rallyStarted = false;
        State.inputFrozen = true;
        State.timers.reset = 2; // 2 seconds delay before serve
        
        // Stop physics temporarily by setting velocities to 0
        State.bodies.ball.setLinearVelocity(planck.Vec2(0,0));
        State.bodies.ball.setAngularVelocity(0);
        // Move ball off screen or hold it
        State.bodies.ball.setPosition(planck.Vec2(Config.COURT_W/2, 10)); 
    }

    function spawnBall() {
        State.rallyStarted = true;
        State.inputFrozen = false;
        State.lastTouch = null;
        State.touchCount = 0;
        updateHUDText('');

        const serveX = State.servingSide === 'left' ? Config.COURT_W * 0.25 : Config.COURT_W * 0.75;
        const dir = State.servingSide === 'left' ? 1 : -1;

        // Reset Blobs
        State.bodies.blob1.setPosition(planck.Vec2(Config.COURT_W * 0.25, Config.BLOB_R));
        State.bodies.blob1.setLinearVelocity(planck.Vec2(0,0));
        State.bodies.blob2.setPosition(planck.Vec2(Config.COURT_W * 0.75, Config.BLOB_R));
        State.bodies.blob2.setLinearVelocity(planck.Vec2(0,0));

        // Serve Ball
        State.bodies.ball.setPosition(planck.Vec2(serveX, 4));
        State.bodies.ball.setLinearVelocity(planck.Vec2(0,0));
        State.bodies.ball.setAngularVelocity(0);
        
        // Toss
        setTimeout(() => {
            if(!State.isPaused && State.rallyStarted)
                State.bodies.ball.applyLinearImpulse(planck.Vec2(dir * 2, 4), State.bodies.ball.getPosition(), true);
        }, 100);
    }

    function gameOver(winner) {
        State.isPaused = true;
        State.rallyStarted = false;
        const pName = winner === 'left' ? "LEFT" : "RIGHT";
        updateHUDText(`${pName} WINS!`);
        document.getElementById('action-btn').textContent = "New Match";
        document.getElementById('panel').classList.remove('hidden');
    }

    // --- VISUAL UPDATES ---
    function updateVisuals(dt) {
        // Sync positions
        syncMesh(State.meshes.blob1, State.bodies.blob1);
        syncMesh(State.meshes.blob2, State.bodies.blob2);
        syncMesh(State.meshes.ball, State.bodies.ball);

        // Squash & Stretch Logic (The "Jelly" effect)
        applySquash(State.meshes.blob1, State.bodies.blob1);
        applySquash(State.meshes.blob2, State.bodies.blob2);

        // Particles
        for (let i = State.particles.length - 1; i >= 0; i--) {
            const p = State.particles[i];
            p.mesh.position.add(p.vel);
            p.life -= dt * 2;
            p.mesh.scale.setScalar(p.life * 0.2);
            if (p.life <= 0) {
                State.scene.remove(p.mesh);
                State.particles.splice(i, 1);
            }
        }
    }

    function syncMesh(mesh, body) {
        const pos = body.getPosition();
        mesh.position.x = pos.x;
        mesh.position.y = pos.y;
        mesh.rotation.z = body.getAngle();
    }

    function applySquash(mesh, body) {
        const vel = body.getLinearVelocity();
        // Stretch based on Y velocity
        const stretch = Math.min(Math.abs(vel.y) * 0.05, 0.4); 
        const scaleY = 1 + stretch;
        const scaleX = 1 - (stretch * 0.5); // Volume conservation
        
        // Smooth transition
        mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, scaleY, 0.2);
        mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, scaleX, 0.2);
        mesh.scale.z = mesh.scale.x;
    }

    function spawnParticles(pos, color) {
        const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const mat = new THREE.MeshBasicMaterial({ color: color });
        for(let i=0; i<8; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(new THREE.Vector3(pos.x, pos.y, 0));
            
            // Random explosion velocity
            const theta = Math.random() * Math.PI * 2;
            const speed = Math.random() * 0.2;
            const vel = new THREE.Vector3(Math.cos(theta)*speed, Math.sin(theta)*speed, (Math.random()-0.5)*0.2);
            
            State.scene.add(mesh);
            State.particles.push({ mesh, vel, life: 1.0 });
        }
    }

    // --- UI & INPUTS ---
    function updateHUDText(msg) { document.getElementById('message').textContent = msg; }
    function updateScoreBoard() {
        document.getElementById('score').textContent = `L ${State.scores.left} - ${State.scores.right} R`;
        const ind = document.getElementById('server-indicator');
        ind.textContent = State.rallyStarted ? "" : (State.servingSide === 'left' ? "< Serve" : "Serve >");
    }

    function setupInputs() {
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            State.keys.add(k);
            if (k === 'p') togglePause();
        });
        window.addEventListener('keyup', (e) => State.keys.delete(e.key.toLowerCase()));
    }

    function togglePause() {
        const btn = document.getElementById('action-btn');
        if (btn.textContent === "Start Game" || btn.textContent === "New Match") return;
        
        State.isPaused = !State.isPaused;
        document.getElementById('panel').classList.toggle('hidden', !State.isPaused);
        btn.textContent = State.isPaused ? "Resume" : "Pause";
    }

    function setupUI() {
        const els = {
            mode: document.getElementsByName('mode'),
            diff: document.getElementsByName('difficulty'),
            grav: document.getElementById('gravity-slider'),
            bounce: document.getElementById('bounce-slider'),
            preset: document.getElementById('physics-preset'),
            theme: document.getElementById('theme-btn'),
            action: document.getElementById('action-btn'),
            settings: document.getElementById('settings-btn')
        };

        els.mode.forEach(r => r.addEventListener('change', e => State.mode = e.target.value));
        els.diff.forEach(r => r.addEventListener('change', e => State.difficulty = e.target.value));
        
        // Physics Sliders
        const updatePhys = () => {
            Config.GRAVITY = -parseFloat(els.grav.value);
            Config.BALL_REST = parseFloat(els.bounce.value);
            document.getElementById('gravity-value').textContent = Math.abs(Config.GRAVITY).toFixed(1);
            document.getElementById('bounce-value').textContent = Config.BALL_REST.toFixed(2);
            
            if (State.world) State.world.setGravity(planck.Vec2(0, Config.GRAVITY));
            if (State.bodies.ball) State.bodies.ball.getFixtureList().setRestitution(Config.BALL_REST);
            
            els.preset.value = "Custom";
        };
        els.grav.addEventListener('input', updatePhys);
        els.bounce.addEventListener('input', updatePhys);

        els.preset.addEventListener('change', (e) => {
            if(e.target.value === "Default") {
                els.grav.value = 18; els.bounce.value = 0.85;
            } else if (e.target.value === "Floaty") {
                els.grav.value = 10; els.bounce.value = 0.95;
            } else if (e.target.value === "Fast") {
                els.grav.value = 25; els.bounce.value = 0.70;
            }
            if(e.target.value !== "Custom") updatePhys();
        });

        els.theme.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            const isDark = document.body.classList.contains('dark');
            State.scene.background = new THREE.Color(isDark ? Config.COLOR_BG_DARK : Config.COLOR_BG_LIGHT);
            State.scene.fog.color.set(isDark ? Config.COLOR_BG_DARK : Config.COLOR_BG_LIGHT);
        });

        els.action.addEventListener('click', () => {
            if (els.action.textContent === "Resume") togglePause();
            else startMatch();
        });

        els.settings.addEventListener('click', togglePause);
    }

    function startMatch() {
        State.scores = { left: 0, right: 0 };
        updateScoreBoard();
        document.getElementById('panel').classList.add('hidden');
        document.getElementById('action-btn').textContent = "Resume";
        State.isPaused = false;
        State.timers.scoreDebounce = 0;
        State.servingSide = Math.random() < 0.5 ? 'left' : 'right';
        resetRally();
    }

})();
