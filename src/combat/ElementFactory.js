import { EarthController } from './EarthController.js';
import { FireController } from './FireController.js';
import { WaterController } from './WaterController.js';
import { AirController } from './AirController.js';
import { NatureController } from './NatureController.js';
import { PsychicController } from './PsychicController.js';
import { StormController } from './StormController.js';
import { LightController } from './LightController.js';
import { ShadowController } from './ShadowController.js';

/**
 * ElementFactory
 * ------------------------------------------------------------
 * Fábrica unificada y catálogo descriptivo de los 4 elementos para el
 * sistema de combate, la IA y el HUD (selector de maestro y ranuras).
 */

export const ELEMENTS = {
  earth: {
    id: 'earth',
    name: 'Tierra',
    title: 'MAESTRO TIERRA',
    rivalTitle: 'RIVAL TIERRA',
    icon: '⛰️',
    color: '#82b54b',
    accent: '#d8a63c',
    style: 'Defensa Sólida e Impacto Pesado',
    description: 'Acumula hasta 3 rocas con Disco Roca para petrificar enemigos, alza muros que habilitan Salto Montaña y lanza peñascos de granito.',
    abilities: [
      { slot: 'primary', id: 'rock', key: 'Click Izq', name: 'Disco Roca' },
      { slot: 'secondary', id: 'wall', key: 'Click Der', name: 'Muro Tierra' },
      { slot: 'skill1', id: 'seismic', key: 'Q', name: 'Onda Sísmica' },
      { slot: 'skill2', id: 'boulder', key: 'E', name: 'Peñasco' },
    ],
  },
  fire: {
    id: 'fire',
    name: 'Fuego',
    title: 'MAESTRO FUEGO',
    rivalTitle: 'RIVAL FUEGO',
    icon: '🔥',
    color: '#f0523a',
    accent: '#ffb638',
    style: 'Combo, Quemadura y Presión Ofensiva',
    description: 'Encadena combos ígneos de 3 golpes, planta hasta 2 muros bajos de llamas consecutivos, barre con abanicos de fuego e impacta con propulsión meteoro.',
    abilities: [
      { slot: 'primary', id: 'firecombo', key: 'Click Izq', name: 'Combo Ígneo' },
      { slot: 'secondary', id: 'firewall', key: 'Click Der', name: 'Muro de Fuego' },
      { slot: 'skill1', id: 'flamefan', key: 'Q', name: 'Abanico Llamas' },
      { slot: 'skill2', id: 'meteor', key: 'E', name: 'Propulsión Meteoro' },
    ],
  },
  water: {
    id: 'water',
    name: 'Agua',
    title: 'MAESTRO AGUA',
    rivalTitle: 'RIVAL AGUA',
    icon: '🌊',
    color: '#38b6ff',
    accent: '#9be8ff',
    style: 'Control, Hielo y Barrido',
    description: 'Azota con látigos fluidos que aumentan su alcance sobre el agua, orbita gotas, congela con lanzas de hielo y deja charcos acuáticos con maremotos.',
    abilities: [
      { slot: 'primary', id: 'waterwhip', key: 'Click Izq', name: 'Látigo de Agua' },
      { slot: 'secondary', id: 'waterorbit', key: 'Click Der', name: 'Órbita de Gotas' },
      { slot: 'skill1', id: 'icespears', key: 'Q', name: 'Lanzas de Hielo' },
      { slot: 'skill2', id: 'tidalwave', key: 'E', name: 'Maremoto' },
    ],
  },
  air: {
    id: 'air',
    name: 'Aire',
    title: 'MAESTRO AIRE',
    rivalTitle: 'RIVAL AIRE',
    icon: '🌪️',
    color: '#f5b842',
    accent: '#d6f8ff',
    style: 'Movilidad Extrema, Control y Ring-Out',
    description: 'Lanza torbellinos frontales, vórtices tácticos en zigzag, ráfagas concussivas y tornados errantes de área.',
    abilities: [
      { slot: 'primary', id: 'airshot', key: 'Click Izq', name: 'Torbellino Frontal' },
      { slot: 'secondary', id: 'airvortex', key: 'Click Der', name: 'Vórtice Zigzag' },
      { slot: 'skill1', id: 'airblast', key: 'Q', name: 'Ráfaga Concussiva' },
      { slot: 'skill2', id: 'tornado', key: 'E', name: 'Tornado Errante' },
    ],
  },
  nature: {
    id: 'nature',
    name: 'Naturaleza',
    title: 'MAESTRO NATURALEZA',
    rivalTitle: 'RIVAL NATURALEZA',
    icon: '🌿',
    color: '#52b788',
    accent: '#95d5b2',
    style: 'Torreta Botánica, Enredo y Veneno',
    description: 'Desata ráfagas de espinas, hace crecer un Brote Escupesemillas aliado en el suelo, inmoviliza con raíces e intoxica con esporas.',
    abilities: [
      { slot: 'primary', id: 'thorns', key: 'Click Izq', name: 'Ráfaga Espinas' },
      { slot: 'secondary', id: 'spitter', key: 'Click Der', name: 'Escupesemillas' },
      { slot: 'skill1', id: 'roots', key: 'Q', name: 'Raíces Enredaderas' },
      { slot: 'skill2', id: 'spores', key: 'E', name: 'Tormenta Esporas' },
    ],
  },
  psychic: {
    id: 'psychic',
    name: 'Psíquico',
    title: 'MAESTRO PSÍQUICO',
    rivalTitle: 'RIVAL PSÍQUICO',
    icon: '🔮',
    color: '#e879f9',
    accent: '#f3e8ff',
    style: 'Telequinesis, Gravedad y Control Mental',
    description: 'Lanza orbes telequinéticos guiados, invierte controles con Pulso de Confusión, repele proyectiles con ondas e implosiona con gravedad.',
    abilities: [
      { slot: 'primary', id: 'psiorb', key: 'Click Izq', name: 'Orbe Psíquico' },
      { slot: 'secondary', id: 'confuse', key: 'Click Der', name: 'Pulso Confusión' },
      { slot: 'skill1', id: 'psiwave', key: 'Q', name: 'Onda Mental' },
      { slot: 'skill2', id: 'implosion', key: 'E', name: 'Implosión Astral' },
    ],
  },
  storm: {
    id: 'storm',
    name: 'Tormenta',
    title: 'MAESTRO TORMENTA',
    rivalTitle: 'RIVAL TORMENTA',
    icon: '⛈️',
    color: '#38bdf8',
    accent: '#fde047',
    style: 'Rayo Veloz, Niebla Invulnerable y Nube de Trueno',
    description: 'Dispara descargas voltaicas, se transforma en Niebla invulnerable y levitante al mantener Click Der, encadena relámpagos y desata nubes de trueno.',
    abilities: [
      { slot: 'primary', id: 'stormbolt', key: 'Click Izq', name: 'Descarga Voltaica' },
      { slot: 'secondary', id: 'mistform', key: 'Click Der', name: 'Forma de Niebla' },
      { slot: 'skill1', id: 'chainlightning', key: 'Q', name: 'Relámpago Encadenado' },
      { slot: 'skill2', id: 'thundercloud', key: 'E', name: 'Nube de Trueno' },
    ],
  },
  light: {
    id: 'light',
    name: 'Luz',
    title: 'MAESTRO LUZ',
    rivalTitle: 'RIVAL LUZ',
    icon: '✨',
    color: '#facc15',
    accent: '#38bdf8',
    style: 'Precisión Fotónica, Espejismos y Refracción Láser',
    description: 'Dispara Haces Fotónicos ultrarrápidos, invoca un Espejismo que distrae rivales y explota, ciega con Destello Solar y refracta láseres con Prismas.',
    abilities: [
      { slot: 'primary', id: 'photonbeam', key: 'Click Izq', name: 'Haz Fotónico' },
      { slot: 'secondary', id: 'mirage', key: 'Click Der', name: 'Espejismo' },
      { slot: 'skill1', id: 'solarflash', key: 'Q', name: 'Destello Solar' },
      { slot: 'skill2', id: 'prism', key: 'E', name: 'Prisma Refractario' },
    ],
  },
  shadow: {
    id: 'shadow',
    name: 'Sombra',
    title: 'MAESTRO SOMBRA',
    rivalTitle: 'RIVAL SOMBRA',
    icon: '🌑',
    color: '#f43f5e',
    accent: '#6d28d9',
    style: 'Sigilo, Emboscada y Drenaje Vital',
    description: 'Se teletransporta tras el rival con Paso Sombrío para emboscar, drena vida y gana velocidad con Tentáculos Oscuros y obtiene defensa bajo Velo de Eclipse.',
    abilities: [
      { slot: 'primary', id: 'shadowlance', key: 'Click Izq', name: 'Lanza Umbría' },
      { slot: 'secondary', id: 'shadowstep', key: 'Click Der', name: 'Paso Sombrío' },
      { slot: 'skill1', id: 'tendrils', key: 'Q', name: 'Tentáculos Oscuros' },
      { slot: 'skill2', id: 'eclipseveil', key: 'E', name: 'Velo de Eclipse' },
    ],
  },
};

