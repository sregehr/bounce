// Re-export the native module. On web, it will be resolved to BounceAudioModule.web.ts
// and on native platforms to BounceAudioModule.ts
export { default } from './src/BounceAudioModule';
export * from './src/BounceAudio.types';
