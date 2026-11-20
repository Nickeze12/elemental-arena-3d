/**
 * EconomyManager
 * ------------------------------------------------------------
 * Gestiona el saldo de oro, los Maestros Legendarios desbloqueados
 * y la Ruleta Legendaria (gacha sin repetidos), persistiendo en localStorage.
 */

export const ECONOMY_STORAGE_KEY = 'elemental_arena_save_v1';

export const CLASSIC_ELEMENTS = ['earth', 'fire', 'water', 'air'];
export const LEGENDARY_ELEMENTS = ['nature', 'psychic', 'storm', 'light', 'shadow'];
export const LEGENDARY_COSTS = [150, 200, 250, 300, 300];

export class EconomyManager {
  constructor(storageKey = ECONOMY_STORAGE_KEY) {
    this.storageKey = storageKey;
    this.gold = 0;
    this.unlockedLegendaries = [];
    this._listeners = new Set();
    this.load();
  }

  /** Carga oro y legendarios desbloqueados desde localStorage */
  load() {
    this.gold = 0;
    this.unlockedLegendaries = [];
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const g = Number(parsed.gold);
        this.gold = Number.isFinite(g) && g > 0 ? Math.floor(g) : 0;
        if (Array.isArray(parsed.unlockedLegendaries)) {
          const seen = new Set();
          for (const id of parsed.unlockedLegendaries) {
            if (LEGENDARY_ELEMENTS.includes(id) && !seen.has(id)) {
              seen.add(id);
              this.unlockedLegendaries.push(id);
            }
          }
        }
      }
    } catch {
      this.gold = 0;
      this.unlockedLegendaries = [];
    }
  }

  /** Persiste el estado actual en localStorage y notifica suscriptores */
  save() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          this.storageKey,
          JSON.stringify({
            gold: this.gold,
            unlockedLegendaries: this.unlockedLegendaries,
          })
        );
      } catch {
        // Ignora errores de cuota o almacenamiento privado
      }
    }
    this._notify();
  }

  /** @param {() => void} fn */
  onChange(fn) {
    if (typeof fn === 'function') this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) {
      try {
        fn(this);
      } catch {
        // Aísla errores de callbacks de UI
      }
    }
  }

  getGold() {
    return this.gold;
  }

  getUnlockedLegendaries() {
    return [...this.unlockedLegendaries];
  }

  getLockedLegendaries() {
    return LEGENDARY_ELEMENTS.filter((id) => !this.unlockedLegendaries.includes(id));
  }

  isClassic(elementId) {
    return CLASSIC_ELEMENTS.includes(elementId);
  }

  isLegendary(elementId) {
    return LEGENDARY_ELEMENTS.includes(elementId);
  }

  isUnlocked(elementId) {
    return this.isClassic(elementId) || this.unlockedLegendaries.includes(elementId);
  }

  /** Coste de la próxima tirada legendaria (150 -> 200 -> 250 -> 300 -> 300 -> null) */
  getNextLegendaryCost() {
    const idx = this.unlockedLegendaries.length;
    if (idx >= LEGENDARY_ELEMENTS.length) return null;
    return LEGENDARY_COSTS[idx] ?? 300;
  }

  canRollLegendary() {
    const cost = this.getNextLegendaryCost();
    return cost !== null && this.gold >= cost;
  }

  /** Suma oro entero no negativo y guarda inmediatamente */
  addGold(amount) {
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    if (add <= 0) return this.gold;
    this.gold += add;
    this.save();
    return this.gold;
  }

  /**
   * Ejecuta una tirada de Ruleta Legendaria sin repetidos.
   * @returns {{ unlockedElement: string, costPaid: number, nextCost: number | null, remainingCount: number } | null}
   */
  rollLegendaryGacha() {
    const locked = this.getLockedLegendaries();
    const cost = this.getNextLegendaryCost();
    if (locked.length === 0 || cost === null || this.gold < cost) {
      return null;
    }
    this.gold -= cost;
    const unlockedElement = locked[Math.floor(Math.random() * locked.length)];
    this.unlockedLegendaries.push(unlockedElement);
    this.save();
    return {
      unlockedElement,
      costPaid: cost,
      nextCost: this.getNextLegendaryCost(),
      remainingCount: locked.length - 1,
    };
  }

  /** Elige aleatoriamente uno de los 4 elementos clásicos (25% cada uno) */
  rollClassicElement() {
    return CLASSIC_ELEMENTS[Math.floor(Math.random() * CLASSIC_ELEMENTS.length)];
  }
}

export const economyManager = new EconomyManager();
