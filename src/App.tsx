import { useState, useEffect, useCallback, useRef } from 'react';
import { ActiveUnit, BaseState, FloatingText, LevelConfig, Particle, Projectile, GameStats, UnitType } from './types/game';
import { UNITS } from './data/units';
import { LEVELS } from './data/levels';
import { BattleCanvas } from './components/BattleCanvas';
import { VoiceController } from './components/VoiceController';
import { UnitBar } from './components/UnitBar';
import { SpecialAbilitiesBar } from './components/SpecialAbilitiesBar';
import { HUDHeader } from './components/HUDHeader';
import { EncyclopediaModal } from './components/EncyclopediaModal';
import { LevelSelectModal } from './components/LevelSelectModal';
import { ResultModal } from './components/ResultModal';
import { soundManager } from './utils/audio';

export function App() {
  const [level, setLevel] = useState<LevelConfig>(LEVELS[0]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Bases
  const [playerBase, setPlayerBase] = useState<BaseState>({
    hp: LEVELS[0].playerBaseHp,
    maxHp: LEVELS[0].playerBaseHp,
    shield: 0,
    maxShield: 500,
    x: 80,
    name: 'Штаб Юнитов'
  });

  const [enemyBase, setEnemyBase] = useState<BaseState>({
    hp: LEVELS[0].enemyBaseHp,
    maxHp: LEVELS[0].enemyBaseHp,
    shield: 0,
    maxShield: 0,
    x: 1520,
    name: 'Штаб ИИ'
  });

  // Entities
  const [units, setUnits] = useState<ActiveUnit[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);

  // Resources
  const [energy, setEnergy] = useState<number>(180);
  const [energyRate, setEnergyRate] = useState<number>(LEVELS[0].energyRate);
  const [energyUpgradeCost, setEnergyUpgradeCost] = useState<number>(100);

  // Cooldowns
  const [unitCooldowns, setUnitCooldowns] = useState<Record<UnitType, number>>({
    infantry: 0, tank: 0, sniper: 0, rocketeer: 0, medic: 0, drone: 0,
    heavy_tank: 0, anti_air: 0, artillery: 0, flamethrower: 0, specops: 0, helicopter: 0
  });

  const [specialCooldowns, setSpecialCooldowns] = useState({
    airstrike: 0,
    shield: 0,
    repair: 0,
    nuke: 0
  });

  // Modals & Result
  const [gameResult, setResult] = useState<'victory' | 'defeat' | null>(null);
  const [isEncyclopediaOpen, setIsEncyclopediaOpen] = useState<boolean>(false);
  const [isLevelSelectOpen, setIsLevelSelectOpen] = useState<boolean>(false);

  // Stats tracking
  const [stats, setStats] = useState<GameStats>({
    unitsSpawned: 0,
    enemiesDestroyed: 0,
    damageDealt: 0,
    damageReceived: 0,
    voiceCommandsIssued: 0,
    buttonCommandsIssued: 0,
    timeElapsed: 0
  });

  // AI spawn timer ref
  const enemySpawnTimer = useRef<number>(0);

  // Reset Game State for level load or retry
  const loadLevel = useCallback((lvl: LevelConfig) => {
    setLevel(lvl);
    setPlayerBase({
      hp: lvl.playerBaseHp,
      maxHp: lvl.playerBaseHp,
      shield: 0,
      maxShield: 500,
      x: 80,
      name: 'Штаб Юнитов'
    });
    setEnemyBase({
      hp: lvl.enemyBaseHp,
      maxHp: lvl.enemyBaseHp,
      shield: 0,
      maxShield: 0,
      x: 1520,
      name: 'Штаб ИИ'
    });
    setUnits([]);
    setProjectiles([]);
    setParticles([]);
    setFloatingTexts([]);
    setEnergy(180);
    setEnergyRate(lvl.energyRate);
    setEnergyUpgradeCost(100);
    setResult(null);
    setIsPaused(false);
    enemySpawnTimer.current = 0;
    setStats({
      unitsSpawned: 0,
      enemiesDestroyed: 0,
      damageDealt: 0,
      damageReceived: 0,
      voiceCommandsIssued: 0,
      buttonCommandsIssued: 0,
      timeElapsed: 0
    });
  }, []);

  // Player Unit Spawner
  const spawnPlayerUnit = useCallback((type: UnitType, isVoice: boolean) => {
    if (gameResult) return;
    const cfg = UNITS[type];

    if (energy < cfg.cost) {
      soundManager.playSound('error');
      if (isVoice) soundManager.speak('Недостаточно энергии!');
      return;
    }

    if ((unitCooldowns[type] || 0) > 0) {
      soundManager.playSound('error');
      return;
    }

    // Deduct energy & set cooldown
    setEnergy((prev) => prev - cfg.cost);
    setUnitCooldowns((prev) => ({ ...prev, [type]: cfg.cooldown }));

    // Voice announcement
    if (isVoice) {
      soundManager.speak(`${cfg.name} вызван!`);
    } else {
      soundManager.playSound('voice_ok');
    }

    // Create unit instance
    const newUnit: ActiveUnit = {
      id: `player_${type}_${Date.now()}_${Math.random()}`,
      type,
      team: 'player',
      x: playerBase.x + 40,
      y: 380,
      hp: cfg.maxHp,
      maxHp: cfg.maxHp,
      config: cfg,
      lastAttackTime: 0,
      isAttacking: false,
      targetId: null
    };

    setUnits((prev) => [...prev, newUnit]);
    setStats((prev) => ({
      ...prev,
      unitsSpawned: prev.unitsSpawned + 1,
      voiceCommandsIssued: prev.voiceCommandsIssued + (isVoice ? 1 : 0),
      buttonCommandsIssued: prev.buttonCommandsIssued + (isVoice ? 0 : 1)
    }));
  }, [energy, unitCooldowns, gameResult, playerBase.x]);

  // Special Abilities Handler
  const triggerSpecial = useCallback((type: 'airstrike' | 'shield' | 'repair' | 'nuke') => {
    if (gameResult) return;

    if (type === 'airstrike') {
      if (energy < 200 || specialCooldowns.airstrike > 0) {
        soundManager.playSound('error');
        return;
      }
      setEnergy((prev) => prev - 200);
      setSpecialCooldowns((prev) => ({ ...prev, airstrike: 15 }));
      soundManager.playSound('airstrike');
      soundManager.speak('Авиаудар нанесен!');

      // Spawn airstrike bombs across the middle
      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          const bombX = 300 + i * 140 + Math.random() * 50;
          setProjectiles((p) => [
            ...p,
            {
              id: `bomb_${Date.now()}_${i}`,
              startX: bombX,
              startY: 20,
              currentX: bombX,
              currentY: 20,
              targetX: bombX,
              targetY: 380,
              speed: 500,
              damage: 180,
              splashRadius: 80,
              type: 'rocket',
              team: 'player',
              color: '#f97316'
            }
          ]);
        }, i * 150);
      }
    } else if (type === 'shield') {
      if (energy < 150 || specialCooldowns.shield > 0) {
        soundManager.playSound('error');
        return;
      }
      setEnergy((prev) => prev - 150);
      setSpecialCooldowns((prev) => ({ ...prev, shield: 20 }));
      soundManager.playSound('voice_ok');
      soundManager.speak('Защитный щит активирован!');
      setPlayerBase((prev) => ({ ...prev, shield: 500 }));
    } else if (type === 'repair') {
      if (energy < 120 || specialCooldowns.repair > 0) {
        soundManager.playSound('error');
        return;
      }
      setEnergy((prev) => prev - 120);
      setSpecialCooldowns((prev) => ({ ...prev, repair: 12 }));
      soundManager.playSound('heal');
      soundManager.speak('Ремонт штаба выполнен!');
      setPlayerBase((prev) => ({
        ...prev,
        hp: Math.min(prev.maxHp, prev.hp + 300)
      }));
    } else if (type === 'nuke') {
      if (energy < 400 || specialCooldowns.nuke > 0) {
        soundManager.playSound('error');
        return;
      }
      setEnergy((prev) => prev - 400);
      setSpecialCooldowns((prev) => ({ ...prev, nuke: 30 }));
      soundManager.playSound('airstrike');
      soundManager.speak('Ядерный запуск произведен!');

      setTimeout(() => {
        soundManager.playSound('explosion');
        // Flash screen and wipe enemy forces
        setUnits((prevUnits) =>
          prevUnits.map((u) => {
            if (u.team === 'enemy') {
              return { ...u, hp: u.hp - 800 };
            }
            return u;
          })
        );
        // Damage enemy base
        setEnemyBase((prev) => ({ ...prev, hp: Math.max(0, prev.hp - 500) }));
      }, 1000);
    }
  }, [energy, specialCooldowns, gameResult]);

  // Upgrade Energy Generator
  const upgradeEnergyGenerator = () => {
    if (energy < energyUpgradeCost) {
      soundManager.playSound('error');
      return;
    }
    soundManager.playSound('upgrade');
    setEnergy((prev) => prev - energyUpgradeCost);
    setEnergyRate((prev) => prev + 5);
    setEnergyUpgradeCost((prev) => Math.floor(prev * 1.5));
  };

  // MAIN GAME STEP UPDATE (Called inside BattleCanvas animation loop)
  const updateGameStep = useCallback((dt: number) => {
    if (gameResult || isPaused) return;

    // 1. Passive Energy Accumulation
    setEnergy((prev) => Math.min(2000, prev + energyRate * dt));

    // 2. Reduce Cooldowns
    setUnitCooldowns((prev) => {
      const next = { ...prev };
      for (const k in next) {
        const key = k as UnitType;
        if (next[key] > 0) next[key] = Math.max(0, next[key] - dt);
      }
      return next;
    });

    setSpecialCooldowns((prev) => ({
      airstrike: Math.max(0, prev.airstrike - dt),
      shield: Math.max(0, prev.shield - dt),
      repair: Math.max(0, prev.repair - dt),
      nuke: Math.max(0, prev.nuke - dt)
    }));

    // 3. AI Enemy Spawner
    enemySpawnTimer.current += dt;
    if (enemySpawnTimer.current >= level.enemySpawnRate) {
      enemySpawnTimer.current = 0;
      // Select random enemy unit from roster
      const randType = level.enemyRoster[Math.floor(Math.random() * level.enemyRoster.length)];
      const enemyCfg = UNITS[randType];

      const newEnemyUnit: ActiveUnit = {
        id: `enemy_${randType}_${Date.now()}_${Math.random()}`,
        type: randType,
        team: 'enemy',
        x: enemyBase.x - 40,
        y: 380,
        hp: enemyCfg.maxHp,
        maxHp: enemyCfg.maxHp,
        config: enemyCfg,
        lastAttackTime: 0,
        isAttacking: false,
        targetId: null
      };

      setUnits((prev) => [...prev, newEnemyUnit]);
    }

    // 4. Update Units AI, Combat & Movement
    setUnits((prevUnits) => {
      const now = performance.now() / 1000;
      const updatedUnits = prevUnits.map((u) => ({ ...u }));

      for (let i = 0; i < updatedUnits.length; i++) {
        const unit = updatedUnits[i];
        if (unit.hp <= 0) continue;

        const isPlayer = unit.team === 'player';
        const cfg = unit.config;

        // Apply Burn effect
        if (unit.burnDuration && unit.burnDuration > 0) {
          unit.burnDuration -= dt;
          unit.hp -= 8 * dt; // burn damage
        }

        // Search for targets in range
        let bestTarget: ActiveUnit | null = null;
        let minDistance = cfg.range;

        for (let j = 0; j < updatedUnits.length; j++) {
          const other = updatedUnits[j];
          if (other.hp <= 0) continue;

          // Medics heal same team, other units attack opposing team
          const isTargetableTeam = cfg.isHealer ? other.team === unit.team : other.team !== unit.team;
          if (!isTargetableTeam) continue;

          // Flying target check
          if (other.config.isFlying && !cfg.canTargetFlying) continue;

          // Medic shouldn't target fully healed units
          if (cfg.isHealer && other.hp >= other.maxHp) continue;

          const dist = Math.abs(unit.x - other.x);
          if (dist <= minDistance) {
            minDistance = dist;
            bestTarget = other;
          }
        }

        // Check distance to enemy base if no unit target found
        let baseTargeted = false;
        const targetBaseX = isPlayer ? enemyBase.x : playerBase.x;
        const distToBase = Math.abs(unit.x - targetBaseX);

        if (!bestTarget && !cfg.isHealer && distToBase <= cfg.range) {
          baseTargeted = true;
        }

        if (bestTarget || baseTargeted) {
          unit.isAttacking = true;

          // Check Attack Cooldown
          if (now - unit.lastAttackTime >= 1 / cfg.attackSpeed) {
            unit.lastAttackTime = now;

            // Perform Attack
            if (cfg.isHealer && bestTarget) {
              // Medic Healing
              bestTarget.hp = Math.min(bestTarget.maxHp, bestTarget.hp + Math.abs(cfg.damage));
              soundManager.playSound('heal');
              // Spawn Heal Beam
              setProjectiles((p) => [
                ...p,
                {
                  id: `heal_${Date.now()}`,
                  startX: unit.x,
                  startY: unit.config.isFlying ? 270 : 350,
                  currentX: bestTarget.x,
                  currentY: bestTarget.config.isFlying ? 270 : 350,
                  targetX: bestTarget.x,
                  targetY: 350,
                  speed: 800,
                  damage: 0,
                  type: 'heal_beam',
                  team: unit.team,
                  color: '#10b981'
                }
              ]);
            } else if (bestTarget) {
              // Unit Attack
              soundManager.playSound(
                unit.type === 'tank' || unit.type === 'heavy_tank'
                  ? 'cannon'
                  : unit.type === 'drone'
                  ? 'laser'
                  : unit.type === 'rocketeer'
                  ? 'rocket'
                  : unit.type === 'flamethrower'
                  ? 'flame'
                  : 'shoot'
              );

              // Spawn projectile
              const startY = unit.config.isFlying ? 270 : 350;
              const targetY = bestTarget.config.isFlying ? 270 : 350;

              setProjectiles((p) => [
                ...p,
                {
                  id: `proj_${Date.now()}_${Math.random()}`,
                  startX: unit.x,
                  startY,
                  currentX: unit.x,
                  currentY: startY,
                  targetX: bestTarget.x,
                  targetY,
                  speed: cfg.range > 250 ? 500 : 700,
                  damage: cfg.damage,
                  splashRadius: cfg.splashRadius,
                  type: cfg.id === 'drone' ? 'laser' : cfg.id === 'rocketeer' ? 'rocket' : cfg.id === 'flamethrower' ? 'flame' : 'bullet',
                  team: unit.team,
                  color: cfg.secondaryColor
                }
              ]);

              // Burn effect
              if (cfg.burnEffect) {
                bestTarget.burnDuration = 4;
              }
            } else if (baseTargeted) {
              // Base Attack
              soundManager.playSound(unit.type === 'tank' ? 'cannon' : 'shoot');
              const dmg = cfg.damage;

              if (isPlayer) {
                setEnemyBase((prev) => ({
                  ...prev,
                  hp: Math.max(0, prev.hp - dmg)
                }));
                setStats((s) => ({ ...s, damageDealt: s.damageDealt + dmg }));
              } else {
                setPlayerBase((prev) => {
                  let shield = prev.shield;
                  let hp = prev.hp;
                  let remDmg = dmg;
                  if (shield > 0) {
                    if (shield >= remDmg) {
                      shield -= remDmg;
                      remDmg = 0;
                    } else {
                      remDmg -= shield;
                      shield = 0;
                    }
                  }
                  hp = Math.max(0, hp - remDmg);
                  return { ...prev, shield, hp };
                });
                setStats((s) => ({ ...s, damageReceived: s.damageReceived + dmg }));
              }

              // Floating text
              setFloatingTexts((ft) => [
                ...ft,
                {
                  id: `ft_${Date.now()}`,
                  x: targetBaseX + (Math.random() * 20 - 10),
                  y: 280,
                  text: `-${Math.ceil(dmg)}`,
                  color: isPlayer ? '#f87171' : '#38bdf8',
                  life: 1,
                  maxLife: 1,
                  vy: -30
                }
              ]);
            }
          }
        } else {
          // No target -> Move forward
          unit.isAttacking = false;
          const dir = isPlayer ? 1 : -1;
          unit.x += dir * cfg.speed * dt;
        }
      }

      // Filter out dead units and reward bounty
      const aliveUnits = updatedUnits.filter((u) => {
        if (u.hp <= 0) {
          if (u.team === 'enemy') {
            setEnergy((e) => e + u.config.cost * 0.4); // 40% bounty
            setStats((s) => ({ ...s, enemiesDestroyed: s.enemiesDestroyed + 1 }));
          }
          // Spawn explosion particle
          setParticles((p) => [
            ...p,
            {
              id: `exp_${Date.now()}`,
              x: u.x,
              y: u.config.isFlying ? 270 : 370,
              vx: (Math.random() - 0.5) * 50,
              vy: -40,
              life: 1,
              maxLife: 1,
              color: u.config.color,
              size: 10
            }
          ]);
          return false;
        }
        return true;
      });

      return aliveUnits;
    });

    // 5. Update Projectiles Movement & Collisions
    setProjectiles((prev) => {
      const remaining: Projectile[] = [];

      for (const p of prev) {
        const dx = p.targetX - p.currentX;
        const dy = p.targetY - p.currentY;
        const dist = Math.hypot(dx, dy);

        if (dist < 15 || p.type === 'laser' || p.type === 'heal_beam') {
          // Projectile Impact
          soundManager.playSound('explosion');

          // Deal Splash or Single target damage
          setUnits((currentUnits) =>
            currentUnits.map((u) => {
              if (p.damage <= 0) return u; // heal beam
              if (u.team === p.team) return u; // don't damage teammates

              const hitDist = Math.abs(u.x - p.targetX);
              const maxDist = p.splashRadius || 25;

              if (hitDist <= maxDist) {
                const newHp = u.hp - p.damage;
                // Floating damage text
                setFloatingTexts((ft) => [
                  ...ft,
                  {
                    id: `dmg_${Date.now()}_${Math.random()}`,
                    x: u.x,
                    y: u.config.isFlying ? 240 : 330,
                    text: `-${Math.ceil(p.damage)}`,
                    color: '#f87171',
                    life: 1,
                    maxLife: 1,
                    vy: -25
                  }
                ]);
                return { ...u, hp: newHp };
              }
              return u;
            })
          );
        } else {
          // Move projectile towards target
          const step = p.speed * dt;
          p.currentX += (dx / dist) * step;
          p.currentY += (dy / dist) * step;
          remaining.push(p);
        }
      }

      return remaining;
    });

    // 6. Update Floating Texts Physics
    setFloatingTexts((prev) =>
      prev
        .map((ft) => ({
          ...ft,
          y: ft.y + ft.vy * dt,
          life: ft.life - dt * 1.2
        }))
        .filter((ft) => ft.life > 0)
    );

    // 7. Check Game Win / Loss Condition
    if (enemyBase.hp <= 0 && !gameResult) {
      setResult('victory');
    } else if (playerBase.hp <= 0 && !gameResult) {
      setResult('defeat');
    }
  }, [gameResult, isPaused, energyRate, level, enemyBase.x, playerBase.x]);

  // Keyboard Shortcuts (1-9, 0, -, =)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      const keyMap: Record<string, UnitType> = {
        '1': 'infantry',
        '2': 'tank',
        '3': 'sniper',
        '4': 'rocketeer',
        '5': 'medic',
        '6': 'drone',
        '7': 'heavy_tank',
        '8': 'anti_air',
        '9': 'artillery',
        '0': 'flamethrower',
        '-': 'specops',
        '=': 'helicopter'
      };

      if (keyMap[key]) {
        spawnPlayerUnit(keyMap[key], false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused((p) => !p);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spawnPlayerUnit]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-between p-2 sm:p-4 max-w-7xl mx-auto space-y-3 font-sans">
      {/* Top HUD Header */}
      <HUDHeader
        playerBase={playerBase}
        enemyBase={enemyBase}
        energy={energy}
        energyRate={energyRate}
        energyUpgradeCost={energyUpgradeCost}
        level={level}
        isPaused={isPaused}
        soundEnabled={soundEnabled}
        onTogglePause={() => setIsPaused(!isPaused)}
        onToggleSound={() => {
          const next = !soundEnabled;
          setSoundEnabled(next);
          soundManager.soundEnabled = next;
        }}
        onUpgradeEnergy={upgradeEnergyGenerator}
        onOpenEncyclopedia={() => setIsEncyclopediaOpen(true)}
        onOpenLevelSelect={() => setIsLevelSelectOpen(true)}
        onRestartLevel={() => loadLevel(level)}
      />

      {/* Voice Recognition Control Bar */}
      <VoiceController
        onSpawnUnit={spawnPlayerUnit}
        onTriggerSpecial={triggerSpecial}
        isGameActive={!isPaused && !gameResult}
        onOpenEncyclopedia={() => setIsEncyclopediaOpen(true)}
      />

      {/* 2D Canvas Battle Field Arena */}
      <BattleCanvas
        playerBase={playerBase}
        enemyBase={enemyBase}
        units={units}
        projectiles={projectiles}
        particles={particles}
        floatingTexts={floatingTexts}
        level={level}
        onUpdateGameStep={updateGameStep}
        isPaused={isPaused || !!gameResult}
      />

      {/* Special Commander Super Abilities Bar */}
      <SpecialAbilitiesBar
        energy={energy}
        cooldowns={specialCooldowns}
        onTriggerSpecial={triggerSpecial}
      />

      {/* Bottom Unit Calling Action Deck */}
      <UnitBar
        energy={energy}
        cooldowns={unitCooldowns}
        onSpawnUnit={spawnPlayerUnit}
      />

      {/* Encyclopedia & Voice Handbook Modal */}
      <EncyclopediaModal
        isOpen={isEncyclopediaOpen}
        onClose={() => setIsEncyclopediaOpen(false)}
      />

      {/* Level Selection Modal */}
      <LevelSelectModal
        isOpen={isLevelSelectOpen}
        currentLevelId={level.id}
        onSelectLevel={(selectedLvl) => loadLevel(selectedLvl)}
        onClose={() => setIsLevelSelectOpen(false)}
      />

      {/* Victory / Defeat Result Screen */}
      <ResultModal
        result={gameResult}
        stats={stats}
        level={level}
        onNextLevel={() => {
          const nextLevelIndex = LEVELS.findIndex((l) => l.id === level.id) + 1;
          if (nextLevelIndex < LEVELS.length) {
            loadLevel(LEVELS[nextLevelIndex]);
          }
        }}
        onRetry={() => loadLevel(level)}
      />
    </div>
  );
}

export default App;
