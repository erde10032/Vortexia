// src/audio/MusicManager.ts

// ─────────────────────────────────────────────────────────────────────────────
//  Vortexia — MusicManager
// ─────────────────────────────────────────────────────────────────────────────
//
//  Background music: one HTMLAudioElement, three MP3s in rotation.
//  First track is random; then 0→1→2→0… on each "ended" event.
//  Browsers often reject play() when it is not tied to a user gesture; the first
//  start() runs after mode selection (gesture). Later track changes rely on the
//  same document having unlocked audio — if play() fails, we re-arm the
//  interaction fallback.
//
//  Usage:
//    const music = new MusicManager();
//    music.start();
//    music.stop();
// ─────────────────────────────────────────────────────────────────────────────

const TRACKS = [
  'assets/audio/bg_music_1.mp3',
  'assets/audio/bg_music_2.mp3',
  'assets/audio/bg_music_3.mp3',
];

export class MusicManager {
  private _audio: HTMLAudioElement;
  private _trackIndex = 0;
  private _started = false;
  private _pendingStart = false;
  private _onEnded = (): void => {
    this._trackIndex = (this._trackIndex + 1) % TRACKS.length;
    this._playTrackAtIndex();
  };

  constructor() {
    this._audio = new Audio();
    this._audio.preload = 'auto';
    this._audio.loop = false;
    this._audio.volume = 1;
    // Mobile Safari: inline playback so lock screen / mute rules behave predictably
    this._audio.setAttribute('playsinline', '');
    this._audio.setAttribute('webkit-playsinline', '');
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    this._trackIndex = Math.floor(Math.random() * TRACKS.length);
    this._audio.removeEventListener('ended', this._onEnded);
    this._audio.addEventListener('ended', this._onEnded);
    this._playTrackAtIndex();
  }

  stop(): void {
    this._audio.removeEventListener('ended', this._onEnded);
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load();
    this._started = false;
    this._pendingStart = false;
  }

  setVolume(v: number): void {
    this._audio.volume = Math.max(0, Math.min(1, v));
  }

  private _playTrackAtIndex(): void {
    const src = TRACKS[this._trackIndex];
    this._audio.src = src;
    this._audio.load();
    const p = this._audio.play();
    if (p !== undefined) {
      p.catch(() => this._waitForInteractionThenResume());
    }
  }

  private _waitForInteractionThenResume(): void {
    if (this._pendingStart) return;
    this._pendingStart = true;
    const events = ['click', 'keydown', 'pointerdown', 'touchstart'] as const;
    const handler = (): void => {
      events.forEach(ev => document.removeEventListener(ev, handler));
      this._pendingStart = false;
      this._playTrackAtIndex();
    };
    events.forEach(ev => document.addEventListener(ev, handler, { once: true }));
  }
}
