"use strict";

// ============================================================
// CONFIGURATION
// ============================================================
const W = 480, H = 640;
const PLAYER_SPEED = 4.5;
const PLAYER_FIRE_COOLDOWN = 10;
const BULLET_SPEED = 7;
const ENEMY_BULLET_SPEED = 2.8;
const FORMATION_COLS = 8;
const FORMATION_ROWS = 5;
const FORMATION_LEFT = 64;
const FORMATION_TOP = 55;
const CELL_W = 46, CELL_H = 38;
const EXTRA_LIFE_SCORE = 20000;
const TOTAL_STAGES = 32;

// ============================================================
// FIREBASE CONFIG & INIT
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA2ZfaCfbkVNR76ypT6QOvgJx_CXk4CzN0",
  authDomain: "galagadb-24cdc.firebaseapp.com",
  projectId: "galagadb-24cdc",
  storageBucket: "galagadb-24cdc.firebasestorage.app",
  messagingSenderId: "957856071752",
  appId: "1:957856071752:web:f35063a0ab83631e8f987d",
  measurementId: "G-CEQQ3GS6DQ"
};

let db = null;
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
}

class LeaderboardManager {
  constructor() {
    this.scores = [];
    this.loadLocalScores();
  }
  loadLocalScores() {
    try {
      const local = localStorage.getItem('galaga_top10');
      if (local) this.scores = JSON.parse(local);
    } catch(e) {}
  }
  saveLocalScores() {
    try {
      localStorage.setItem('galaga_top10', JSON.stringify(this.scores));
    } catch(e) {}
  }
  async fetchTop10() {
    this.loadLocalScores();
    if (!db) return this.scores;
    try {
      const fetchPromise = db.collection('leaderboard')
        .orderBy('score', 'desc')
        .limit(10)
        .get();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
      const snapshot = await Promise.race([fetchPromise, timeoutPromise]);
      const remoteScores = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d && d.name && typeof d.score === 'number') {
          remoteScores.push({ name: String(d.name).toUpperCase(), score: Number(d.score) });
        }
      });
      if (remoteScores.length > 0) {
        const combined = [...this.scores, ...remoteScores];
        combined.sort((a, b) => b.score - a.score);
        const unique = [];
        const seen = new Set();
        for (const item of combined) {
          const key = `${item.name}_${item.score}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
          }
        }
        this.scores = unique.slice(0, 10);
        this.saveLocalScores();
      }
    } catch(e) {
      console.warn('Firebase fetch error (using local fallback):', e);
    }
    return this.scores;
  }
  async saveScore(name, score) {
    if (!name || score <= 0) return;
    const cleanName = String(name).toUpperCase().substring(0, 3);
    const scoreNum = Number(score);

    this.scores.push({ name: cleanName, score: scoreNum });
    this.scores.sort((a, b) => b.score - a.score);
    this.scores = this.scores.slice(0, 10);
    this.saveLocalScores();

    if (!db) return;
    try {
      const savePromise = db.collection('leaderboard').add({
        name: cleanName,
        score: scoreNum,
        createdAt: new Date().toISOString()
      });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
      await Promise.race([savePromise, timeoutPromise]);
      console.log("Score successfully saved to Firebase!");
    } catch(e) {
      console.warn('Firebase save error (saved locally):', e);
    }
  }
  qualifiesForTop10(score) {
    if (score <= 0) return false;
    if (this.scores.length < 10) return true;
    return score > this.scores[this.scores.length - 1].score;
  }
}

// ============================================================
// AUDIO (Web Audio API)
// ============================================================
class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
      this.enabled = false;
    }
  }
  _play(freq, dur, type, vol) {
    if (!this.enabled || !this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (dur || 0.1));
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + (dur || 0.1));
    } catch(e) {}
  }
  shoot() { this._play(800, 0.06, 'square', 0.08); }
  hit() { this._play(200, 0.15, 'sawtooth', 0.1); }
  explode() { this._play(100, 0.3, 'sawtooth', 0.15); this._play(60, 0.4, 'square', 0.1); }
  enemyShoot() { this._play(400, 0.08, 'square', 0.06); }
  capture() { this._play(150, 0.5, 'sine', 0.12); this._play(120, 0.6, 'sine', 0.08); }
  rescue() { this._play(600, 0.1, 'square', 0.1); this._play(900, 0.15, 'square', 0.1); this._play(1200, 0.2, 'square', 0.08); }
  powerup() { this._play(500, 0.08, 'sine', 0.1); this._play(700, 0.08, 'sine', 0.1); this._play(900, 0.12, 'sine', 0.1); }
  bonus() { this._play(440, 0.08, 'square', 0.08); this._play(554, 0.08, 'square', 0.08); this._play(659, 0.08, 'square', 0.08); this._play(880, 0.12, 'square', 0.1); }
  stageStart() {
    if (!this.enabled || !this.ctx) return;
    const notes = [262,330,392,523];
    notes.forEach((n,i)=>{
      setTimeout(()=>{ this._play(n,0.15,'square',0.1); }, i*120);
    });
  }
  gameOver() {
    if (!this.enabled || !this.ctx) return;
    [300,250,200,150].forEach((n,i)=>{
      setTimeout(()=>{ this._play(n,0.25,'sawtooth',0.1); }, i*200);
    });
  }
}

// ============================================================
// UTILITY
// ============================================================
function lerp(a,b,t){ return a+(b-a)*t; }
function rand(min,max){ return Math.random()*(max-min)+min; }
function randInt(min,max){ return Math.floor(rand(min,max+1)); }

// ============================================================
// VECTOR SHAPES
// ============================================================
function drawPlayerShip(ctx, x, y, s, captured) {
  const sc = s||1;
  ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
  if (captured) ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(0,-14);
  ctx.lineTo(10,6);
  ctx.lineTo(6,10);
  ctx.lineTo(0,4);
  ctx.lineTo(-6,10);
  ctx.lineTo(-10,6);
  ctx.closePath();
  ctx.fillStyle = captured ? '#ff4444' : '#00ffff';
  ctx.fill();
  ctx.strokeStyle = captured ? '#ff0000' : '#00cccc';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-3,3,6,6);
  ctx.fillStyle = '#004444';
  ctx.fill();
  ctx.restore();
}

function drawDualShip(ctx, x, y, s) {
  const sc = s||1;
  ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
  // Left Fighter
  drawPlayerShip(ctx, -10, 0, 0.8, false);
  // Right Fighter
  drawPlayerShip(ctx, 10, 0, 0.8, false);
  // Connecting beam
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(-6, 2, 12, 3);
  ctx.restore();
}

function drawEnemyShip(ctx, x, y, type, s, flash, pulse) {
  const sc = s||1;
  const p = pulse || 0;
  const flap = Math.sin(p * 5) * 3;
  ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
  const c = flash ? '#ffffff' : (type==='bee'?'#ff00ff':type==='butterfly'?'#ff8800':'#ff4444');
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 1.5;
  if (type === 'bee') {
    ctx.beginPath();
    ctx.ellipse(0,0,8,6,0,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillRect(-3,-5,6,3);
    ctx.fillRect(-3,2,6,3);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-4-flap,-6); ctx.lineTo(0,-10); ctx.lineTo(4+flap,-6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-6-flap,5); ctx.lineTo(0,12); ctx.lineTo(6+flap,5);
    ctx.fill();
  } else if (type === 'butterfly') {
    ctx.beginPath();
    ctx.ellipse(0,0,5,7,0,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-8-flap/2,0,6+flap/3,4,0,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(8+flap/2,0,6+flap/3,4,0,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillRect(-8,-2,4,4);
    ctx.fillRect(4,-2,4,4);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0,-7); ctx.lineTo(2,-12); ctx.lineTo(-2,-12);
    ctx.closePath(); ctx.fill();
  } else {
    // Boss
    ctx.beginPath();
    ctx.moveTo(0,-14);
    ctx.lineTo(10+flap/2,0);
    ctx.lineTo(6,4);
    ctx.lineTo(2,0);
    ctx.lineTo(0,6);
    ctx.lineTo(-2,0);
    ctx.lineTo(-6,4);
    ctx.lineTo(-10-flap/2,0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(-2,-12,4,8);
    ctx.strokeStyle = c;
    ctx.strokeRect(-2,-12,4,8);
    ctx.fillStyle = '#000';
    ctx.fillRect(-3,-2,6,4);
  }
  ctx.restore();
}

function drawLifeIcon(ctx, x, y, s) {
  const sc = s||0.6;
  ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
  ctx.beginPath();
  ctx.moveTo(0,-12);
  ctx.lineTo(8,4);
  ctx.lineTo(5,7);
  ctx.lineTo(0,2);
  ctx.lineTo(-5,7);
  ctx.lineTo(-8,4);
  ctx.closePath();
  ctx.fillStyle = '#00ffff';
  ctx.fill();
  ctx.restore();
}

// ============================================================
// STARFIELD
// ============================================================
class StarField {
  constructor() {
    this.stars = [];
    for (let i=0;i<80;i++) {
      this.stars.push({
        x: rand(0,W), y: rand(0,H),
        size: rand(0.5,2.5),
        speed: rand(0.3,1.2),
        alpha: rand(0.3,1),
        twinkleSpeed: rand(0.01,0.04)
      });
    }
  }
  update() {
    for (const s of this.stars) {
      s.y += s.speed;
      if (s.y > H) { s.y = -2; s.x = rand(0,W); }
      s.alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(Date.now() * s.twinkleSpeed));
    }
  }
  draw(ctx) {
    for (const s of this.stars) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// PARTICLES
// ============================================================
class Particle {
  constructor(x,y,color,vx,vy,life,size) {
    this.x=x;this.y=y;this.color=color;
    this.vx=vx||0;this.vy=vy||0;
    this.life=life||30;this.maxLife=this.life;
    this.size=size||2;
  }
  update() {
    this.x+=this.vx;this.y+=this.vy;
    this.vx*=0.98;this.vy*=0.98;
    this.life--;
  }
  draw(ctx) {
    const a = Math.max(0, this.life/this.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x-this.size/2,this.y-this.size/2,this.size,this.size);
    ctx.globalAlpha = 1;
  }
  get dead() { return this.life<=0; }
}

class ParticleSystem {
  constructor() { this.particles=[]; }
  emit(x,y,count,colors,spread,life) {
    const c = colors||['#ff00ff','#00ffff','#ffff00','#ffffff'];
    for (let i=0;i<count;i++) {
      const a = rand(0,Math.PI*2);
      const sp = rand(1,spread||4);
      this.particles.push(new Particle(
        x+rand(-4,4),y+rand(-4,4),
        c[randInt(0,c.length-1)],
        Math.cos(a)*sp,Math.sin(a)*sp,
        life||randInt(15,40),rand(1,3)
      ));
    }
  }
  update() {
    for (const p of this.particles) p.update();
    this.particles = this.particles.filter(p=>!p.dead);
  }
  draw(ctx) {
    for (const p of this.particles) p.draw(ctx);
  }
}

// ============================================================
// BULLET CLASS
// ============================================================
class Bullet {
  constructor(x,y,vy,isEnemy) {
    this.x=x;this.y=y;this.vy=vy;
    this.w=isEnemy?3:3;this.h=isEnemy?8:10;
    this.isEnemy=!!isEnemy;
    this.alive=true;
  }
  update() {
    this.y+=this.vy;
    if (this.y<-20||this.y>H+20) this.alive=false;
  }
  draw(ctx) {
    if (!this.alive) return;
    if (this.isEnemy) {
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 6;
      ctx.fillRect(this.x-this.w/2,this.y-this.h/2,this.w,this.h);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#00ffcc';
      ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 8;
      ctx.fillRect(this.x-this.w/2,this.y-this.h/2,this.w,this.h);
      ctx.shadowBlur = 0;
    }
  }
}

// ============================================================
// PLAYER
// ============================================================
class Player {
  constructor() {
    this.x=W/2;this.y=H-50;
    this.w=22;this.h=24;
    this.alive=true;
    this.dual=false;
    this.respawnTimer=0;
    this.fireCooldown=0;
    this.captured=false;
    this.beingPulled=0;
    this.invincible=0;
  }
  reset() {
    this.x=W/2;this.y=H-50;
    this.alive=true;
    this.respawnTimer=0;this.fireCooldown=0;
    this.captured=false;this.beingPulled=0;this.invincible=90;
  }
  update(left,right) {
    if (this.captured) return;
    if (!this.alive) {
      this.respawnTimer--;
      if (this.respawnTimer<=0) {
        this.alive=true;this.x=W/2;this.invincible=90;
      }
      return;
    }
    if (this.invincible>0) this.invincible--;
    if (this.beingPulled>0) {
      this.beingPulled--;
    } else {
      const margin = this.dual ? 24 : 15;
      if (left) this.x-=PLAYER_SPEED;
      if (right) this.x+=PLAYER_SPEED;
      this.x = Math.max(margin,Math.min(W-margin,this.x));
    }
    if (this.fireCooldown>0) this.fireCooldown--;
  }
  canFire(activeBulletCount) {
    const maxBullets = this.dual ? 4 : 2;
    return this.alive && !this.captured && this.beingPulled === 0 && this.fireCooldown<=0 && activeBulletCount < maxBullets;
  }
  fire() {
    this.fireCooldown = PLAYER_FIRE_COOLDOWN;
    const bullets = [];
    if (this.dual) {
      bullets.push(new Bullet(this.x-10,this.y-18,-BULLET_SPEED,false));
      bullets.push(new Bullet(this.x+10,this.y-18,-BULLET_SPEED,false));
    } else {
      bullets.push(new Bullet(this.x,this.y-18,-BULLET_SPEED,false));
    }
    return bullets;
  }
  getBounds() {
    const width = this.dual ? 36 : this.w;
    return {x:this.x-width/2,y:this.y-this.h/2,w:width,h:this.h};
  }
  draw(ctx) {
    if (!this.alive) return;
    if (this.invincible>0 && Math.floor(this.invincible/4)%2===0) return;
    if (this.dual) drawDualShip(ctx,this.x,this.y,1);
    else drawPlayerShip(ctx,this.x,this.y,1,this.captured||this.beingPulled>0);
  }
}

// ============================================================
// ENEMY
// ============================================================
class Enemy {
  constructor(type,row,col,targetX,targetY,bossHp=2) {
    this.type=type; // 'bee','butterfly','boss'
    this.row=row;this.col=col;
    this.targetX=targetX;this.targetY=targetY;
    this.w=type==='boss'?28:type==='butterfly'?22:18;
    this.h=type==='boss'?28:type==='butterfly'?18:16;
    this.hp=type==='boss'?bossHp:1;
    this.maxHp=this.hp;
    this.points=type==='boss'?200:type==='butterfly'?80:50;
    this.alive=true;
    this.inFormation=false;
    this.entering=true;
    this.diving=false;
    this.diveTimer=0;
    this.flashTimer=0;
    this.tractorBeaming=false;
    this.tractorBeamTimer=0;
    this.capturedShip=false;
    this.vx=0;this.vy=0;
    this.entryPath=null;
    this.entryProgress=0;
    this.entryDuration=60;
    this.x=targetX;this.y=-30;
    this.shootCooldown=randInt(30,90);
    this.pulse=rand(0,Math.PI*2);
  }
  startDive(attackPattern, speedMult = 1) {
    if (!this.alive||!this.inFormation||this.diving||this.tractorBeaming) return;
    this.diving=true;
    this.inFormation=false;
    this.diveTimer=0;
    this.entryProgress=0;
    this.attackPattern=attackPattern||0;
    this.diveStartX=this.x;
    this.diveStartY=this.y;
    this.entryDuration=randInt(120,180) / speedMult;
    this.entryPath=this._generateDivePath();
  }
  _generateDivePath() {
    const sx=this.x,sy=this.y;
    const side = Math.random() > 0.5 ? 1 : -1;
    const cx1=sx + side * rand(60,160), cy1=sy + rand(100,200);
    const cx2=W/2 - side * rand(40,120), cy2=rand(300,450);
    const ex=sx + side * rand(-30,30), ey=H + 40;
    return {sx,sy,cx1,cy1,cx2,cy2,ex,ey};
  }
  _bezier(t) {
    const p=this.entryPath;
    if (!p) return {x:this.x,y:this.y};
    const mt=1-t;
    const x = mt*mt*mt*p.sx + 3*mt*mt*t*p.cx1 + 3*mt*t*t*p.cx2 + t*t*t*p.ex;
    const y = mt*mt*mt*p.sy + 3*mt*mt*t*p.cy1 + 3*mt*t*t*p.cy2 + t*t*t*p.ey;
    return {x,y};
  }
  update(formationOffsetX, speedMult = 1, cooldownMult = 1) {
    if (!this.alive) return null;
    this.pulse+=0.05;
    if (this.flashTimer>0) this.flashTimer--;
    if (this.shootCooldown>0) this.shootCooldown--;

    if (this.entering) {
      this.entryProgress+=0.02 * speedMult;
      if (this.entryProgress>=1) {
        this.entryProgress=1;
        this.entering=false;
        this.inFormation=true;
        this.x=this.targetX + (formationOffsetX || 0);
        this.y=this.targetY;
      } else {
        this.y = lerp(-30,this.targetY,this.entryProgress*this.entryProgress*(3-2*this.entryProgress));
        this.x = (this.targetX + (formationOffsetX || 0)) + Math.sin(this.entryProgress*Math.PI*4)*30*(1-this.entryProgress);
      }
      return null;
    }

    if (this.tractorBeaming) {
      this.tractorBeamTimer--;
      if (this.tractorBeamTimer <= 0) {
        this.tractorBeaming = false;
      }
      return null;
    }

    if (this.diving) {
      this.diveTimer++;
      const progress = this.diveTimer/this.entryDuration;
      if (progress>=1 || this.y > H + 20) {
        this.diving=false;
        this.entering=true;
        this.entryProgress=0;
        this.y=-30;
        this.shootCooldown=randInt(40,100) * cooldownMult;
        return null;
      }
      const p = this._bezier(Math.min(progress,1));
      this.x=p.x; this.y=p.y;

      let shoot = false;
      if (progress>0.25 && progress<0.75 && this.shootCooldown<=0) {
        this.shootCooldown=randInt(40,90) * cooldownMult;
        shoot = true;
      }
      return shoot ? {shoot:true,x:this.x,y:this.y+this.h/2} : null;
    }

    if (this.inFormation) {
      const curTargetX = this.targetX + (formationOffsetX || 0);
      this.x += (curTargetX - this.x) * 0.1;
      this.y += (this.targetY - this.y) * 0.1;

      if (cooldownMult < 0.8 && this.shootCooldown <= 0 && Math.random() < 0.005) {
        this.shootCooldown = randInt(100, 200) * cooldownMult;
        return { shoot: true, x: this.x, y: this.y + this.h / 2 };
      }
    }
    return null;
  }
  getBounds() {
    return {x:this.x-this.w/2,y:this.y-this.h/2,w:this.w,h:this.h};
  }
  draw(ctx) {
    if (!this.alive) return;
    const flash = this.flashTimer>0;
    const s = this.type==='boss'?1.3:1;
    drawEnemyShip(ctx,this.x,this.y,this.type,s,flash,this.pulse);
    if (this.capturedShip) {
      drawPlayerShip(ctx, this.x, this.y - 18, 0.7, true);
    }
  }
}

// ============================================================
// TRACTOR BEAM
// ============================================================
class TractorBeam {
  constructor() {
    this.active=false;
    this.boss=null;
    this.capturedPlayer=null;
    this.pullProgress=0;
    this.glow=0;
  }
  start(boss,player) {
    if (this.active) return;
    this.active=true;
    this.boss=boss;
    this.capturedPlayer=player;
    this.pullProgress=0;
    this.glow=0;
  }
  stop() {
    this.active=false;
    this.boss=null;
    this.capturedPlayer=null;
  }
  update(game) {
    if (!this.active) return;
    this.glow+=0.08;

    if (!this.boss || !this.boss.alive || !this.boss.tractorBeaming) {
      if (this.capturedPlayer && !this.capturedPlayer.captured) {
        this.capturedPlayer.beingPulled=0;
      }
      this.stop();
      return;
    }

    if (this.capturedPlayer) {
      if (!this.capturedPlayer.alive || this.capturedPlayer.captured) {
        this.stop();
        return;
      }

      // Check collision with beam cone
      const bx = this.boss.x;
      const by = this.boss.y + 14;
      const beamTopW = 24;
      const beamBotW = 140;
      const progressToBottom = Math.max(0, Math.min(1, (this.capturedPlayer.y - by) / (H - by)));
      const beamWidthAtPlayer = lerp(beamTopW, beamBotW, progressToBottom);

      const inBeam = Math.abs(this.capturedPlayer.x - bx) < beamWidthAtPlayer / 2;

      if (inBeam || this.capturedPlayer.beingPulled > 0) {
        this.capturedPlayer.beingPulled = 10;
        this.capturedPlayer.x = lerp(this.capturedPlayer.x, bx, 0.06);
        this.capturedPlayer.y = lerp(this.capturedPlayer.y, by + 24, 0.05);

        if (this.capturedPlayer.y <= by + 30) {
          this.capturedPlayer.captured = true;
          this.capturedPlayer.beingPulled = 0;
          this.boss.capturedShip = true;
          this.boss.tractorBeaming = false;
          this.stop();

          // Handle player capture
          game.playerCapturedByBoss();
        }
      }
    }
  }
  draw(ctx) {
    if (!this.active || !this.boss || !this.boss.alive) return;
    const bx=this.boss.x, by=this.boss.y+14;
    const topW = 24;
    const botW = 140 + Math.sin(this.glow * 2) * 10;
    const gradient = ctx.createLinearGradient(bx, by, bx, H);
    gradient.addColorStop(0, `rgba(0, 255, 255, ${0.5 + 0.2*Math.sin(this.glow)})`);
    gradient.addColorStop(0.4, `rgba(0, 150, 255, ${0.3 + 0.1*Math.sin(this.glow*1.3)})`);
    gradient.addColorStop(1, 'rgba(0, 100, 255, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(bx - topW/2, by);
    ctx.lineTo(bx + topW/2, by);
    ctx.lineTo(bx + botW/2, H);
    ctx.lineTo(bx - botW/2, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(0, 255, 255, ${0.4 + 0.2*Math.sin(this.glow*1.5)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ============================================================
// GAME
// ============================================================
class Game {
  constructor(canvas) {
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.audio=new AudioManager();
    this.canvas.width=W;this.canvas.height=H;
    this.state='TITLE';
    this.score=0;
    this.highScore=parseInt(localStorage.getItem('galaga_high')||'0') || 0;
    this.lives=2;
    this.stage=0;
    this.extraLifeTriggered=0;
    this.flashMessage='';
    this.flashTimer=0;
    this.player=new Player();
    this.stars=new StarField();
    this.particles=new ParticleSystem();
    this.tractorBeam=new TractorBeam();
    this.enemies=[];
    this.playerBullets=[];
    this.enemyBullets=[];
    this.formationOffsetX=0;
    this.maxSimultaneousDives=1;
    this.stageIntroTimer=0;
    this.bonusActive=false;
    this.bonusEnemies=[];
    this.bonusTimer=0;
    this.bonusScore=0;
    this.leftPressed=false;
    this.rightPressed=false;
    this.upPressed=false;
    this.downPressed=false;
    this.firePressed=false;
    this.enterPressed=false;
    this.paused=false;
    this.gameTime=0;
    this.waveComplete=false;
    this.transitionTimer=0;
    this.difficulty=1;
    this.leaderboard = new LeaderboardManager();
    this.fetchingLeaderboard = false;
    this.nameChars = ['A','A','A'];
    this.nameIndex = 0;
    this.setupInput();
    this.setupTouchControls();
    this.startTitle();
  }
  getStageSpeedMult() {
    const st = Math.min(Math.max(1, this.stage), TOTAL_STAGES);
    return 1.0 + (st - 1) * 0.04;
  }
  getStageCooldownMult() {
    const st = Math.min(Math.max(1, this.stage), TOTAL_STAGES);
    return Math.max(0.35, 1.0 - (st - 1) * 0.021);
  }
  getStageMaxDives() {
    const st = Math.min(Math.max(1, this.stage), TOTAL_STAGES);
    return Math.min(8, 1 + Math.floor((st - 1) * 7 / 31));
  }
  getStageBossHp() {
    const st = Math.min(Math.max(1, this.stage), TOTAL_STAGES);
    if (st >= 25) return 4;
    if (st >= 13) return 3;
    return 2;
  }
  getSpeedMult() {
    const base = this.difficulty === 0 ? 0.75 : this.difficulty === 1 ? 1 : 1.3;
    return base * this.getStageSpeedMult();
  }
  getCooldownMult() {
    const base = this.difficulty === 0 ? 1.5 : this.difficulty === 1 ? 1 : 0.7;
    return base * this.getStageCooldownMult();
  }
  startTitle() {
    this.state='TITLE';
    this.audio.init();
    this.refreshHighScore();
  }
  async refreshHighScore() {
    try {
      await this.leaderboard.fetchTop10();
      if (this.leaderboard.scores && this.leaderboard.scores.length > 0) {
        const topScore = Math.max(...this.leaderboard.scores.map(s => s.score || 0));
        if (topScore > this.highScore) {
          this.highScore = topScore;
          localStorage.setItem('galaga_high', String(this.highScore));
        }
      }
    } catch(e) {}
  }
  startGame() {
    this.score=0;
    this.lives=2;
    this.extraLifeTriggered=0;
    this.stage=0;
    this.completedLevels=0;
    this.player=new Player();
    this.enemies=[];
    this.playerBullets=[];
    this.enemyBullets=[];
    this.bonusActive=false;
    this.paused=false;
    this.gameTime=0;
    this.waveComplete=false;
    this.refreshHighScore();
    this.startNextStage();
  }
  addScore(pts) {
    this.score += pts;
    while (this.score - this.extraLifeTriggered >= EXTRA_LIFE_SCORE) {
      this.lives++;
      this.extraLifeTriggered += EXTRA_LIFE_SCORE;
      this.audio.powerup();
      this.flashMessage = 'EXTRA SHIP!';
      this.flashTimer = 90;
    }
  }
  startNextStage() {
    this.stage++;
    if (this.stage > TOTAL_STAGES) {
      this.gameVictory();
      return;
    }
    this.state='STAGE_INTRO';
    this.stageIntroTimer=120;
    this.playerBullets=[];
    this.enemyBullets=[];
    this.audio.stageStart();
  }
  gameVictory() {
    this.state = 'VICTORY';
    this.audio.powerup();
    const victoryBonus = 50000;
    this.score += victoryBonus;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('galaga_high', String(this.highScore));
    }
    this.flashMessage = 'ALL 32 STAGES CLEARED!';
    this.flashTimer = 180;
  }
  beginStage() {
    this.state='PLAYING';
    this.waveComplete=false;
    this.transitionTimer=0;
    this.enemies=[];
    this.playerBullets=[];
    this.enemyBullets=[];
    this.bonusActive=false;
    this.maxSimultaneousDives=this.getStageMaxDives();
    this.spawnFormation();
  }
  spawnFormation() {
    let idx=0;
    const bossHp = this.getStageBossHp();
    for (let r=0;r<FORMATION_ROWS;r++) {
      for (let c=0;c<FORMATION_COLS;c++) {
        let type='bee';
        if (r===0 && (c>=2 && c<=5)) type='boss';
        else if (r===1 || r===2) type='butterfly';

        const tx = FORMATION_LEFT+c*CELL_W;
        const ty = FORMATION_TOP+r*CELL_H;
        const e = new Enemy(type,r,c,tx,ty,bossHp);
        e.entryProgress=idx*0.01;
        if (e.entryProgress>1) e.entryProgress=rand(0.5,0.9);
        e.entryDuration=60+idx*2;
        if (e.entryDuration>180) e.entryDuration=180;
        this.enemies.push(e);
        idx++;
      }
    }
  }
  startBonusStage() {
    this.state='BONUS';
    this.bonusActive=true;
    this.bonusTimer=0;
    this.bonusScore=0;
    this.bonusEnemies=[];
    this.playerBullets=[];
    this.enemyBullets=[];
    const count = 20+this.stage*2;
    for (let i=0;i<count;i++) {
      const x = rand(30,W-30);
      const y = -20-i*18;
      const e = {
        x,y,alive:true,w:16,h:14,
        points:100,
        speedY:1.5+this.stage*0.1,
        speedX:Math.sin(i*0.5)*1.5,
        pulse:i*0.3
      };
      this.bonusEnemies.push(e);
    }
    this.audio.bonus();
  }
  checkWaveComplete() {
    if (this.waveComplete) return;
    const alive = this.enemies.filter(e=>e.alive);
    if (alive.length===0) {
      this.waveComplete=true;
      this.transitionTimer = 90;
      this.completedLevels++;

      if (this.completedLevels > 0 && this.completedLevels % 2 === 0) {
        if (typeof showMonetagAd === 'function') {
          showMonetagAd();
        }
      }
    }
  }
  playerCapturedByBoss() {
    this.audio.capture();
    this.lives--;
    if (this.lives >= 0) {
      this.player = new Player();
      this.player.invincible = 90;
      this.flashMessage = 'SHIP CAPTURED!';
      this.flashTimer = 90;
    } else {
      this.gameOver();
    }
  }
  respawnPlayer() {
    if (this.lives>0) {
      this.lives--;
      this.player.reset();
    } else {
      this.gameOver();
    }
  }
  handleEndGameTransition() {
    if (this.score > 0 && this.leaderboard.qualifiesForTop10(this.score)) {
      this.state = 'ENTER_NAME';
      this.nameChars = ['A', 'A', 'A'];
      this.nameIndex = 0;
    } else {
      this.state = 'LEADERBOARD';
    }
  }

  gameOver() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('galaga_high', String(this.highScore));
    }
    this.audio.gameOver();

    if (this.score > 0 && this.leaderboard.qualifiesForTop10(this.score)) {
      this.state = 'ENTER_NAME';
      this.nameChars = ['A', 'A', 'A'];
      this.nameIndex = 0;
    } else {
      this.state = 'GAME_OVER';
    }

    this.refreshHighScore().catch(() => {});
  }

  changeLetter(dir) {
    let code = this.nameChars[this.nameIndex].charCodeAt(0);
    code += dir;
    if (code < 65) code = 90;
    if (code > 90) code = 65;
    this.nameChars[this.nameIndex] = String.fromCharCode(code);
    this.audio.shoot();
  }

  async confirmLetter() {
    this.audio.powerup();
    this.nameIndex++;
    if (this.nameIndex >= 3) {
      this.state = 'SAVING_SCORE';
      const finalName = this.nameChars.join('');
      try {
        await this.leaderboard.saveScore(finalName, this.score);
        if (this.score > this.highScore) {
          this.highScore = this.score;
          localStorage.setItem('galaga_high', String(this.highScore));
        }
      } catch(e) {
        console.error("Error saving score:", e);
      } finally {
        this.state = 'LEADERBOARD';
      }
    }
  }
  playerHit() {
    if (this.player.invincible>0) return;
    this.audio.explode();

    if (this.player.dual) {
      // Lose dual fighter, keep playing with single fighter
      this.player.dual = false;
      this.player.invincible = 90;
      this.particles.emit(this.player.x, this.player.y, 25, ['#ffff00','#ffcc00','#ffffff'], 5, 30);
      this.flashMessage = 'DUAL FIGHTER LOST!';
      this.flashTimer = 60;
      return;
    }

    this.particles.emit(this.player.x,this.player.y,30,
      ['#00ffff','#00cccc','#ffffff'],5,30);
    this.respawnPlayer();
  }
  rescueShip() {
    this.audio.rescue();
    this.audio.powerup();
    this.player.dual=true;
    this.particles.emit(this.player.x,this.player.y,30,
      ['#ffff00','#00ffff','#ff00ff','#ffffff'],6,40);
    this.flashMessage='DUAL FIGHTER RESCUED!';
    this.flashTimer=90;
  }
  // ---- INPUT ----
  setupInput() {
    document.addEventListener('keydown',e=>{
      if (e.key==='ArrowUp'||e.key==='w'||e.key==='W') {
        if (!this.upPressed && this.state === 'ENTER_NAME') this.changeLetter(1);
        this.upPressed=true;
      }
      if (e.key==='ArrowDown'||e.key==='s'||e.key==='S') {
        if (!this.downPressed && this.state === 'ENTER_NAME') this.changeLetter(-1);
        this.downPressed=true;
      }
      if (e.key==='ArrowLeft'||e.key==='a'||e.key==='A') {
        if (!this.leftPressed && this.state === 'TITLE') this.difficulty = Math.max(0, this.difficulty - 1);
        if (!this.leftPressed && this.state === 'ENTER_NAME') this.changeLetter(-1);
        this.leftPressed=true;
      }
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') {
        if (!this.rightPressed && this.state === 'TITLE') this.difficulty = Math.min(2, this.difficulty + 1);
        if (!this.rightPressed && this.state === 'ENTER_NAME') this.changeLetter(1);
        this.rightPressed=true;
      }
      if (e.key===' '||e.key==='Space') { 
        e.preventDefault(); 
        if (!this.firePressed && this.state === 'ENTER_NAME') {
          this.confirmLetter();
        }
        this.firePressed=true; 
      }
      if (e.key==='p'||e.key==='P') {
        if (this.state==='PLAYING') this.paused=!this.paused;
      }
      if (e.key==='Enter') {
        e.preventDefault();
        if (!this.enterPressed) {
          if (this.state==='TITLE') { this.audio.init(); this.startGame(); }
          else if (this.state==='GAME_OVER') { this.state='LEADERBOARD'; }
          else if (this.state==='VICTORY') { this.handleEndGameTransition(); }
          else if (this.state==='LEADERBOARD') { this.startTitle(); }
          else if (this.state==='ENTER_NAME') { this.confirmLetter(); }
        }
        this.enterPressed=true;
      }
    });
    document.addEventListener('keyup',e=>{
      if (e.key==='ArrowUp'||e.key==='w'||e.key==='W') this.upPressed=false;
      if (e.key==='ArrowDown'||e.key==='s'||e.key==='S') this.downPressed=false;
      if (e.key==='ArrowLeft'||e.key==='a'||e.key==='A') this.leftPressed=false;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.rightPressed=false;
      if (e.key===' '||e.key==='Space') this.firePressed=false;
      if (e.key==='Enter') this.enterPressed=false;
    });
  }
  setupTouchControls() {
    const tc = document.getElementById('touch-controls');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints>0;
    if (isTouch) {
      tc.style.display='block';
    }
    const self=this;
    function addTouch(el,key) {
      el.addEventListener('touchstart',e=>{
        e.preventDefault(); e.stopPropagation();
        if (!self[key] && self.state === 'TITLE') {
          if (key === 'leftPressed') self.difficulty = Math.max(0, self.difficulty - 1);
          if (key === 'rightPressed') self.difficulty = Math.min(2, self.difficulty + 1);
        }
        if (!self[key] && self.state === 'ENTER_NAME') {
          if (key === 'leftPressed') self.changeLetter(-1);
          if (key === 'rightPressed') self.changeLetter(1);
          if (key === 'firePressed') self.confirmLetter();
        }
        self[key]=true;
      },false);
      el.addEventListener('touchend',e=>{e.preventDefault(); e.stopPropagation(); self[key]=false;},false);
      el.addEventListener('touchcancel',e=>{e.preventDefault(); e.stopPropagation(); self[key]=false;},false);
      el.addEventListener('mousedown',e=>{
        if (!self[key] && self.state === 'TITLE') {
          if (key === 'leftPressed') self.difficulty = Math.max(0, self.difficulty - 1);
          if (key === 'rightPressed') self.difficulty = Math.min(2, self.difficulty + 1);
        }
        if (!self[key] && self.state === 'ENTER_NAME') {
          if (key === 'leftPressed') self.changeLetter(-1);
          if (key === 'rightPressed') self.changeLetter(1);
          if (key === 'firePressed') self.confirmLetter();
        }
        self[key]=true; el.classList.add('active');
      },false);
      el.addEventListener('mouseup',e=>{self[key]=false;el.classList.remove('active');},false);
      el.addEventListener('mouseleave',e=>{self[key]=false;el.classList.remove('active');},false);
    }
    const tl=document.getElementById('tc-left');
    const tr=document.getElementById('tc-right');
    const tf=document.getElementById('tc-fire');
    addTouch(tl,'leftPressed');
    addTouch(tr,'rightPressed');
    addTouch(tf,'firePressed');

    const handleScreenTap=(e)=>{
      // Avoid screen tap if touching on control buttons
      if (e.target.closest && e.target.closest('#touch-controls')) return;
      this.audio.init();
      if (this.state==='TITLE') { e.preventDefault(); this.startGame(); }
      else if (this.state==='GAME_OVER') { e.preventDefault(); this.state='LEADERBOARD'; }
      else if (this.state==='VICTORY') { e.preventDefault(); this.handleEndGameTransition(); }
      else if (this.state==='LEADERBOARD') { e.preventDefault(); this.startTitle(); }
    };
    document.addEventListener('touchstart',handleScreenTap,false);
    document.addEventListener('click',handleScreenTap,false);
  }

  // ---- UPDATE ----
  update() {
    if (this.paused) return;
    this.gameTime++;
    this.stars.update();
    this.particles.update();

    if (this.score > this.highScore) {
      this.highScore = this.score;
    }

    if (this.state==='TITLE'||this.state==='GAME_OVER'||this.state==='VICTORY'||this.state==='LEADERBOARD'||this.state==='ENTER_NAME'||this.state==='SAVING_SCORE') return;

    if (this.state==='STAGE_INTRO') {
      this.stageIntroTimer--;
      if (this.stageIntroTimer<=0) this.beginStage();
      return;
    }
    if (this.state==='BONUS') {
      this.updateBonus();
      return;
    }

    // PLAYING state
    this.formationOffsetX = Math.sin(this.gameTime * 0.03) * 16;

    if (this.waveComplete) {
      this.transitionTimer--;
      if (this.transitionTimer <= 0) {
        if (this.stage % 3 === 0) this.startBonusStage();
        else this.startNextStage();
      }
    }

    // Player
    this.player.update(this.leftPressed,this.rightPressed);
    if (this.player.canFire(this.playerBullets.length) && this.firePressed) {
      const bullets = this.player.fire();
      this.playerBullets.push(...bullets);
      this.audio.shoot();
    }

    // Player bullets
    for (const b of this.playerBullets) b.update();
    this.playerBullets = this.playerBullets.filter(b=>b.alive);

    // Enemy bullets
    for (const b of this.enemyBullets) b.update();
    this.enemyBullets = this.enemyBullets.filter(b=>b.alive);

    // Enemies
    this.manageDiveQueue();
    for (const e of this.enemies) {
      const result = e.update(this.formationOffsetX, this.getSpeedMult(), this.getCooldownMult());
      if (result && result.shoot) {
        this.enemyBullets.push(new Bullet(result.x,result.y,ENEMY_BULLET_SPEED * this.getSpeedMult(),true));
        this.audio.enemyShoot();
      }
    }

    // Tractor beam
    this.tractorBeam.update(this);

    // Collisions: player bullets vs enemies
    for (const b of this.playerBullets) {
      if (!b.alive) continue;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const eb=e.getBounds();
        if (b.x >= eb.x && b.x <= eb.x + eb.w && b.y >= eb.y && b.y <= eb.y + eb.h) {
          b.alive=false;
          e.hp--;
          e.flashTimer=6;
          this.audio.hit();

          if (e.hp<=0) {
            e.alive=false;
            let pts = e.points;

            if (e.type==='boss' && e.capturedShip) {
              pts += 1000;
              this.rescueShip();
            }

            if (e.type==='boss') {
              this.particles.emit(e.x,e.y,40,['#ff4444','#ff8800','#ffff00','#ffffff'],6,40);
            } else {
              this.particles.emit(e.x,e.y,18,
                e.type==='butterfly'?['#ff8800','#ffcc00','#ffffff']:['#ff00ff','#ff88ff','#ffffff'],4,30);
            }
            this.addScore(pts);
            this.audio.explode();
          }
          break;
        }
      }
    }

    // Collisions: enemy bullets vs player
    if (this.player.alive && !this.player.captured) {
      for (const b of this.enemyBullets) {
        if (!b.alive) continue;
        const pb=this.player.getBounds();
        if (b.x >= pb.x && b.x <= pb.x+pb.w && b.y >= pb.y && b.y <= pb.y+pb.h) {
          b.alive=false;
          this.playerHit();
          break;
        }
      }
    }

    // Collisions: diving enemies vs player
    if (this.player.alive && !this.player.captured) {
      for (const e of this.enemies) {
        if (!e.alive || !e.diving) continue;
        const eb=e.getBounds();
        const pb=this.player.getBounds();
        if (eb.x < pb.x+pb.w && eb.x+eb.w > pb.x && eb.y < pb.y+pb.h && eb.y+eb.h > pb.y) {
          this.playerHit();
          e.alive=false;
          this.particles.emit(e.x,e.y,20,['#ff00ff','#ffffff'],4,25);
          break;
        }
      }
    }

    // Check wave complete
    this.checkWaveComplete();
    if (this.flashTimer>0) this.flashTimer--;
  }

  manageDiveQueue() {
    const candidateEnemies = this.enemies.filter(e => e.alive && e.inFormation && !e.diving && !e.entering && !e.tractorBeaming);
    const activeDiving = this.enemies.filter(e => e.diving || e.tractorBeaming);

    if (activeDiving.length >= this.maxSimultaneousDives || candidateEnemies.length === 0) return;

    if (this.gameTime % Math.floor(150 * this.getCooldownMult()) === 0) {
      const count = Math.min(
        this.maxSimultaneousDives - activeDiving.length,
        candidateEnemies.length
      );

      for (let i = 0; i < count; i++) {
        const idx = randInt(0, candidateEnemies.length - 1);
        const e = candidateEnemies[idx];
        if (!e) continue;

        e.startDive(0, this.getSpeedMult());

        // Check if Boss wants to activate Tractor Beam during dive
        if (e.type === 'boss' && !e.capturedShip && !this.tractorBeam.active && Math.random() < 0.6) {
          setTimeout(() => {
            if (e.alive && e.diving && !this.tractorBeam.active && this.player.alive) {
              e.tractorBeaming = true;
              e.tractorBeamTimer = 220;
              this.tractorBeam.start(e, this.player);
              this.audio.capture();
            }
          }, 800);
        }
      }
    }
  }

  updateBonus() {
    this.bonusTimer++;
    for (const e of this.bonusEnemies) {
      if (!e.alive) continue;
      e.y += e.speedY;
      e.x += Math.sin(this.bonusTimer*0.05 + e.pulse) * 1.5;
      if (e.y > H + 20) e.alive = false;
    }

    for (const b of this.playerBullets) b.update();
    this.playerBullets = this.playerBullets.filter(b=>b.alive);

    this.player.update(this.leftPressed,this.rightPressed);
    if (this.player.canFire(this.playerBullets.length) && this.firePressed) {
      const bullets = this.player.fire();
      this.playerBullets.push(...bullets);
      this.audio.shoot();
    }

    for (const b of this.playerBullets) {
      if (!b.alive) continue;
      for (const e of this.bonusEnemies) {
        if (!e.alive) continue;
        const eb = {x: e.x - e.w/2, y: e.y - e.h/2, w: e.w, h: e.h};
        if (b.x >= eb.x && b.x <= eb.x + eb.w && b.y >= eb.y && b.y <= eb.y + eb.h) {
          b.alive = false; e.alive = false;
          this.bonusScore += e.points;
          this.addScore(e.points);
          this.audio.hit();
          this.particles.emit(e.x,e.y,8,['#ff00ff','#ffff00','#00ffff'],3,15);
          break;
        }
      }
    }

    const alive = this.bonusEnemies.filter(e=>e.alive);
    if (alive.length===0 || this.bonusTimer>500) {
      this.particles.emit(W/2,H/2,30,['#ffff00','#00ffff','#ffffff'],6,40);
      this.startNextStage();
    }
  }

  // ---- RENDER ----
  render() {
    const ctx=this.ctx;
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    this.stars.draw(ctx);

    if (this.state==='TITLE') { this.renderTitle(ctx); return; }
    if (this.state==='GAME_OVER') { this.renderGameOver(ctx); return; }
    if (this.state==='VICTORY') { this.renderVictory(ctx); return; }

    // HUD
    this.renderHUD(ctx);

    if (this.state==='STAGE_INTRO') { this.renderStageIntro(ctx); return; }
    if (this.state==='BONUS') { this.renderBonus(ctx); return; }

    // PLAYING
    if (!this.paused) {
      for (const b of this.enemyBullets) b.draw(ctx);
      for (const b of this.playerBullets) b.draw(ctx);
      for (const e of this.enemies) e.draw(ctx);
      this.player.draw(ctx);
      this.tractorBeam.draw(ctx);
      this.particles.draw(ctx);
    }
    if (this.paused) {
      ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#ffffff';
      ctx.textAlign='center';
      ctx.font='24px "Press Start 2P",monospace';
      ctx.fillText('PAUSED',W/2,H/2);
    }
    if (this.flashTimer>0) {
      ctx.fillStyle='#ffff00';
      ctx.textAlign='center';
      ctx.font='14px "Press Start 2P",monospace';
      ctx.fillText(this.flashMessage||'',W/2,80);
    }
  }

  renderHUD(ctx) {
    ctx.fillStyle='#ffffff';
    ctx.textAlign='left';
    ctx.font='10px "Press Start 2P",monospace';
    ctx.fillText('SCORE',15,16);
    ctx.fillStyle='#00ffff';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText(String(this.score).padStart(7,'0'),15,34);

    ctx.fillStyle='#ff00ff';
    ctx.font='10px "Press Start 2P",monospace';
    ctx.textAlign='right';
    ctx.fillText('HIGH SCORE',W-15,16);
    ctx.fillStyle='#ffff00';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText(String(this.highScore).padStart(7,'0'),W-15,34);

    ctx.textAlign='left';
    ctx.fillStyle='#00ffff';
    for (let i=0;i<this.lives;i++) drawLifeIcon(ctx,20+i*22,56,0.55);

    ctx.fillStyle='#ffffff';
    ctx.font='9px "Press Start 2P",monospace';
    ctx.textAlign='right';
    ctx.fillText('STAGE '+this.stage+'/'+TOTAL_STAGES,W-15,60);
  }

  renderTitle(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ff00ff';
    ctx.font='48px "Press Start 2P",monospace';
    ctx.shadowColor='#ff00ff';ctx.shadowBlur=20;
    ctx.fillText('GALAXA',W/2,190);
    ctx.shadowBlur=0;

    ctx.fillStyle='#00ffff';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText('A SPACE ARCADE CLASSIC',W/2,235);

    ctx.fillStyle='#ffff00';
    ctx.font='14px "Press Start 2P",monospace';
    const blink = Math.floor(Date.now()/500)%2;
    if (blink) ctx.fillText('INSERT COIN',W/2,360);

    ctx.fillStyle='#ffffff';
    ctx.font='11px "Press Start 2P",monospace';
    ctx.fillText('PRESS ENTER / TAP TO START',W/2,400);

    ctx.fillStyle='#00ffff';
    ctx.font='12px "Press Start 2P",monospace';
    const diffText = this.difficulty === 0 ? '< EASY >' : this.difficulty === 1 ? '< NORMAL >' : '< HARD >';
    ctx.fillText(diffText, W/2, 440);

    ctx.fillStyle='#aaaaaa';
    ctx.font='9px "Press Start 2P",monospace';
    ctx.fillText('ARROWS / A-D : MOVE',W/2,480);
    ctx.fillText('SPACE : FIRE  |  P : PAUSE',W/2,500);

    drawPlayerShip(ctx,W/2-60,305,1.2,false);
    drawEnemyShip(ctx,W/2,315,'bee',1.2,false,Date.now()*0.005);
    drawEnemyShip(ctx,W/2+60,310,'butterfly',1,false,Date.now()*0.005);

    ctx.fillStyle='#ff00ff';ctx.font='8px "Press Start 2P",monospace';
    ctx.fillText('50 PTS',W/2,338);
    ctx.fillStyle='#ff8800';ctx.fillText('80 PTS',W/2+60,333);
    ctx.fillStyle='#ff4444';ctx.fillText('200 PTS',W/2-60,328);

    if (this.highScore>0) {
      ctx.fillStyle='#ffff00';
      ctx.font='11px "Press Start 2P",monospace';
      ctx.fillText('HIGH SCORE: '+String(this.highScore).padStart(7,'0'),W/2,560);
    }
  }

  renderStageIntro(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ffffff';
    ctx.font='24px "Press Start 2P",monospace';
    ctx.fillText('STAGE '+this.stage+' / '+TOTAL_STAGES,W/2,280);
    ctx.fillStyle='#00ffff';
    ctx.font='14px "Press Start 2P",monospace';
    ctx.fillText('GET READY!',W/2,340);

    for (const b of this.playerBullets) b.draw(ctx);
    for (const e of this.enemies) e.draw(ctx);
    this.player.draw(ctx);
    this.particles.draw(ctx);
  }

  renderVictory(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#00ff00';
    ctx.font='28px "Press Start 2P",monospace';
    ctx.shadowColor='#00ff00';ctx.shadowBlur=15;
    ctx.fillText('VICTORY!',W/2,180);
    ctx.shadowBlur=0;

    ctx.fillStyle='#ffff00';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText('ALL 32 STAGES CLEARED!',W/2,235);

    ctx.fillStyle='#ffffff';
    ctx.font='11px "Press Start 2P",monospace';
    ctx.fillText('COMPLETION BONUS',W/2,295);
    ctx.fillStyle='#00ffff';
    ctx.font='16px "Press Start 2P",monospace';
    ctx.fillText('+50000 PTS',W/2,325);

    ctx.fillStyle='#ffffff';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText('FINAL SCORE',W/2,380);
    ctx.fillStyle='#ff00ff';
    ctx.font='20px "Press Start 2P",monospace';
    ctx.fillText(String(this.score).padStart(7,'0'),W/2,415);

    ctx.fillStyle='#aaaaaa';
    ctx.font='10px "Press Start 2P",monospace';
    const blink = Math.floor(Date.now()/500)%2;
    if (blink) ctx.fillText('PRESS ENTER TO CONTINUE',W/2,500);

    this.particles.draw(ctx);
  }

  renderGameOver(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ff0000';
    ctx.font='36px "Press Start 2P",monospace';
    ctx.shadowColor='#ff0000';ctx.shadowBlur=15;
    ctx.fillText('GAME OVER',W/2,200);
    ctx.shadowBlur=0;

    ctx.fillStyle='#ffffff';
    ctx.font='14px "Press Start 2P",monospace';
    ctx.fillText('FINAL SCORE',W/2,290);
    ctx.fillStyle='#00ffff';
    ctx.font='20px "Press Start 2P",monospace';
    ctx.fillText(String(this.score).padStart(7,'0'),W/2,330);

    if (this.score>=this.highScore && this.score>0) {
      ctx.fillStyle='#ffff00';
      ctx.font='14px "Press Start 2P",monospace';
      ctx.fillText('NEW HIGH SCORE!',W/2,380);
    }

    ctx.fillStyle='#888888';
    ctx.font='11px "Press Start 2P",monospace';
    ctx.fillText('HIGH SCORE: '+String(this.highScore).padStart(7,'0'),W/2,420);

    ctx.fillStyle='#ffffff';
    ctx.font='12px "Press Start 2P",monospace';
    const blink = Math.floor(Date.now()/500)%2;
    if (blink) ctx.fillText('PRESS ENTER TO CONTINUE',W/2,500);

    this.particles.draw(ctx);
  }

  renderEnterName(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ff00ff';
    ctx.font='20px "Press Start 2P",monospace';
    ctx.fillText('NEW HIGH SCORE!',W/2,150);

    ctx.fillStyle='#ffffff';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.fillText('ENTER YOUR INITIALS',W/2,200);

    ctx.font='24px "Press Start 2P",monospace';
    
    for (let i = 0; i < 3; i++) {
      if (i === this.nameIndex) {
        if (Math.floor(Date.now() / 300) % 2 === 0) {
          ctx.fillStyle = '#ffff00';
          ctx.fillText(this.nameChars[i], W/2 - 40 + i * 40, 280);
        }
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(W/2 - 40 + i * 40 - 12, 290, 24, 4);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(this.nameChars[i], W/2 - 40 + i * 40, 280);
      }
    }

    ctx.fillStyle='#aaaaaa';
    ctx.font='9px "Press Start 2P",monospace';
    ctx.fillText('ARROWS / WASD : CHANGE LETTER',W/2,380);
    ctx.fillText('SPACE / ENTER / FIRE : CONFIRM',W/2,410);
  }

  renderSaving(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ffffff';
    ctx.font='16px "Press Start 2P",monospace';
    ctx.fillText('SAVING...',W/2,H/2);
  }

  renderLeaderboard(ctx) {
    ctx.textAlign='center';
    ctx.fillStyle='#ffff00';
    ctx.font='24px "Press Start 2P",monospace';
    ctx.fillText('TOP 10',W/2,100);

    ctx.fillStyle='#ffffff';
    ctx.font='12px "Press Start 2P",monospace';
    ctx.textAlign='left';

    const startY = 160;
    for (let i = 0; i < 10; i++) {
      const y = startY + i * 30;
      const rank = (i+1).toString().padStart(2, ' ') + '.';
      ctx.fillStyle = '#00ffff';
      ctx.fillText(rank, 80, y);
      
      if (i < this.leaderboard.scores.length) {
        const s = this.leaderboard.scores[i];
        ctx.fillStyle = '#ffffff';
        ctx.fillText(s.name, 140, y);
        ctx.fillStyle = '#ff00ff';
        ctx.textAlign = 'right';
        ctx.fillText(String(s.score).padStart(7,'0'), W - 80, y);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = '#555555';
        ctx.fillText('---', 140, y);
        ctx.textAlign = 'right';
        ctx.fillText('0000000', W - 80, y);
        ctx.textAlign = 'left';
      }
    }

    ctx.fillStyle='#aaaaaa';
    ctx.font='9px "Press Start 2P",monospace';
    ctx.textAlign='center';
    const blink = Math.floor(Date.now()/500)%2;
    if (blink) ctx.fillText('PRESS ENTER / TAP TO EXIT',W/2,520);
  }

  renderBonus(ctx) {
    for (const e of this.bonusEnemies) {
      if (!e.alive) continue;
      drawEnemyShip(ctx,e.x,e.y,'bee',0.8,false,Date.now()*0.005+e.pulse);
    }
    for (const b of this.playerBullets) b.draw(ctx);
    this.player.draw(ctx);
    this.particles.draw(ctx);

    ctx.fillStyle='#ffff00';
    ctx.textAlign='center';
    ctx.font='16px "Press Start 2P",monospace';
    const blink = Math.floor(Date.now()/200)%2;
    if (blink) ctx.fillText('BONUS STAGE!',W/2,100);
    ctx.fillStyle='#00ffff';
    ctx.font='11px "Press Start 2P",monospace';
    ctx.fillText('DESTROY THEM ALL!',W/2,130);
    ctx.fillStyle='#ffffff';
    ctx.font='10px "Press Start 2P",monospace';
    ctx.fillText('BONUS: '+this.bonusScore,W/2,160);
  }

  // ---- GAME LOOP ----
  loop() {
    this.update();
    this.render();
    requestAnimationFrame(()=>this.loop());
  }
}

// ============================================================
// SCALING
// ============================================================
function setupCanvas() {
  const canvas=document.getElementById('game');
  function resize() {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const reservedH = isTouch ? 140 : 0;
    const maxW = window.innerWidth;
    const maxH = Math.max(300, window.innerHeight - reservedH);
    const scale = Math.min(maxW / W, maxH / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  window.addEventListener('resize', resize);
  resize();
  return canvas;
}

// ============================================================
// INIT
// ============================================================
const canvas=setupCanvas();
const game=new Game(canvas);
game.loop();