export const ELEMENT_KEYS = ['earth', 'fire', 'water', 'air', 'nature', 'psychic', 'storm', 'light', 'shadow'];

export function getElementConfig(element) {
  return ELEMENTS[element] || ELEMENTS.earth;
}

/**
 * Instancia el controlador elemental correspondiente para un luchador.
 * @param {'earth'|'fire'|'water'|'air'} element
 * @param {import('./CombatManager.js').CombatManager} manager
 * @param {import('../entities/BaseFighter.js').BaseFighter} fighter
 * @param {object|null} [aimProvider=null]
 * @param {number} [cooldownBonus=0]
 */
export function createElementController(element, manager, fighter, aimProvider = null, cooldownBonus = 0) {
  switch (element) {
    case 'fire':
      return new FireController(manager, fighter, aimProvider, cooldownBonus);
    case 'water':
      return new WaterController(manager, fighter, aimProvider, cooldownBonus);
    case 'air':
      return new AirController(manager, fighter, aimProvider, cooldownBonus);
    case 'nature':
      return new NatureController(manager, fighter, aimProvider, cooldownBonus);
    case 'psychic':
      return new PsychicController(manager, fighter, aimProvider, cooldownBonus);
    case 'storm':
      return new StormController(manager, fighter, aimProvider, cooldownBonus);
    case 'light':
      return new LightController(manager, fighter, aimProvider, cooldownBonus);
    case 'shadow':
      return new ShadowController(manager, fighter, aimProvider, cooldownBonus);
    case 'earth':
    default:
      return new EarthController(manager, fighter, aimProvider, cooldownBonus);
  }
}
