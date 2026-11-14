import { registerWebModule, NativeModule } from 'expo';

import { BounceAudioModuleEvents } from './BounceAudio.types';

// The spike engine is iOS-only for now. The web build gets a Web Audio implementation later.
class BounceAudioModule extends NativeModule<BounceAudioModuleEvents> {}

export default registerWebModule(BounceAudioModule, 'BounceAudioModule');
